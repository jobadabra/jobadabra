"""The yardstick's verdict: what the replay shows a search PR lost (a source main reads is no longer read, or a person's right jobs fall below main's
normal range). It is a report on the PR, never a red check.
Why (12 Nov 2026, owner, asked via AskUserQuestion by sa: "Report only, live decides (Recommended)", replacing 11 Nov "Yes, block the PR"): that day the
replay measured 3 of 18 people (each merged search change ages the recordings), read "no person below main's range" on #3891 while the live proof showed
a person's right jobs 223 -> 192 (answers replay at the recorded pace, so a slower AI call is invisible here), and had held PRs for a gap main's own replay
showed (#3889). The live proof, 3 searches a side, is the verdict of a search PR; "once an improvement made, it will never be overwrite" (owner, 11 Nov
2026) is held there. A loss named below is a reason to run that proof on the person named, never a pass or a block by itself.
  python3 tools/press-yardstick/verdict.py suspects <art> <out> <recordings> <again>   the people to replay twice more -> <again>/p<N> (their recordings), prints count=N
  python3 tools/press-yardstick/verdict.py final <art> <out> <recordings>              the verdict: markdown on stdout, at the top of <out>/summary.md; always exit 0
Each person and Find jobs run reads one state, in this order (the one owner of these states):
  not measured (never red): no recording; main's band built on another recording; a press failed or a replay left no jobs on a side; a clock cliff on main's
    own band (its replays disagree: some read 0 right jobs or skip a lane, others not); main's side asks beyond the recording's bounds (re-record, said loudly).
  recording too old for this PR: only the PR side asks beyond the bounds (ci.py report_gap) while main's stays within them, in all 3 pairs (too_old); the PR
    changed the path. Named, never "worse": the replay cannot judge it, so the report asks for a live `Moves:` line (numbers, 3 runs a side).
    Re-recorded after the merge.
    Not held when main's own extra replay beside the 2 repeat pairs (CONTROLS) asks beyond the bounds too: then it is the replay's place, and the person is
    not measured (by_place).
  lost a source: a lane of src/sources/reader_rows.py LANES (main's file, looped) that ran, or read jobs, in all of main's band replays and in main's replay
    here, and on the PR side did not run or read 0 jobs. eures counts only on a tape recorded with it on.
  fewer right jobs: the person's coverage reads "worse" (three_numbers.person_verdict: beyond one job and beyond the person's 2-sd band).
A loss is named only when all 3 pairs (main and PR replayed side by side, 3 times) show it: the suspects step replays the person twice more, once, never a
4th time. Why (cr, 11 Nov 2026, sa's design): a replay runs on the runner's wall clock, so load moves one read across the 180 s cut and flips a whole
person (p5 92% -> 0% on #3777, which changed no src). That is a symptom: lanes (sf 3/5, 4/5) end the single queue that turns one late read into a lost
person, and a replay clock that does not follow the runner's load is the second real fix (Work board draft).
Lowering a bar: a `Floor-change: "<owner's words>"` line of the PR body (tools/persona-search/floors.py floor_change_words, the floors' one reader).
Guard: tests/tooling/ci/test_press_verdict.py."""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PAIRS = (('main', 'pr'), ('main-2', 'pr-2'), ('main-3', 'pr-3'))   # always 3, never a 4th
# Why (12 Nov 2026, owner, asked via AskUserQuestion by sa: "Main twice as control (Recommended)"): on #3878 and #3883, whose changes no replayed search runs, the PR
# side of one person asked beyond the recording in 4 pairs of 4 while main's side did not. main replayed once more beside each repeat pair (after the PR side
# in pair 2, in the PR side's place in pair 3) says whether the replay's place makes that difference, or the PR's code.
CONTROLS = ('ctl-2', 'ctl-3')
PLACE = "the replay's place, not this PR (main's extra replay asks beyond the recording too)"
AGAIN_SIDES = {'main-2': 'sides/main', 'pr-2': 'sides/pr', 'main-3': 'sides/main', 'pr-3': 'sides/pr'}


def _load(name, path):
    """A module from a file path (the tools here are scripts, not a package)."""
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ci = _load('press_yardstick_ci', HERE / 'ci.py')
numbers = ci.numbers


def lanes(main_root=None):
    """The lane ids of main's LANES (sides/main/src/sources/reader_rows.py in the workflow, else this checkout's): a new lane joins the verdict there."""
    found = next((p for p in (Path(main_root or 'sides/main') / 'src/sources/reader_rows.py', ROOT / 'src/sources/reader_rows.py') if p.exists()))
    return [lane.id for lane in _load('reader_rows_main', found).LANES]


RESOLUTION = 0.1   # seconds: step_yield rounds a step's wall time to this (src/press/step_yield.py _seconds)


