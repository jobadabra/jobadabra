"""A source getting lost is red and alerted (finish-line G6; owner, 10 Nov 2026: "If a source is getting lost · We should have red CI · We should have alerts · on the
Engineering channel"). Reads the night's verdict (after gate.py compare and floors.py check) and the earlier main runs' verdicts, and stores `lost` on the verdict:
{causes: [{kind, red, what, people, detail}], red, green_again}. tools/persona-search/search-alert.mjs turns it into the one Telegram card; the "Red when" step reads
the exit code. Causes, one per kind and what:
- gone: a source word of `sources` (sources_count.py) whose right jobs, summed over the 18, were above 0 on each of the last 3 runs that carried it, and are 0 now
  (arms by itself once 3 runs carry `sources`; EURES only from persons whose row read EURES); red;
- unread: a finder step (step_yield: employer_sites, job_boards, free_job_apis) that brought no job for any measured person, when at least MIN_READ persons were
  measured (a refused, crashed or timed-out reader for everyone); red;
- floor: a number under its floor two nights in a row (floors.py's `floors.red`, already red there; told here, with the merges since the last green run);
- not-run: persons no AI answered (gate.py kind 'not-run'): told, never red (a blind night is not a lost source, #3714).
green_again: no red cause now, and the newest earlier run's `lost` was red: one "green again" message, then silence.

  python3 tools/persona-search/lost.py check <verdict.json> [<earlier run dir>...]   (newest first) adds `lost`; exit 3 when a cause is red"""
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
    """{word: right jobs over the run's measured persons} for the words every counted person measured (a {status} word is left out); {} when no row carries `sources`."""
    out, seen = {}, False
    for row in personas(verdict):
        sources = row.get('sources') if measured(row) else None
        if not isinstance(sources, dict):
            continue
        seen = True
        for word, value in sources.items():
            if word == 'eures' and row.get('eures') != 'on':
                continue   # sa, 10 Nov 2026: EURES counts only where the row read EURES
            if isinstance(value, dict) and isinstance(value.get('right'), int):
                out[word] = out.get(word, 0) + value['right']
    return out if seen else {}


def gone(verdict, earlier):
    """Words right on each of the last NIGHTS runs that carried `sources` and at 0 now."""
    now = totals(verdict)
    past = [t for t in (totals(v) for v in earlier) if t][:NIGHTS]
    if not now or len(past) < NIGHTS:
        return []
    return [{'kind': 'gone', 'red': True, 'what': word, 'people': [], 'detail': f'{now.get(word, 0)} right now, {" / ".join(str(t[word]) for t in past)} on the last {NIGHTS} runs'}
            for word in sorted(set.intersection(*(set(t) for t in past))) if all(t[word] > 0 for t in past) and now.get(word, 0) == 0 and word in now]


def unread(verdict):
    """Finder steps that brought no job for any measured person (at least MIN_READ measured with step_yield)."""
    rows = [row for row in personas(verdict) if measured(row) and isinstance(row.get('step_yield'), list)]
    if len(rows) < MIN_READ:
        return []
    jobs = {step: 0 for step in STEPS}
    for row in rows:
        for entry in row['step_yield']:
            if isinstance(entry, dict) and entry.get('step') in jobs and isinstance(entry.get('jobs'), int):
                jobs[entry['step']] += entry['jobs']
    return [{'kind': 'unread', 'red': True, 'what': step, 'people': [], 'detail': f'no job from it for any of the {len(rows)} measured persons'} for step, n in jobs.items() if n == 0]


def floor(verdict):
    """floors.py's red numbers, one cause per number."""
    floors = (verdict or {}).get('floors') or {}
    return [{'kind': 'floor', 'red': True, 'what': red['number'], 'people': [red['persona']], 'detail': f"{red['now']} under its floor {red['floor']} two nights in a row"}
            for red in floors.get('red') or [] if isinstance(red, dict)]


def not_run(verdict):
    """One told (not red) cause when persons were not run: how many and why."""
    rows = [r for r in (verdict or {}).get('rows') or [] if isinstance(r, dict) and r.get('kind') == 'not-run']
    if not rows:
        return []
    return [{'kind': 'not-run', 'red': False, 'what': 'not run', 'people': [r.get('persona') for r in rows],
             'detail': str(rows[0].get('why') or '').removeprefix('not run: ')[:120]}]


def merges(verdict):
    """The merges since the floors were last green (floors.py's, computed once there when a floor is red; else asked here), [] when unknown."""
    floors = verdict.get('floors') or {}
    if floors.get('merges'):
        return floors['merges']
    try:
        import floors as floors_mod
        return floors_mod.merges_since(os.environ.get('GITHUB_REPOSITORY', ''), floors.get('last_green'))
    except Exception:   # noqa: BLE001 (Why: the merges only help read the alert; without them it is still sent)
        return []


def check(verdict_path, earlier_dirs):
    """Add `lost` to the verdict -> RED when a cause is red, else 0."""
    verdict = json.loads(Path(verdict_path).read_text(encoding='utf-8'))
    earlier = []
    for folder in earlier_dirs:
        try:
            earlier.append(json.loads((Path(folder) / 'verdict.json').read_text(encoding='utf-8')))
        except (OSError, ValueError):
            continue
    causes = [] if verdict.get('state') == 'not-run' else gone(verdict, earlier) + unread(verdict) + floor(verdict)
    causes += not_run(verdict)
    red = any(c['red'] for c in causes)
    before = next((v.get('lost') for v in earlier if isinstance(v.get('lost'), dict)), None)
    verdict['lost'] = {'causes': causes, 'red': red, 'green_again': bool(not red and verdict.get('state') != 'not-run' and before and before.get('red')),
                       'merges': merges(verdict) if red else []}
    Path(verdict_path).write_text(json.dumps(verdict, ensure_ascii=False, indent=1), encoding='utf-8')
    print('lost: ' + ('; '.join(f"{c['kind']} {c['what']}: {c['detail']}" for c in causes) or 'no source lost') + (' (green again)' if verdict['lost']['green_again'] else ''))
    return RED if red else 0


if __name__ == '__main__':
    if len(sys.argv) < 3 or sys.argv[1] != 'check':
        sys.exit(__doc__)
    sys.exit(check(sys.argv[2], sys.argv[3:]))
