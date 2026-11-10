"""A source getting lost is red and alerted (finish-line G6; owner, 10 Nov 2026: "If a source is getting lost · We should have red CI · We should have alerts · on the
Engineering channel"). Reads the night's verdict (after gate.py compare and floors.py check) and the earlier main runs' verdicts, and stores `lost` on the verdict:
{causes, red, open, tell, back, merges}. tools/persona-search/search-alert.mjs turns `tell` and `back` into the one Telegram card; the "Red when" step reads the exit
code. Causes ({kind, red, what, people, detail}), one per kind and what:
- gone: a source word of `sources` (tools/persona-search/sources_count.py, #3749; until it lands no row carries `sources`, so this cause waits) whose right jobs, summed over the 18, were above 0 on each of the last 3 runs that carried it, and are 0
  (or left out) now; only runs where at least MIN_READ persons carry `sources` count, so a partly blind night is no evidence (arms by itself once 3 runs carry
  `sources`; EURES only from persons whose row read EURES; a {status} word is not measured, never gone); red;
- unread: a finder step (step_yield: employer_sites, job_boards, free_job_apis) that brought no job for any measured person, when at least MIN_READ persons were
  measured (a refused, crashed or timed-out reader for everyone); red; "time was up before its turn" when the persons' press logs say the clock stopped it (sf, #3754);
- floor: a number under its floor two nights in a row (floors.py's `floors.red`, red on a scheduled night only, as there; told with the merges since the last green);
- not-run: persons no AI answered (gate.py kind 'not-run'): told, never red (a blind night is not a lost source, #3714).
Told on a change only (sa, 10 Nov 2026: "never the same alert every night"; the night itself stays red while a cause lasts): `open` = the causes now; `tell` = the
causes not open before; `back` = the causes open before and gone now. A blind night keeps the open causes (it saw no source) and backs none.
Where `open` lives between nights (sa, 10 Nov 2026): in the floors' state (refs/tags/search-floors, key `lost`), so only a scheduled night opens or clears a cause, through
the floors-save job (contents: write, compare-and-set, shape checked by floors.validate). The night's compare writes it into result/floors-state.json (--state); a run
without that file (by hand, or floors not checked) reads the open causes from the ref and never writes them.

  python3 tools/persona-search/lost.py check <verdict.json> [--state <floors-state.json>] [--logs <results dir>] [--night] [<earlier run dir>...]   (newest first)
  adds `lost`; exit 3 when a cause is red"""
import re
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

RED = 3
STEPS = ('employer_sites', 'job_boards', 'free_job_apis')
MIN_READ = 6   # Why (10 Nov 2026, G6): a run of a few persons can rightly read no job from one step; across 6 or more, no job at all from a step means the step is lost
NIGHTS = 3


def personas(verdict):
    """The verdict's raw rows (gate.py load_results), as a list."""
    found = (verdict or {}).get('personas') or []
    return list(found.values()) if isinstance(found, dict) else [row for row in found if isinstance(row, dict)]


def measured(row):
    """A person the press measured: neither not run nor unmeasured."""
    return isinstance(row, dict) and not row.get('not_run') and not row.get('not_measured')


def totals(verdict):
    """{word: right jobs over the run's measured persons, or None when the word only said a {status}}; {} when fewer than MIN_READ measured rows carry `sources`
    (a partly blind night is no evidence: the missing persons' jobs would read as lost). A word a row leaves out (linkedin with none) counts as 0 where it is read."""
    out, seen = {}, 0
    for row in personas(verdict):
        sources = row.get('sources') if measured(row) else None
        if not isinstance(sources, dict):
            continue
        seen += 1
        for word, value in sources.items():
            if word == 'eures' and row.get('eures') != 'on':
                out.setdefault(word, None)   # sa, 10 Nov 2026: EURES counts only where the row read EURES; off is not measured, never gone
            elif isinstance(value, dict) and isinstance(value.get('right'), int):
                out[word] = (out.get(word) or 0) + value['right']
            else:
                out.setdefault(word, None)
    return out if seen >= MIN_READ else {}


def gone(verdict, earlier):
    """Words right on each of the last NIGHTS runs that carried `sources` and at 0 now."""
    now = totals(verdict)
    past = [t for t in (totals(v) for v in earlier) if t][:NIGHTS]
    if not now or len(past) < NIGHTS:
        return []
    return [{'kind': 'gone', 'red': True, 'what': word, 'people': [], 'detail': f'0 right now, {" / ".join(str(t[word]) for t in past)} on the last {NIGHTS} runs'}
            for word in sorted(set.intersection(*(set(t) for t in past)))
            if all((t[word] or 0) > 0 for t in past) and (word not in now or now[word] == 0)]   # None now = a {status}: not measured, never "gone"


TIME_UP = re.compile(r'Time is up \([^)]*\) for (job boards|employer sites|free job APIs):')   # src/press clock's line when a step's share ran out before it read
STEP_OF = {'job boards': 'job_boards', 'employer sites': 'employer_sites', 'free job APIs': 'free_job_apis'}


def timeups(results):
    """{step: persons whose press log (draw/run-*.log, the engine's own lines) says the clock stopped that step} under a results folder (one folder per
    person's artifact), {} without one."""
    stopped = {}
    for log in sorted(Path(results).rglob('run-*.log')) if results else []:
        try:
            steps = {STEP_OF[m] for m in TIME_UP.findall(log.read_text(encoding='utf-8', errors='replace'))}
        except OSError:
            continue
        person = log.relative_to(results).parts[0]
        for step in steps:
            stopped.setdefault(step, set()).add(person)
    return {step: len(people) for step, people in stopped.items()}


