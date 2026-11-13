"""A Find jobs PR's before/after pair on CI: main and the PR searched in the same minute for the people named, judged by the same blind judge, one table on the PR.
Owner, 13 Nov 2026 (asked via AskUserQuestion by sa: "Self-serve workflow + tighter check (Recommended)"): "But why sessions don't know to do this by themselves. No skill is
telling them to do this. No PR CI guardrail is requested them a before/after". Run by .github/workflows/search-pair.yml; fictional people only (the 18 night people p<n>,
tools/persona-search/gate-personas.json, and the profiles, search-profiles.json), plan AI through the broker only.
  pair.py people '<json list>' <changed-files>   -> people=<json> for the matrix (each: id, kind, runs, own_draft), need=<searches at once> for claim.py
  pair.py side <out> <side>                      -> <out>/side.json: right jobs, found, first relevant, board words, broker waits, valid
  pair.py minutes <times.env> <person> <out>     -> <out>/<person>.minutes.txt: minutes per part (setup, draft, searches, judge)
  pair.py table <results> <pr> <main sha> <pr sha> -> the PR comment's markdown on stdout
  pair.py pending < body                         -> the people of the body's "→ pending" Moves lines as a dispatch list ([1, "b02"]), nothing when none (tools/ship-search-hold.sh)
  pair.py row <results> <people> <attempt> <newer 0|1> -> row.json: the "Search before/after" check run's conclusion, title and summary, and the people to run once more (pair_row.py)
  pair.py settle <results> <view.json> <attempt> <people> -> settle.json: the body with the numbers written, the title (hold lifted or kept), the people to run again, the verdict
"""
import json
import math
import os
import re
import statistics
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pair_row  # noqa: E402 — beside this file, run as a script by search-pair.yml
NIGHT = 18   # the night's people p1..p18 (gate-personas.json)
MAX_PEOPLE = 3   # a dispatch's people (sa, 13 Nov 2026: "<=3 people per dispatch is right")
# The files that write a person's search words before any search (the strategy draft): a PR touching one drafts per side and runs 2 searches a side for each person,
# since one draft a side cannot tell the change from the draft's own luck (13 Nov 2026: Sofia's board words were English in one draft and Bulgarian in the next, same code).
DRAFT_PRODUCERS = re.compile(r'^(desktop/lib/strategy(-draft[^/]*)?\.js|src/ai/board_ideas\.py|src/sources/(boards|board_terms)\.py)$')   # the proposal's files too: a PR that changes what boards are proposed is measured with a proposal per side
VALID_P90_MS = 20000   # sa's rule (13 Nov 2026): a side whose broker wait p90 is over ~20 s is not valid, shown but not counted


def _profiles():
    """The profile ids (profiles.IDS, from search-profiles.json)."""
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


def need(chosen):
    """Searches the pair runs at once at the broker (its claim, tools/persona-search/claim.py): main and the PR side by side for each person, rounds one after another."""
    return 2 * len(chosen)


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
           'shared': not (out / 'boards-not-shared').exists(),   # the workflow marks a side whose draft install had no board proposal (run.mjs --propose failed): it asked for itself
           'valid': bool(calls) and p90 is not None and p90 <= VALID_P90_MS and right is not None and not (out / 'boards-not-shared').exists()}
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
    return floors.spread_of(levels, floors.NUMBERS['right'][2]) if len(levels) >= 5 else None   # the number's own least spread (1): max() never sees None


def _cell(rows, key, fmt=str):
    """One table cell: each run's value, ' / ' between runs, '—' for none."""
    return ' / '.join('—' if r.get(key) is None else fmt(r[key]) for r in rows) or '—'


def _wait(row):
    """A run's broker wait as 'p50/p90' in seconds."""
    secs = lambda ms: '—' if ms is None else f'{ms / 1000:.0f}'   # noqa: E731
    return f"{secs(row.get('wait_p50_ms'))}/{secs(row.get('wait_p90_ms'))}"


def sides(results):
    """{person: {'main': [rows], 'pr': [rows]}} from <results>/*/side.json."""
    out = {}
    for found in sorted(Path(results).glob('*/side.json')):
        row = json.loads(found.read_text(encoding='utf-8'))
        out.setdefault(found.parent.name.split('--')[0], {'main': [], 'pr': []})[row['side']].append(row)
    return out


def measured(people_rows, spread=usual):
    """{person: {before, after, d, line}} for each person whose every side is valid; the Moves line is the one the PR check reads."""
    out = {}
    for person, sides_ in sorted(people_rows.items()):
        a, b = sides_['main'], sides_['pr']
        if not (a and b and all(r['valid'] for r in a + b)):
            continue
        d = spread(person)
        before, after = statistics.median(r['right'] for r in a), statistics.median(r['right'] for r in b)
        runs = f'{len(a)} run{"s" if len(a) > 1 else ""} a side, same minute'
        out[person] = {'before': before, 'after': after, 'd': d, 'line': f'Moves: {person} right jobs {before:g} → {after:g} ({runs}, usual difference '
                                                                       + (f'{d:g})' if d is not None else 'not measured yet)')}
    return out