def lane_yield(art, persona, side):
    """{run: {step: (ran, jobs)}} from the replay's presses.jsonl (funnel.step_yield, src/press/step_yield.py); {} when the replay left none.
    ran: 1 when the step's seconds are more than RESOLUTION, the one rule the pair check and the band both read.
    Why (12 Nov 2026, #3859 red on unchanged search code): "ran" was `seconds > 0`, and the seconds are wall time rounded to 0.1 s, so a step that answers
    from the recording in 0.04 s read as "did not run" on one side and, at 0.06 s, as "ran" on the other: p1's three pairs each lost a different source to
    the clock, with 0 jobs and the same log on both sides. A step that took no more than the rounding step did no reading the check could lose."""
    path = Path(art, f'yardstick-{persona}-{side}', 'out', 'draw', 'presses.jsonl')
    out = {}
    for line in path.read_text(encoding='utf-8').splitlines() if path.exists() else []:
        try:
            press = json.loads(line)
        except ValueError:
            continue
        out[str(press.get('press'))] = {row['step']: (int((row.get('seconds') or 0) > RESOLUTION), row.get('jobs') or 0)
                                        for row in (press.get('funnel') or {}).get('step_yield') or [] if isinstance(row, dict) and row.get('step')}
    return out


def band_lanes(art, sides, ids):
    """{run: {persona: {lane: [ran, read jobs, replays]}}} over main's band replays, and {run: [persona]} on a clock cliff (the replays disagree on a lane,
    or some read no right job and others some). ci.py band_mode stores both in band.json."""
    steady, cliff = {}, {}
    personas = sorted({p.name[len('yardstick-'):].split('-', 1)[0] for p in Path(art).glob('yardstick-p*-main-*')}, key=lambda n: int(n[1:]))
    for persona in personas:
        seen = [lane_yield(art, persona, side) for side in sides]
        for run in ci.RUNS:
            per = [s.get(run) for s in seen if s.get(run) is not None]
            if not per:
                continue
            counts = {lane: [sum(1 for s in per if s.get(lane, (0, 0))[0] > 0), sum(1 for s in per if s.get(lane, (0, 0))[1] > 0), len(per)]
                      for lane in ids if any(lane in s for s in per)}
            steady.setdefault(run, {})[persona] = counts
            if any(0 < ran < n or 0 < jobs < n for ran, jobs, n in counts.values()):
                cliff.setdefault(run, []).append(persona)
    return steady, cliff


def right_cliff(cliff, replays):
    """Adds to cliff ({run: [persona]}) each person whose band replays (each a list of persona_rows) read 0 right jobs in some and some in others."""
    for run, found in replays.items():
        for persona in sorted({row['persona'] for rows in found for row in rows}):
            rights = [row['right'] for rows in found for row in rows if row['persona'] == persona]
            if 0 in rights and any(rights) and persona not in cliff.get(run, []):
                cliff.setdefault(run, []).append(persona)
    return cliff


def pair_findings(art, rows, persona, run, pair, steady, noise, ids):
    """What the PR side lost against main in one pair: ['job_boards did not run', 'right jobs 12 -> 3', ...]; None (that pair not measured) when a side has no row
    or the PR side asked beyond what the recording holds (Gitar on #3805: every pair is gap-checked, so missing pages never finish a 3-of-3 red)."""
    main_side, pr_side = pair
    before, after = rows.get(main_side, {}).get(run, {}).get(persona), rows.get(pr_side, {}).get(run, {}).get(persona)
    if before is None or after is None or ci.report_gap(Path(art, f'yardstick-{persona}-{pr_side}', 'tape-report.jsonl')):
        return None
    found, theirs, mine = [], lane_yield(art, persona, main_side).get(run, {}), lane_yield(art, persona, pr_side).get(run, {})
    for lane in ids:
        ran, jobs, n = steady.get(lane, (0, 0, 0))
        was, now = theirs.get(lane), mine.get(lane, (0, 0))
        if was is None or n < 2:
            continue
        if ran == n and was[0] > 0 and now[0] <= 0:
            found.append(f'{lane} did not run')
        elif jobs == n and was[1] > 0 and now[1] <= 0:
            found.append(f'{lane} read 0 jobs (main {was[1]})')
    if numbers.person_verdict('coverage', before, after, noise.get('coverage', 0)) == 'worse':
        found.append(f"right jobs {before['right']} → {after['right']}")
    return found


def side_rows(out, recordings, sides):
    """{side: {run: {persona: row}}} for each laid-out side."""
    return {side: {run: {row['persona']: row for row in ci.rows(recordings, folder, run)} for run in ci.RUNS} for side, folder in sides.items()}


