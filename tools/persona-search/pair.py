"""A Find jobs PR's before/after pair on CI: main and the PR searched in the same minute for the people named, judged by the same blind judge, one table on the PR.
Owner, 13 Nov 2026 (asked via AskUserQuestion by sa: "Self-serve workflow + tighter check (Recommended)"): "But why sessions don't know to do this by themselves. No skill is
telling them to do this. No PR CI guardrail is requested them a before/after". Run by .github/workflows/search-pair.yml; fictional people only (the 18 night people p<n>,
tools/persona-search/gate-personas.json, and the 30 profiles, search-profiles.json), plan AI through the broker only.
  pair.py people '<json list>' <changed-files>   -> people=<json> for the matrix (each: id, kind, runs, own_draft)
  pair.py turn                                   -> waits until the broker has room for one more pair (exit 0), or says why not (exit 1)
  pair.py side <out> <side>                      -> <out>/side.json: right jobs, found, first relevant, board words, broker waits, valid
  pair.py minutes <times.env> <person> <out>     -> <out>/<person>.minutes.txt: minutes per part (setup, draft, searches, judge)
  pair.py table <results> <pr> <main sha> <pr sha> -> the PR comment's markdown on stdout
"""
import json
import math
import os
import re
import statistics
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
NIGHT = 18   # the night's people p1..p18 (gate-personas.json)
MAX_PEOPLE = 3   # a dispatch's people (sa, 13 Nov 2026: "<=3 people per dispatch is right")
# The files that write a person's search words before any search (the strategy draft): a PR touching one drafts per side and runs 2 searches a side for each person,
# since one draft a side cannot tell the change from the draft's own luck (13 Nov 2026: Sofia's board words were English in one draft and Bulgarian in the next, same code).
DRAFT_PRODUCERS = re.compile(r'^desktop/lib/strategy(-draft[^/]*)?\.js$')
BROKER = 'https://jobadabra-ai-broker.jobpilotto.workers.dev/health'
# Why (13 Nov 2026, as-ai-startup-34's 15 s log of /health, replayed): starvation = waiting > 0 at active 16 held over a minute; the clean pair of 00:44 ran at active 7-15.
# Admit when 8 readings 15 s apart all have nothing waiting and their median active is at most ADMIT_ACTIVE (a pair adds ~12 of the 16 slots).
READINGS, EVERY_S, ADMIT_ACTIVE = 8, 15, 10
SETTLE_S = 240   # another pair admitted this recently has not shown its load in /health yet: wait
TURN_MINUTES = 55
NIGHT_STOP = (23, 35)   # the Worker starts the night at 00:00 UTC (profiles.NIGHT_UTC): no pair starts after this
HOLDERS = ('search-personas.yml', 'press-tapes.yml', 'press-tapes-auto.yml', 'search-profiles.yml')
VALID_P90_MS = 20000   # sa's rule (13 Nov 2026): a side whose broker wait p90 is over ~20 s is not valid, shown but not counted


def _profiles():
    """The 30 profile ids (profiles.IDS, from search-profiles.json)."""
    sys.path.insert(0, str(HERE))
    import profiles  # noqa: PLC0415
    return list(profiles.IDS)


def people(given, changed):
    """The people of a dispatch as matrix entries. given: a JSON list of night numbers (1-18) and profile ids ("b02"); changed: the PR's changed files."""
    chosen = json.loads(given)
    if not isinstance(chosen, list) or not 1 <= len(chosen) <= MAX_PEOPLE:
        raise ValueError(f'people: a JSON list of 1 to {MAX_PEOPLE}, such as [3] or [3, "b02"]')
    own = any(DRAFT_PRODUCERS.match(path) for path in changed)
    out, ids = [], _profiles()
    for one in chosen:
        if isinstance(one, int) and 1 <= one <= NIGHT:
            out.append({'id': f'p{one}', 'kind': 'night', 'n': one})
        elif isinstance(one, str) and one in ids:
            out.append({'id': one, 'kind': 'profile', 'n': ids.index(one) + 1})
        else:
            raise ValueError(f'{one!r} is neither a night person (1-{NIGHT}) nor a profile id of search-profiles.json')
    for entry in out:
        entry.update(own_draft=own, runs=2 if own else 1)
    return out