def table(results, pr, main_sha, pr_sha, spread=usual):
    """The PR comment: per person both sides, a ready Moves line when both sides are valid, and the minutes per part."""
    results, lines = Path(results), []
    people_rows = sides(results)
    lines += ['<!-- search-pair -->', f'### Before/after: main `{main_sha[:8]}` (the commit the PR sits on) vs #{pr} `{pr_sha[:8]}`, same minute', '',
              '| Person | Right jobs main → PR | Found | First relevant (s) | First 2 board words (main · PR) | Broker wait p50/p90 (s) | Valid |',
              '|---|---|---|---|---|---|---|']
    done = measured(people_rows, spread)
    for person, sides_ in sorted(people_rows.items()):
        a, b = sides_['main'], sides_['pr']
        lines.append(f"| {person} | {_cell(a, 'right')} → {_cell(b, 'right')} | {_cell(a, 'found')} → {_cell(b, 'found')} | {_cell(a, 'first_s')} → {_cell(b, 'first_s')} "
                     f"| {'; '.join(', '.join(r['words']) or '—' for r in a)} · {'; '.join(', '.join(r['words']) or '—' for r in b)} "
                     f"| {' / '.join(_wait(r) for r in a + b)} "
                     f"| {'yes' if person in done else '**no**: not counted'} |")
    if not people_rows:
        lines.append('| — | no side ran (the turn gave up, or a side failed before its search) | | | | | **no** |')
    lines.append('')
    drafts = {r.get('own_draft') for r in (json.loads(p.read_text()) for p in results.glob('*/person.json'))}
    lines.append('Each side drafted its own search plan and searched twice: this PR changes the plan\'s producer.' if True in drafts
                 else 'Same draft both sides: one search plan per person, made once, searched by main and the PR at the same minute.')
    lines.append(f'A side whose broker wait p90 is over {VALID_P90_MS // 1000} s is not valid: shown, not counted (start the pair again).')
    if any(r.get('shared') is False for rows in people_rows.values() for r in rows['main'] + rows['pr']):
        lines.append("The draft's board proposal failed, so each side asked for its own boards: not counted (start the pair again).")
    timed = [p.read_text(encoding='utf-8').strip() for p in sorted(results.glob('*.minutes.txt'))]
    if timed:
        lines += ['', 'Minutes per part: ' + '; '.join(timed)]
    if done:
        lines += ['', 'Paste into the PR body (the PR check reads it):', '```', *(m['line'] for m in done.values()), '```']
    return '\n'.join(lines)


# The hold (plan docs/superpowers/plans/2026-11-13-search-pair.md 4/4; owner via sa, 13 Nov 2026: "we shoulndt do  by hand"): a "→ pending" Moves line makes ship hold the PR
# (draft, "DONT MERGE" in its title, label HOLD_LABEL) and start this pair; the pair writes the numbers and lifts ONLY the hold ship set (the label), when no person fell
# beyond their usual difference (7 jobs when it is not measured yet). A side not valid runs once more, then the pair reports and the hold stays.
HOLD_LABEL = 'search-hold'
PENDING_LINE = r'^(?P<lead>[ \t]*[-*]?[ \t]*)\**Moves:\**[ \t]*(?P<person>{person})\s+\S.*\d\S*\s*(?:→|->)\s*pending\s*\(.*$'   # the shape tools/pr-body-check.py PENDING reads


def pending(body):
    """The people of the body's pending Moves lines as a dispatch list: night people as numbers, profiles as ids; [] when none."""
    out = []
    for person in (m.group('person') for m in re.finditer(PENDING_LINE.format(person=r'p\d{1,2}|[a-z]\d{2}'), body or '', re.M)):
        one = int(person[1:]) if re.fullmatch(r'p\d{1,2}', person) else person
        if one not in out:
            out.append(one)
    return out[:MAX_PEOPLE]