def unread(verdict, clock=None):
    """Finder steps that brought no job for any measured person (at least MIN_READ measured with step_yield); clock: timeups()."""
    rows = [row for row in personas(verdict) if measured(row) and isinstance(row.get('step_yield'), list)]
    if len(rows) < MIN_READ:
        return []
    jobs = {step: 0 for step in STEPS}
    for row in rows:
        for entry in row['step_yield']:
            if isinstance(entry, dict) and entry.get('step') in jobs and isinstance(entry.get('jobs'), int):
                jobs[entry['step']] += entry['jobs']
    def detail(step):
        stopped = (clock or {}).get(step, 0)
        return f'time was up before its turn ({stopped} of {len(rows)} persons)' if stopped else f'no job from it for any of the {len(rows)} measured persons'
    return [{'kind': 'unread', 'red': True, 'what': step, 'people': [], 'detail': detail(step)} for step, n in jobs.items() if n == 0]


def floor(verdict, night):
    """floors.py's red numbers, one cause per number; red only on a scheduled night, as floors.py's own exit (a by-hand run tells them, never reds on them)."""
    floors = (verdict or {}).get('floors') or {}
    return [{'kind': 'floor', 'red': night, 'what': f"p{red['persona']} {red['number']}", 'people': [red['persona']], 'detail': f"{red['now']} under its floor {red['floor']} two nights in a row"}
            for red in floors.get('red') or [] if isinstance(red, dict)]


def not_run(verdict):
    """One told (not red) cause when persons were not run: how many and why."""
    rows = [r for r in (verdict or {}).get('rows') or [] if isinstance(r, dict) and r.get('kind') == 'not-run']
    if not rows:
        return []
    return [{'kind': 'not-run', 'red': False, 'what': 'not run', 'people': [r.get('persona') for r in rows],
             'detail': str(rows[0].get('why') or '').removeprefix('not run: ')[:120]}]


def merges(verdict):
    """The merges since the floors were last green, only to help read the alert: floors.py's when a floor is red, else asked here from the floors' last green run;
    [] when the floors were not checked (no last green) or GitHub does not answer: the alert is still sent, without them."""
    floors = verdict.get('floors') or {}
    if floors.get('merges'):
        return floors['merges']
    try:
        import floors as floors_mod
        return floors_mod.merges_since(os.environ.get('GITHUB_REPOSITORY', ''), floors.get('last_green'))
    except Exception:   # noqa: BLE001 (Why: the merges only help read the alert; without them it is still sent)
        return []


def key(cause):
    """A cause's identity across nights."""
    return f"{cause['kind']}:{cause['what']}"


def open_before(state_file):
    """(the floors-state file's data or None, the causes open before): from the night's floors-state.json when compare wrote one, else read from the ref (never written)."""
    try:
        data = json.loads(Path(state_file).read_text(encoding='utf-8'))
        return data, list(((data.get('state') or {}).get('lost') or {}).get('open') or [])
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    try:
        import floors as floors_mod
        _, state = floors_mod.read_state(os.environ.get('GITHUB_REPOSITORY', ''))
        return None, list(((state or {}).get('lost') or {}).get('open') or [])
    except Exception:   # noqa: BLE001 (Why: no readable state = nothing open before; the causes are told as new, the night's red is unchanged)
        return None, []


def check(verdict_path, earlier_dirs, logs=None, state_file=None, night=False):
    """Add `lost` to the verdict (and, on a night, its open causes to the floors' state file) -> RED when a cause is red, else 0."""
    verdict = json.loads(Path(verdict_path).read_text(encoding='utf-8'))
    earlier = []
    for folder in earlier_dirs:
        try:
            earlier.append(json.loads((Path(folder) / 'verdict.json').read_text(encoding='utf-8')))
        except (OSError, ValueError):
            continue
    blind = verdict.get('state') == 'not-run'
    causes = ([] if blind else gone(verdict, earlier) + unread(verdict, timeups(logs)) + floor(verdict, night)) + not_run(verdict)
    red = any(c['red'] for c in causes)
    data, opened = open_before(state_file)
    was = set(opened)
    now = {key(c) for c in causes} | ({k for k in was if not k.startswith('not-run:')} if blind else set())
    tell = [c for c in causes if key(c) not in was]
    back = [] if blind else sorted(k for k in was - now if not k.startswith('not-run:'))
    verdict['lost'] = {'causes': causes, 'red': red, 'open': sorted(now), 'tell': tell, 'back': back, 'merges': merges(verdict) if any(c['red'] for c in tell) else []}
    Path(verdict_path).write_text(json.dumps(verdict, ensure_ascii=False, indent=1), encoding='utf-8')
    if data is not None and isinstance(data.get('state'), dict):
        import floors as floors_mod   # Why (Gitar on #3770): only keys of the one shape floors.validate takes, so a bad cause can never make floors-save refuse the floors
        data['state']['lost'] = {'open': sorted(k for k in now if floors_mod.LOST_KEY.fullmatch(k))[:floors_mod.LOST_MAX]}
        Path(state_file).write_text(json.dumps(data), encoding='utf-8')
    print('lost: ' + ('; '.join(f"{c['kind']} {c['what']}: {c['detail']}" for c in causes) or 'no source lost')
          + f" · tell {len(tell)}, back {len(back)}{' (told before: the night stays red, no message)' if causes and not tell and not back else ''}")
    return RED if red else 0


if __name__ == '__main__':
    if len(sys.argv) < 3 or sys.argv[1] != 'check':
        sys.exit(__doc__)
    rest, flags = sys.argv[3:], {}
    while rest[:1] and rest[0] in ('--logs', '--state', '--night'):
        flags[rest[0]], rest = (True, rest[1:]) if rest[0] == '--night' else (rest[1], rest[2:])
    sys.exit(check(sys.argv[2], rest, flags.get('--logs'), flags.get('--state'), bool(flags.get('--night'))))