def too_old(art, persona):
    """Whether "only the PR side asks beyond the recording" stands for the person: yes until the 2 more pairs ran, then only when all 3 pairs show it.
    Why (#3878, 12 Nov 2026): one pair alone held a PR that changes no file a search runs; a replay runs on the runner's wall clock."""
    again = [[Path(art, f'yardstick-{persona}-{side}', 'tape-report.jsonl') for side in pair] for pair in PAIRS[1:]]
    if not all(report.exists() for pair in again for report in pair):
        return True
    return all(ci.report_gap(pr_side) and not ci.report_gap(main_side) for main_side, pr_side in again)


def by_place(art, persona):
    """Whether main's own extra replay (CONTROLS) asks beyond the recording too: then the PR side's gap is the replay's place, never the PR's path.
    Invariant: a control that did not run says nothing (False), so a crashed control never frees a PR."""
    return any(ci.report_gap(Path(art, f'yardstick-{persona}-{side}', 'tape-report.jsonl')) for side in CONTROLS)


def states(art, out, recordings, band, ids):
    """{persona: {run: {'state', 'why', 'pairs'}}} for the 18 night people. states: not measured, too old, red, ok."""
    sides = ci.lay_out(art, out)
    rows, failed, stamp = side_rows(out, Path(out) / 'recordings', sides), ci.failed_presses(art), ci.stamps(Path(out) / 'recordings')
    replay = _load('press_replay', HERE / 'replay.py')
    found = {}
    for persona in ci.ALL_PEOPLE:
        mine = [lane for lane in ids if lane != 'eures' or (Path(recordings, persona).exists() and replay.recorded_eures(Path(recordings, persona)))]
        for run in ci.RUNS:
            one = found.setdefault(persona, {})[run] = {'state': 'not measured', 'why': '', 'pairs': []}
            if not Path(recordings, persona).exists():
                one['why'] = 'no recording'
            elif (band.get('recordings') or {}).get(persona) != stamp.get(persona):
                one['why'] = 'no band on this recording'
            elif persona in (band.get('cliff') or {}).get(run, []):
                one['why'] = 'clock cliff on main\'s band'
            elif persona in failed.get(run, {}) or any(rows.get(side, {}).get(run, {}).get(persona) is None for side in PAIRS[0]):
                one['why'] = 'press failed or no jobs on a side'
            else:
                gaps = [ci.report_gap(Path(art, f'yardstick-{persona}-{side}', 'tape-report.jsonl')) for side in PAIRS[0]]
                if gaps[0]:   # main itself asks what the recording lacks (both sides, or a merged path change): the comparison means nothing
                    one['why'] = 'recording stale, re-record'
                elif gaps[1] and by_place(art, persona):
                    one['why'] = PLACE
                elif gaps[1] and too_old(art, persona):
                    one.update(state='too old', why='recording too old for this PR')
                else:
                    steady = ((band.get('lanes') or {}).get(run) or {}).get(persona, {})
                    noise = ((band.get('people') or {}).get(run) or {}).get(persona, {})
                    one['pairs'] = [pair_findings(art, rows, persona, run, pair, steady, noise, mine) for pair in PAIRS]
                    first = one['pairs'][0]
                    red = all(pair for pair in one['pairs'])   # 3 of 3, each with findings (None = that pair did not run)
                    one.update(state='red' if red else 'ok', why='; '.join(first) if first else '')
    return found


def suspects(art, out, recordings, again):
    """The people whose first pair shows a loss or a recording too old for the PR: their recordings copied to <again> for the 2 more pairs. Returns them."""
    band = ci.newest_band()
    Path(out, 'band-used.json').write_text(json.dumps(band), encoding='utf-8')
    found = states(art, out, recordings, band, lanes())
    people = sorted({p for p, runs in found.items() for one in runs.values() if one['state'] == 'too old' or (one['pairs'] and one['pairs'][0])}, key=lambda n: int(n[1:]))
    for persona in people:
        shutil.copytree(Path(recordings, persona), Path(again, persona), dirs_exist_ok=True)
    return people


def pr_body():
    """The PR body as it is now (a body edited after the push counts on a re-run), else the event's."""
    number = os.environ.get('PR_NUMBER')
    if number:
        try:
            return subprocess.run(['gh', 'pr', 'view', number, '--json', 'body', '--jq', '.body'], capture_output=True, text=True, check=True).stdout
        except (subprocess.CalledProcessError, FileNotFoundError):
            pass
    return os.environ.get('PR_BODY', '')


def live_moves(body):
    """True when the body has a `Moves:` line with numbers (tools/pr-body-check.py MOVES), not `Moves: nothing (...)`."""
    moves = _load('pr_body_check', ROOT / 'tools' / 'pr-body-check.py').MOVES
    return any('nothing' not in match.group(0).split('Moves:', 1)[-1][:12] for match in moves.finditer(body or ''))


