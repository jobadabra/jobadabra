"""The 30 fictional profiles' first search on CI (search-profiles.yml): their CV, the blind judge on their jobs, one row each and the run's table.

Why (12 Nov 2026, owner, asked via AskUserQuestion by sa: "Move it to CI"): the profile round ran on the owner's Mac, one search at a time, and its numbers
followed the Mac's load (Cluj 18 -> 0 at load 24, 18 -> 21 at load 10, same code). This runs the same first search on fresh CI installs through the Codex broker.
It never touches the nightly Search check: the profiles come from search-profiles.json, the 18 locked people (gate-personas.json) and gate.py are only read,
and the judge is gate_judge.judge() itself, given this file's profiles. No night, no Admin, no floors, no reference, no red.
Usage: profiles.py ids '<json list or empty>' | free '<json list>' <at_once> | cv <id> <out> | judge <id> <jobs.json> <judged.json> | row <id> <out> | table <dir> <out.md>
       | tell <rows.json> <run url> <message.txt>
"""
import json
import math
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROFILES = json.loads((HERE / 'search-profiles.json').read_text(encoding='utf-8'))['profiles']
IDS = [p['id'] for p in PROFILES]
# Why (12 Nov 2026, sa): a profile run shares the broker with nothing that measures: the Search check's night (the press tapes were retired 13 Nov 2026).
HOLDERS = ('search-personas.yml',)
MAX_AT_ONCE = 30   # Why (13 Nov 2026, owner: "make it very parallel" · "customizable"): any number up to all 30 at once; the room is the broker's, read per run
MINUTES_EACH = 12   # one profile job: setup ~3 min, the first press ~4.5 min (search-personas.yml header), the judge 1-2 min, with room
NIGHT_UTC = (0, 0)   # app-core/src/scheduler.js SEARCH_SLOT: the Worker starts the night at 00:00 UTC
BOARD = re.compile(r'Job boards found: (.+?) (\d+) job\(s\), (\d+) relevant')
RAN_OUT = re.compile(r'Time is up \([^)]*\) for ([^:]+):|No time left in this refresh for these: \d+ (\w+)')
ENGINE = re.compile(r'^AI: (\S+)(?: / (\S+))?', re.M)


def profile(pid):
    """The profile row of an id; ValueError for an id that is not one of the 30."""
    for p in PROFILES:
        if p['id'] == pid:
            return p
    raise ValueError(f'{pid!r} is not one of the profiles in search-profiles.json')


def ids(given):
    """The run's ids as `profiles=<json>`: the given JSON list (each checked), or all 30 when empty."""
    chosen = json.loads(given) if given.strip() else IDS
    for pid in chosen:
        profile(pid)
    return 'profiles=' + json.dumps(chosen)


def busy(run_list=None):
    """The holder workflows with a run queued or in progress, read with gh (actions: read); an unreadable list counts as busy."""
    run_list = run_list or (lambda wf: subprocess.run(['gh', 'run', 'list', '--workflow', wf, '--limit', '20', '--json', 'status'],
                                                      capture_output=True, text=True, check=True).stdout)
    held = []
    for wf in HOLDERS:
        try:
            runs = json.loads(run_list(wf))
        except (subprocess.CalledProcessError, ValueError, OSError):
            held.append(f'{wf} (its runs could not be read)')
            continue
        if any(r.get('status') in ('queued', 'in_progress', 'waiting', 'pending', 'requested') for r in runs):
            held.append(wf)
    return held


def free(chosen, at_once, now=None, run_list=None):
    """(ok, why): no holder runs, and the run's estimate ends before the night's 00:00 UTC start. Invariant: never ok while a holder is queued or running."""
    now = now or datetime.now(timezone.utc)
    if not 1 <= at_once <= MAX_AT_ONCE:
        return False, f'at_once {at_once} is outside 1-{MAX_AT_ONCE}: not run'
    held = busy(run_list)
    if held:
        return False, 'the broker is held by ' + ', '.join(held) + ': not run, start it again when they end'
    minutes = math.ceil(len(chosen) / max(1, at_once)) * MINUTES_EACH
    night = now.replace(hour=NIGHT_UTC[0], minute=NIGHT_UTC[1], second=0, microsecond=0)
    night += timedelta(days=1) if night <= now else timedelta(0)
    if now + timedelta(minutes=minutes) >= night:
        return False, f'about {minutes} min from {now:%H:%M} UTC would reach the night at 00:00 UTC: not run, start it after the night or with fewer profiles'
    return True, f'no night or tape on the broker; about {minutes} min, done before 00:00 UTC'