def health(read=None):
    """(active, waiting) from the broker's public /health `queue` (waiting summed over its lanes); None when unreadable."""
    try:
        data = read() if read else json.loads(urllib.request.urlopen(BROKER, timeout=20).read())
        queue = data['queue']
        return int(queue['active']), sum(int(v) for v in (queue.get('waiting') or {}).values())
    except (OSError, ValueError, KeyError, TypeError):
        return None


def room(readings):
    """(ok, why) for one window of /health readings: all read, nothing waiting, median active at most ADMIT_ACTIVE."""
    if len(readings) < READINGS or any(r is None for r in readings):
        return False, 'the broker could not be read on every reading'
    if any(waiting for _, waiting in readings):
        return False, f'calls were waiting at the broker ({max(w for _, w in readings)} at most)'
    middle = statistics.median(active for active, _ in readings)
    return (True, f'nothing waiting, median {middle:g} of 16 slots busy') if middle <= ADMIT_ACTIVE else (False, f'median {middle:g} of 16 slots busy (line {ADMIT_ACTIVE})')


def _gh(*args):
    """gh's JSON answer for these arguments (raises on a failed call)."""
    return json.loads(subprocess.run(['gh', *args], capture_output=True, text=True, check=True, timeout=60).stdout or 'null')


def held(me=None):
    """What holds the broker for a pair now: a holder workflow queued or running, or another pair admitted under SETTLE_S ago. Unreadable = held."""
    out = []
    for workflow in HOLDERS:
        try:
            if any(r['status'] != 'completed' for r in _gh('run', 'list', '--workflow', workflow, '--limit', '10', '--json', 'status')):
                out.append(workflow)
        except (subprocess.CalledProcessError, OSError, ValueError, subprocess.TimeoutExpired):
            out.append(f'{workflow} (unreadable)')
    try:
        repo = os.environ.get('GITHUB_REPOSITORY', '')
        for run in _gh('run', 'list', '--workflow', 'search-pair.yml', '--limit', '20', '--json', 'databaseId,status'):
            if run['status'] != 'in_progress' or str(run['databaseId']) == str(me):
                continue
            for job in _gh('api', f'repos/{repo}/actions/runs/{run["databaseId"]}/jobs', '--jq', '.jobs'):
                # a pair whose searches started, or whose turn ended, under SETTLE_S ago: its load is not in /health yet
                stamp = job.get('started_at') if job['name'].startswith('Pair') else job.get('completed_at') if job['name'].startswith('Wait for room') else None
                if stamp:
                    age = (datetime.now(timezone.utc) - datetime.fromisoformat(stamp.replace('Z', '+00:00'))).total_seconds()
                    if age < SETTLE_S:
                        out.append(f'pair run {run["databaseId"]} admitted {age:.0f} s ago')
                        break
    except (subprocess.CalledProcessError, OSError, ValueError, subprocess.TimeoutExpired):
        out.append('search-pair.yml (unreadable)')
    return out


def turn(now=datetime.now, sleep=time.sleep, read=None, holders=held):
    """Wait for room (exit 0) or give up after TURN_MINUTES or at the night's stop (exit 1); one line per window."""
    end = time.monotonic() + TURN_MINUTES * 60
    while time.monotonic() < end:
        clock = now(timezone.utc)
        if (clock.hour, clock.minute) >= NIGHT_STOP:
            print(f'pair: not started: {clock:%H:%M} UTC is too close to the night (00:00 UTC); start it after the night')
            return 1
        busy = holders(os.environ.get('GITHUB_RUN_ID'))
        if busy:
            print(f'pair: waiting {clock:%H:%M:%S}: the broker is held by {", ".join(busy)}', flush=True)
            sleep(60)
            continue
        readings = []
        for k in range(READINGS):
            readings.append(health(read))
            if k < READINGS - 1:
                sleep(EVERY_S)
        ok, why = room(readings)
        print(f'pair: {"admitted" if ok else "waiting"} {now(timezone.utc):%H:%M:%S}: {why}', flush=True)
        if ok:
            return 0
    print(f'pair: not started: no room at the broker in {TURN_MINUTES} min; start it again later')
    return 1