def settle(body, title, labels, done, ran, attempt, seen=None):
    """What the pair does to its PR: {body, title, lift, verdict}. done: measured(); ran: the people dispatched (ids); attempt: 1 or 2;
    seen: the people with any side that ran (default: ran), so a person whose search never started (the turn gave up) is not "not valid" and is not run again."""
    body, verdict, fell = body or '', [], []
    seen = set(ran if seen is None else seen)
    for person, m in done.items():
        body = re.sub(PENDING_LINE.format(person=re.escape(person)), lambda hit, line=m['line']: hit.group('lead') + line, body, flags=re.M)   # the bullet stays
        tolerance = pair_row.band(m['d'])   # Why (13 Nov 2026, sa): 7 jobs while unmeasured, not 1: run 43498213279 gave 8 vs 15 for the same code (pair_row.py)
        if m['before'] - m['after'] > tolerance:
            fell.append(f"{person} fell {m['before']:g} → {m['after']:g} ("
                        + (f"usual difference {tolerance:g})" if m['d'] is not None else f'usual difference not measured yet: {pair_row.UNMEASURED_BAND} jobs allowed)'))
    invalid = [p for p in ran if p in seen and p not in done]
    never = [p for p in ran if p not in seen]
    ours = HOLD_LABEL in labels
    # Why (13 Nov 2026, #3946 then #4044: a by-hand pair queued a third run on main's workflow by itself; since 1/3 every pair runs once more by itself through its row): settle only words the verdict.
    # Why (Gitar on #4044): the run again is decided once, by pair_row.decide (every PR, once; owner via sa, 13 Nov 2026); this only words the verdict, and 3/3 deletes the hold path.
    again = bool(ours and invalid and attempt < 2 and not fell)
    still = pending(body)
    # Why (Gitar on #3967): the label is ship's hold; a PR retitled by hand keeps it until the numbers are in, then loses it with no title change.
    lift = ours and not fell and not still and not invalid and not never
    head = 'Hold kept' if ours else 'Not held by ship (no "search-hold" label)'
    if lift:
        title = re.sub(r'\s*DONT MERGE\s*', ' ', title, count=1).strip()
        verdict.append('Hold lifted: every pending number is in and none fell beyond its usual difference; the PR is marked ready at READY.')
    elif fell:
        verdict.append(f'{head}: ' + '; '.join(fell) + '. Name the cause in the PR, or fix it and ship again.')
    elif never:
        verdict.append(f"{head}: {', '.join(never)} never searched (the turn found no room at the broker, or the run failed first): start the pair again later.")
    elif again:
        verdict.append(f"Hold kept: {', '.join(invalid)} not valid; the pair runs once more for them.")
    elif invalid:
        verdict.append(f"{head}: {', '.join(invalid)} not valid" + (' twice' if ours else '') + ': start the pair again later, or write the number by hand.')
    elif still and ours:
        verdict.append('Hold kept: the body still has a pending number this pair did not run.')
    elif not ours and done and 'DONT MERGE' in title:
        verdict.append('Numbers written. The hold was not set by ship (no "search-hold" label): lift it by hand.')
    return {'body': body, 'title': title, 'lift': lift, 'verdict': verdict}


def main(argv):
    """The command line above."""
    command = argv[1] if len(argv) > 1 else ''
    if command == 'people' and len(argv) == 4:
        changed = Path(argv[3]).read_text(encoding='utf-8').split() if Path(argv[3]).exists() else []
        chosen = people(argv[2], changed)
        print('people=' + json.dumps(chosen))
        print(f'need={need(chosen)}')
        return 0
    if command == 'side' and len(argv) == 4:
        side(argv[2], argv[3])
        return 0
    if command == 'minutes' and len(argv) == 5:
        minutes(argv[2], argv[3], argv[4])
        return 0
    if command == 'table' and len(argv) == 6:
        print(table(argv[2], argv[3], argv[4], argv[5]))
        return 0
    if command == 'pending' and len(argv) == 2:
        found = pending(sys.stdin.read())
        if found:
            print(json.dumps(found))
        return 0
    if command == 'row' and len(argv) == 6:   # people: the dispatched ids as json
        rows = sides(argv[2])
        ran = sorted(set(json.loads(argv[3])), key=str)
        done = measured(rows)
        out = pair_row.decide(done, ran, set(rows), {person: usual(person) for person in done}, int(argv[4]), rows, newer_head=argv[5] == '1')
        out['rerun'] = [int(p[1:]) if re.fullmatch(r'p\d{1,2}', p) else p for p in out['rerun']]   # the dispatch's own form: night people as numbers, profiles as ids
        Path('row.json').write_text(json.dumps({key: pair_row.safe(value) if isinstance(value, str) else value for key, value in out.items()}), encoding='utf-8')
        print(out['title'])
        return 0
    if command == 'settle' and len(argv) == 6:   # people: setup's matrix entries (each its id)
        view = json.loads(Path(argv[3]).read_text(encoding='utf-8'))
        ran = [entry['id'] for entry in json.loads(argv[5])]
        rows = sides(argv[2])
        out = settle(view.get('body'), view.get('title') or '', [label['name'] for label in view.get('labels') or []], measured(rows), sorted(set(ran)), int(argv[4]), seen=set(rows))
        Path('settle.json').write_text(json.dumps(out), encoding='utf-8')
        print('\n'.join(out['verdict']))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