def verdict(found, body):
    """(loss, markdown lines) for the states and the PR body: loss = the replay shows a loss the body does not answer. A report: final() never reds on it."""
    floors = _load('persona_floors', ROOT / 'tools' / 'persona-search' / 'floors.py')
    words = sorted(floors.floor_change_words(body))
    red = sorted({p for p, runs in found.items() for one in runs.values() if one['state'] == 'red'}, key=lambda n: int(n[1:]))
    old = sorted({p for p, runs in found.items() for one in runs.values() if one['state'] == 'too old'}, key=lambda n: int(n[1:]))
    measured = [p for p, runs in found.items() if any(one['state'] in ('red', 'ok') for one in runs.values())]
    why = {}
    for persona, runs in found.items():
        if persona not in measured and persona not in old:
            reason = next(one['why'] for one in runs.values())
            why[reason] = why.get(reason, 0) + 1
    lines = ['### The verdict', '', f"**Verdict covers {len(measured)} of {len(ci.ALL_PEOPLE)} people** ({len(ci.ALL_PEOPLE) - len(measured)} not measured: "
             + ', '.join([f'{reason} {count}' for reason, count in sorted(why.items())] + ([f'recording too old {len(old)}'] if old else [])) + ')', '']
    stale = sorted((p for p, runs in found.items() if any(one['why'] == 'recording stale, re-record' for one in runs.values())), key=lambda n: int(n[1:]))
    if stale:
        lines += [f"⚠️ Re-record: {', '.join(stale)} (main's own replay asks what the recording lacks; their numbers say nothing until press-tapes runs again).", '']
    if len(measured) < len(ci.ALL_PEOPLE) // 2:
        lines += [f'⚠️ The verdict sees fewer than half the people: a loss in the other {len(ci.ALL_PEOPLE) - len(measured)} would pass unseen.', '']
    for persona in red:
        for run, one in found[persona].items():
            if one['state'] == 'red':
                lines.append(f"- ❌ {persona}, {ci.RUNS[run]}: " + ' | '.join(f"pair {n}: {'; '.join(pair)}" for n, pair in enumerate(one['pairs'], 1)))
    for persona in old:
        lines.append(f'- ⏸ {persona}: recording too old for this PR (it asks what the recording lacks): the replay cannot judge this person')
    blocked_old = bool(old) and not live_moves(body)
    if red and words:
        lines += ['', f'Accepted by the owner\'s words (`Floor-change:`): "{words[0]}"']
    if blocked_old:
        lines += ['', 'To check live: this PR changes what the recordings hold and its body has no `Moves:` line with numbers (3 searches a side).']
    if red and not words:
        lines += ['', 'To check live: lost in all 3 pairs of the replay. Run the live proof (3 searches a side) on each person named; it decides, not this report.']
    if not red and not blocked_old:
        lines.append('✅ The replay shows no source lost and no person below main\'s range (it cannot see a slower AI call or a person it did not measure).')
    return bool((red and not words) or blocked_old), lines


def final(art, out, recordings):
    """The verdict on stdout and at the top of <out>/summary.md. Always 0: the replay reports, the live proof decides (module docstring)."""
    used = Path(out, 'band-used.json')
    band = json.loads(used.read_text(encoding='utf-8')) if used.exists() else ci.newest_band()
    _, lines = verdict(states(art, out, recordings, band, lanes()), pr_body())
    text = '\n'.join(lines)
    summary = Path(out, 'summary.md')
    old = summary.read_text(encoding='utf-8') if summary.exists() else '## Find jobs pipeline yardstick\n'
    head, _, rest = old.partition('\n')
    summary.write_text(f'{head}\n\n{text}\n{rest}', encoding='utf-8')
    print(text)
    return 0


def main(argv):
    """The CLI: suspects | final (module docstring). Only a confirmed red exits 1: the verdict's own crash (a partial file a crashed replay left) reads
    "not measured" and exits 0 (Gitar on #3805: a measurement failure never blocks a PR)."""
    try:
        if argv[:1] == ['suspects'] and len(argv) == 5:
            people = suspects(*argv[1:])
            print(f"count={len(people)}")
            print(f"replayed twice more on both sides: {', '.join(people) or 'nobody'}", file=sys.stderr)
            return 0
        if argv[:1] == ['final'] and len(argv) == 4:
            return final(*argv[1:])
    except Exception as error:   # noqa: BLE001 — any crash of the verdict itself is not measured, never red
        print('count=0' if argv[:1] == ['suspects'] else f'### The verdict\n\n⚪ The verdict could not be read ({type(error).__name__}: {str(error)[:120]}): not measured, never red.')
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