def waits(log_text):
    """(calls, failed, p50 ms, p90 ms) of a side's relay lines (codex.mjs timedRelay)."""
    lines = re.findall(r'relay: \S+ total \d+ broker \S+ waited (\S+) .*?status (\S+)', log_text)
    got = sorted(int(w) for w, status in lines if status == '200' and w != 'na')
    pick = lambda q: got[min(len(got) - 1, math.ceil(q * len(got)) - 1)] if got else None   # noqa: E731
    return len(lines), sum(1 for _, status in lines if status != '200'), pick(0.5), pick(0.9)


def board_words(run_log):
    """The first two distinct search words the job boards' rounds used (src/sources/board_round_log.py lines), in order."""
    out = []
    for word in re.findall(r"^\[\d+s\] Job boards: .*? round '([^']+)'", run_log, re.M):
        if word not in out:
            out.append(word)
    return out[:2]


def side(out, name):
    """Write <out>/side.json from the side's run.log, draw/run-1.log, jobs.json and judged.json."""
    out = Path(out)
    read = lambda p: (out / p).read_text(encoding='utf-8', errors='replace') if (out / p).exists() else ''   # noqa: E731
    relay, press = read('run.log'), read('draw/run-1.log')
    calls, failed, p50, p90 = waits(relay)
    judged = json.loads(read('judged.json') or '{}')
    right = sum(1 for r in judged.get('rows') or [] if r.get('role') == 'yes' and r.get('place') == 'yes') if judged else None
    first = re.search(r'1st/10th relevant at (\S+?)/', relay)
    row = {'side': name, 'right': right, 'found': len(json.loads(read('jobs.json') or '[]')), 'first_s': first.group(1) if first else None,
           'words': board_words(press), 'calls': calls, 'failed': failed, 'wait_p50_ms': p50, 'wait_p90_ms': p90,
           'valid': bool(calls) and p90 is not None and p90 <= VALID_P90_MS and right is not None}
    (out / 'side.json').write_text(json.dumps(row) + '\n', encoding='utf-8')
    print(json.dumps(row))


PARTS = (('setup', 'setup_start', 'draft_start'), ('draft', 'draft_start', 'press_start'), ('searches', 'press_start', 'judge_start'), ('judge', 'judge_start', 'end'))


def minutes(times, person, out):
    """Write <out>/<person>.minutes.txt: '<person>: setup 3.1 min · draft …' from the job's KEY=epoch stamps (a missing part is left out)."""
    stamps = dict(line.strip().split('=', 1) for line in Path(times).read_text(encoding='utf-8').splitlines() if '=' in line)
    parts = [f'{name} {(int(stamps[b]) - int(stamps[a])) / 60:.1f} min' for name, a, b in PARTS if a in stamps and b in stamps]
    text = f"{person}: {' · '.join(parts) or 'no part timed'}"
    Path(out).mkdir(parents=True, exist_ok=True)
    (Path(out) / f'{person}.minutes.txt').write_text(text + '\n', encoding='utf-8')
    print(text)


def usual(person):
    """The person's usual run-to-run difference in right jobs: 2 sd of the night's kept levels (floors.spread_of), or None before 5 levels or for a profile."""
    if not person.startswith('p'):
        return None
    sys.path.insert(0, str(HERE))
    import floors  # noqa: PLC0415
    try:
        _, state = floors.read_state(os.environ.get('GITHUB_REPOSITORY', 'jobadabra/jobadabra'))
    except (RuntimeError, OSError, subprocess.CalledProcessError, ValueError):
        return None
    levels = [lv for series in ((state or {}).get('series') or {}).values() for lv in ((series.get('people') or {}).get(person[1:]) or {}).get('right', {}).get('levels', [])]
    return floors.spread_of(levels, None) if len(levels) >= 5 else None