def cv(pid, out):
    """The profile's fictional CV through the random draw's own template (draw.cv), with its own city row (two cities are not in draws.json)."""
    sys.path.insert(0, str(HERE))
    import draw  # noqa: PLC0415
    from personas import pdf  # noqa: PLC0415
    p = profile(pid)
    family = next(f for f in draw.DATA['families'] if f['id'] == p['family'])
    lines = draw.cv(family, {k: p[k] for k in ('city', 'country', 'language')}, 'Alex Example')
    folder = Path(out) / 'draw'
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'cv.pdf').write_bytes(pdf(lines))
    (folder / 'cv.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    (folder / 'draw.json').write_text(json.dumps({'seed': f'profiles-{pid}', 'family': p['family'], 'city': p['city'], 'country': p['country']}), encoding='utf-8')


def judge(pid, jobs_path, out):
    """The blind judge itself (gate_judge.judge: the locked prompt, 3 answers, the majority), given this profile instead of a night person."""
    sys.path.insert(0, str(HERE))
    import gate_judge  # noqa: PLC0415
    gate_judge.PERSONAS = PROFILES   # judge(n) reads PERSONAS[n - 1]; the night's list is not changed on disk
    pool = json.loads(Path(jobs_path).read_text(encoding='utf-8'))
    verdict = gate_judge.judge(IDS.index(pid) + 1, pool)
    Path(out).write_text(json.dumps(verdict, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f"{pid}: judged {verdict['judged_jobs']} distinct jobs, {sum(r['role'] == 'yes' and r['place'] == 'yes' for r in verdict['rows'])} right role and place")


def target(relevant, eures):
    """'meets' (N >= X), 'below' or 'not measured' (X = 0 or missing). Why (13 Nov 2026, sa: the Trello board's rule, owner: "Keep EURES as X, ours without it"): X = 0 is never a pass."""
    if not eures:
        return 'not measured'
    return 'meets' if relevant >= eures else 'below'


def _when(text):
    try:
        return datetime.fromisoformat(text.replace('Z', '+00:00'))
    except (AttributeError, ValueError):
        return None


def row(pid, out):
    """One table row from the profile's folder: relevant, shown (open jobs, as the Mac round counted), first relevant at, boards, what ran out of time, the AIs and the commit."""
    out = Path(out)
    p = profile(pid)
    read = lambda name: (out / name).read_text(encoding='utf-8', errors='replace') if (out / name).exists() else ''   # noqa: E731
    result = {'id': pid, 'city': p['city'], 'title': p['title'], 'commit': os.environ.get('GITHUB_SHA', '')[:9]}
    if (out / 'not-run.txt').exists():
        return {**result, 'not_run': read('not-run.txt').strip()}
    judged = json.loads(read('judged.json') or 'null')
    if not judged:
        return {**result, 'not_measured': 'the press or the judge wrote no result (see run.log, judge.log)'}
    rows = judged['rows']
    right = [r for r in rows if r.get('role') == 'yes' and r.get('place') == 'yes']
    press = json.loads((read('draw/presses.jsonl').splitlines() or ['{}'])[0])
    started = _when(press.get('started'))
    seen = [t for t in (_when(r.get('first_seen')) for r in right) if t]
    log = '\n'.join(read(f'draw/{f.name}') for f in sorted((out / 'draw').glob('run-*.log')))
    boards = BOARD.findall(log)
    ran_out = sorted({(a or b).strip() for a, b in RAN_OUT.findall(log)})
    engines = sorted({' / '.join(x for x in m if x) for m in ENGINE.findall(read('run.log'))})
    return {**result, 'relevant': len(right), 'shown': len(rows), 'seconds': press.get('seconds'),
            'first_relevant_s': round((min(seen) - started).total_seconds()) if seen and started else None,
            'boards_read': len(boards), 'boards_with_relevant': sum(int(n) > 0 for _, _, n in boards), 'time_ran_out_for': ran_out,
            'engine': (', '.join(engines) or 'not said') + (' (no renderer)' if (out / 'no-renderer.txt').exists() else ''), 'judge': ', '.join((judged.get('agreement') or {}).get('ai') or []) or 'not said',
            'judge_tier': judged.get('tier', 'small'), 'eures': p.get('eures', 0), 'target': target(len(right), p.get('eures', 0))}


def table(folder, out):
    """The run's table (markdown) from every profile's row.json under the folder, in id order; also written as rows.json beside it."""
    rows = sorted((json.loads(f.read_text(encoding='utf-8')) for f in Path(folder).rglob('row.json')), key=lambda r: r['id'])
    commits = sorted({r['commit'] for r in rows if r.get('commit')})
    lines = [f'## Search profiles on CI · {len(rows)} profiles · one run each · commit {", ".join(commits) or "?"}',
             'CI rows (Codex through the broker, fresh installs, EURES off): a new series, never mixed with the Mac rows of 12 Nov 2026.', '',
             '| id | city | role | relevant | EURES (X) | target | shown | first relevant at | boards read / with relevant | time ran out for | engine | judge |',
             '|---|---|---|---|---|---|---|---|---|---|---|---|']
    for r in rows:
        if 'relevant' not in r:
            lines.append(f"| {r['id']} | {r['city']} | {r['title']} | {r.get('not_run') or r.get('not_measured')} | | | | | | | | |")
            continue
        first = f"{r['first_relevant_s']} s" if r['first_relevant_s'] is not None else '—'
        lines.append(f"| {r['id']} | {r['city']} | {r['title']} | {r['relevant']} | {r.get('eures') or '—'} | {r.get('target', '—')} | {r['shown']} | {first} | {r['boards_read']} / {r['boards_with_relevant']} | "
                     f"{', '.join(r['time_ran_out_for']) or '—'} | {r['engine']} | {r['judge']} ({r['judge_tier']}) |")
    Path(out).write_text('\n'.join(lines) + '\n', encoding='utf-8')
    (Path(out).parent / 'rows.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding='utf-8')


def tell(rows_path, url, out):
    """The run's one Telegram text (sent by desktop/e2e/tell-owner.mjs --event search-profiles): the owner's goal first, how many got 0 right jobs, then how many meet N >= X, then the link.
    Why (13 Nov 2026, sa for the owner: "<k> of 30 got 0 right jobs", then "<m> meet target (N >= X)", then the link): a row not run or not measured is counted apart, never as 0."""
    rows = json.loads(Path(rows_path).read_text(encoding='utf-8')) if Path(rows_path).exists() else []
    measured = [r for r in rows if 'relevant' in r]
    if not measured:   # Why (13 Nov 2026, Gitar on #3945): "0 of 0 got 0 right jobs" reads as a clean run; nothing measured is said as such
        lines = [f'🧪 Search profiles on CI · nothing measured ({len(rows)} profile{"" if len(rows) == 1 else "s"}: ' + (', '.join(r.get('id', '?') for r in rows) or 'no rows') + ')', url]
        Path(out).write_text('\n'.join(lines) + '\n', encoding='utf-8')
        return lines
    zero = sum(r['relevant'] == 0 for r in measured)
    meets = sum(r.get('target') == 'meets' for r in measured)
    judged = sum(r.get('target') in ('meets', 'below') for r in measured)
    lines = [f'🧪 Search profiles on CI · {len(measured)} of {len(rows)} measured',
             f'{zero} of {len(measured)} got 0 right jobs',
             f'{meets} of {judged} meet target (N ≥ X, X = EURES)' + (f' · {len(measured) - judged} without an X' if len(measured) > judged else '')]
    if len(rows) > len(measured):
        lines.append(f'{len(rows) - len(measured)} not run or not measured: ' + ', '.join(r.get('id', '?') for r in rows if 'relevant' not in r))
    lines.append(url)
    Path(out).write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return lines


def main(argv):
    command, args = argv[0], argv[1:]
    if command == 'ids':
        print(ids(args[0] if args else ''))
    elif command == 'free':
        n = float(args[1])   # a number input may arrive as '6' or '6.0'
        if n != int(n):   # Why (13 Nov 2026, Gitar on #3964): 2.5 would pass here as 2 while max-parallel got 2.5; the check and the matrix see one whole number
            print(f'at_once {args[1]} is not a whole number: not run')
            sys.exit(1)
        ok, why = free(json.loads(args[0]), int(n))
        print(why)
        sys.exit(0 if ok else 1)
    elif command == 'cv':
        cv(*args[:2])
    elif command == 'judge':
        judge(*args[:3])
    elif command == 'row':
        result = row(*args[:2])
        (Path(args[1]) / 'row.json').write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False))
    elif command == 'table':
        table(*args[:2])
    elif command == 'tell':
        print('\n'.join(tell(*args[:3])))
    else:
        raise SystemExit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