def _cell(rows, key, fmt=str):
    """One table cell: each run's value, ' / ' between runs, '—' for none."""
    return ' / '.join('—' if r.get(key) is None else fmt(r[key]) for r in rows) or '—'


def _wait(row):
    """A run's broker wait as 'p50/p90' in seconds."""
    secs = lambda ms: '—' if ms is None else f'{ms / 1000:.0f}'   # noqa: E731
    return f"{secs(row.get('wait_p50_ms'))}/{secs(row.get('wait_p90_ms'))}"


def table(results, pr, main_sha, pr_sha, spread=usual):
    """The PR comment: per person both sides, a ready Moves line when both sides are valid, and the minutes per part."""
    results, people_rows, lines = Path(results), {}, []
    for found in sorted(results.glob('*/side.json')):
        row = json.loads(found.read_text(encoding='utf-8'))
        person = found.parent.name.split('--')[0]
        people_rows.setdefault(person, {'main': [], 'pr': []})[row['side']].append(row)
    lines += ['<!-- search-pair -->', f'### Before/after: main `{main_sha[:8]}` vs #{pr} `{pr_sha[:8]}`, same minute', '',
              '| Person | Right jobs main → PR | Found | First relevant (s) | First 2 board words (main · PR) | Broker wait p50/p90 (s) | Valid |',
              '|---|---|---|---|---|---|---|']
    moves = []
    for person, sides in sorted(people_rows.items()):
        a, b = sides['main'], sides['pr']
        lines.append(f"| {person} | {_cell(a, 'right')} → {_cell(b, 'right')} | {_cell(a, 'found')} → {_cell(b, 'found')} | {_cell(a, 'first_s')} → {_cell(b, 'first_s')} "
                     f"| {'; '.join(', '.join(r['words']) or '—' for r in a)} · {'; '.join(', '.join(r['words']) or '—' for r in b)} "
                     f"| {' / '.join(_wait(r) for r in a + b)} "
                     f"| {'yes' if a and b and all(r['valid'] for r in a + b) else '**no**: not counted'} |")
        if a and b and all(r['valid'] for r in a + b):
            d = spread(person)
            before, after = statistics.median(r['right'] for r in a), statistics.median(r['right'] for r in b)
            runs = f'{len(a)} run{"s" if len(a) > 1 else ""} a side, same minute'
            moves.append(f'Moves: {person} right jobs {before:g} → {after:g} ({runs}, usual difference {d:g})' if d is not None
                         else f'Moves: {person} right jobs {before:g} → {after:g} ({runs}, usual difference not measured yet)')
    lines.append('')
    drafts = {r.get('own_draft') for r in (json.loads(p.read_text()) for p in results.glob('*/person.json'))}
    lines.append('Each side drafted its own search plan and searched twice: this PR changes the plan\'s producer.' if True in drafts
                 else 'Same draft both sides: one search plan per person, made once, searched by main and the PR at the same minute.')
    lines.append(f'A side whose broker wait p90 is over {VALID_P90_MS // 1000} s is not valid: shown, not counted (start the pair again).')
    timed = [p.read_text(encoding='utf-8').strip() for p in sorted(results.glob('*.minutes.txt'))]
    if timed:
        lines += ['', 'Minutes per part: ' + '; '.join(timed)]
    if moves:
        lines += ['', 'Paste into the PR body (the PR check reads it):', '```', *moves, '```']
    return '\n'.join(lines)


def main(argv):
    """The command line above."""
    command = argv[1] if len(argv) > 1 else ''
    if command == 'people' and len(argv) == 4:
        changed = Path(argv[3]).read_text(encoding='utf-8').split() if Path(argv[3]).exists() else []
        print('people=' + json.dumps(people(argv[2], changed)))
        return 0
    if command == 'turn':
        return turn()
    if command == 'side' and len(argv) == 4:
        side(argv[2], argv[3])
        return 0
    if command == 'minutes' and len(argv) == 5:
        minutes(argv[2], argv[3], argv[4])
        return 0
    if command == 'table' and len(argv) == 6:
        print(table(argv[2], argv[3], argv[4], argv[5]))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
