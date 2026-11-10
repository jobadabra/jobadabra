"""The press's three numbers (plan docs/superpowers/plans/2026-11-07-the-press.md 2c; owner, 7 Nov 2026: "We aim quality, speed and coverage. That's
the goal. To find as many jobs, as fast, as qualitive... as possible"). For one persona's press, from its jobs (tools/persona-search/ttfr.py --jobs)
and the blind judge's verdicts kept with its tape (tools/persona-search/gate_judge.py rows: right role, right place):
  coverage: right local jobs found / those the tape's ceiling press found (the most a longer press reaches);
  quality: the right local share of the jobs scored;
  speed: seconds to the first right local job scored 70+ (lower is better).
A job the judge never saw is unjudged: never right, counted apart, so a change that finds new jobs shows them (the next recording judges them).
Across personas coverage and quality are means and speed the median. A PR's number is better or worse only outside main's noise band (mean +- 2 sd
of main's own replays); inside it reads "no change".
  python3 tools/press-yardstick/three_numbers.py summary <tapes dir> <replay dir> [--press N]   per-persona numbers and their summary (JSON)
  python3 tools/press-yardstick/three_numbers.py band <summary.json>...                          main's band from its replays' summaries (JSON)
  python3 tools/press-yardstick/three_numbers.py compare <band.json> <summary.json>             one markdown table
Per person (owner, 10 Nov 2026: "each session that tries to improve a case does this without worsening other improvements done previously"): people() sets
each person's rows of main and of the PR side by side (the same recording, the same run, so the same machine), and a number is better or worse only beyond
what that number can move without a real change: one job (coverage: 1 / the ceiling's right jobs; quality: 1 / the jobs scored), 5 s of speed, or the person's
own band half-width when the band has one. Main's replays repeat to the digit (8 Nov band, 5 replays of 3 people: coverage sd 0, quality <= 0.007,
speed <= 0.7 s), so that step, not a mean +- 2 sd of nothing, is the least a person can lose and still read "no change"; the cell shows both numbers anyway.
A folder holds p<N>/jobs-<press>.json; the tapes folder also p<N>/judged.json. Tests: tests/unit/press/test_numbers.py."""
import json
import statistics
import sys
from pathlib import Path

NUMBERS = ('coverage', 'quality', 'speed')
PERSON_NUMBERS = NUMBERS + ('placed',)   # per person only: the share of the jobs LISTED that the judge puts in the person's place (owner, 10 Nov 2026, on #3674: 24 of 25 listed jobs in the wrong country went unseen for days)
UNJUDGED_PLACE = (None, 'not-judged', 'missing')
LOWER_IS_BETTER = {'speed'}
SD = 2   # the band's width in standard deviations of main's replays
SPEED_STEP_S = 5   # the least seconds that read as a change of one person's speed (main's own replays spread under 1 s)
WORSE_FIRST = ('worse', 'better', 'no change', 'not measured')   # a person's verdict is the first of these any of their cells has


def key(job):
    """The judge sees title, employer and place only (no URL): a job is the same job when those three are."""
    return tuple((job.get(field) or '').strip().lower() for field in ('title', 'company', 'location'))


def verdicts(rows):
    """{key: right} from the judge's rows: right = right role and right place."""
    return {key(row): row.get('role') == 'yes' and row.get('place') == 'yes' for row in rows}


def places(rows):
    """{key: the judge's place verdict ('yes', 'remote', 'no', 'unknown')} from the judge's rows; a job it never judged has none."""
    return {key(row): row.get('place') for row in rows if row.get('place') not in UNJUDGED_PLACE}


def distinct(jobs):
    """One row per job, as the judge counts them (Gitar on #3582: a posting read from two sources is one job): the one scored first."""
    out = {}
    for job in sorted(jobs, key=lambda j: (j.get('scored_s') is None, j.get('scored_s') or 0)):
        out.setdefault(key(job), job)
    return list(out.values())


def three(jobs, judged, ceiling, placed=None):
    """One press's numbers. jobs, ceiling: ttfr.py --jobs rows (this press, the tape's ceiling press), seconds from the press's own start;
    judged: verdicts(); placed: places() (the share of the jobs listed the judge put in the person's place, None when it judged none of them). Speed counts a job scored in this press only (a later press's earlier scores are negative seconds). None = not measurable
    (nothing right at the ceiling, nothing scored, no right 70+)."""
    jobs, ceiling = distinct(jobs), distinct(ceiling)
    right = [job for job in jobs if judged.get(key(job)) is True]
    most = sum(1 for job in ceiling if judged.get(key(job)) is True)
    scored = [job for job in jobs if job.get('fit') is not None]
    seen = [placed[key(job)] for job in jobs if placed and key(job) in placed]
    fast = sorted(job['scored_s'] for job in right if (job.get('scored_s') is not None and job['scored_s'] >= 0) and (job.get('fit') or 0) >= 70)
    return {'coverage': len(right) / most if most else None,
            'quality': sum(1 for job in scored if judged.get(key(job)) is True) / len(scored) if scored else None,
            'speed': fast[0] if fast else None,
            'right': len(right), 'unjudged': sum(1 for job in jobs if key(job) not in judged), 'most': most, 'scored': len(scored),
            'placed': sum(1 for verdict in seen if verdict == 'yes') / len(seen) if seen else None, 'listed': len(seen)}


def summary(rows):
    """{number: mean (coverage, quality) or median (speed) over the personas that measured it, 'unjudged': total}."""
    out = {'unjudged': sum(row['unjudged'] for row in rows)}
    for name in NUMBERS:
        values = [row[name] for row in rows if row[name] is not None]
        out[name] = None if not values else (statistics.median(values) if name == 'speed' else statistics.fmean(values))
    return out


def band(summaries):
    """{number: [low, high]}: main's replays' mean +- SD standard deviations (None when fewer than 2 replays measured it)."""
    out = {}
    for name in NUMBERS:
        values = [s[name] for s in summaries if s.get(name) is not None]
        if len(values) < 2:
            out[name] = None
            continue
        mean, sd = statistics.fmean(values), statistics.stdev(values)
        out[name] = [mean - SD * sd, mean + SD * sd]
    return out


def compare(main_band, pr):
    """{number: 'better' | 'worse' | 'no change' | 'not measured'} for a PR's summary against main's band."""
    out = {}
    for name in NUMBERS:
        value, limits = pr.get(name), main_band.get(name)
        if value is None or limits is None:
            out[name] = 'not measured'
            continue
        low, high = limits
        if low <= value <= high:
            out[name] = 'no change'
            continue
        up = value > high
        out[name] = 'better' if up != (name in LOWER_IS_BETTER) else 'worse'
    return out


def table(main_band, pr):
    """The PR job's one summary table (markdown)."""
    verdict = compare(main_band, pr)
    shown = {'coverage': lambda v: f'{v:.0%}', 'quality': lambda v: f'{v:.0%}', 'speed': lambda v: f'{v:.0f} s'}
    lines = ['| Number | This PR | Main (band) | Verdict |', '|---|---|---|---|']
    for name in NUMBERS:
        value, limits = pr.get(name), main_band.get(name)
        lines.append(f"| {name} | {'—' if value is None else shown[name](value)} | "
                     f"{'—' if limits is None else shown[name](limits[0]) + ' to ' + shown[name](limits[1])} | {verdict[name]} |")
    lines.append(f"| unjudged jobs | {pr.get('unjudged', 0)} | | judged at the next recording |")
    return '\n'.join(lines)


def person_noise(replays):
    """{persona: {number: half-width}} from main's replays of the same recordings (each a list of persona_rows): SD standard deviations of each person's own number
    over the replays that measured it; a number fewer than 2 replays measured has none (the one-job step decides alone). Measured 10 Nov 2026 (5 replays of 16 people):
    12 of them repeat to the digit, p3's speed moves 8.7 s (sd), p17's listed-in-place share 0.11, p8 and p9 coverage and quality."""
    out = {}
    for persona in sorted({row['persona'] for rows in replays for row in rows}, key=lambda name: int(name[1:])):
        mine = [row for rows in replays for row in rows if row['persona'] == persona]
        values = {name: [row[name] for row in mine if row.get(name) is not None] for name in PERSON_NUMBERS}
        out[persona] = {name: SD * statistics.stdev(found) for name, found in values.items() if len(found) >= 2}
    return out


def step_of(name, main, pr):
    """The least change of one person's number that is not one job (or SPEED_STEP_S seconds) moving: coverage 1 / the right jobs at the ceiling, quality 1 / the jobs scored."""
    if name == 'coverage':
        return 1 / max(main.get('most') or 0, pr.get('most') or 0, 1)
    if name == 'quality':
        return 1 / max(min(main.get('scored') or 0, pr.get('scored') or 0), 1)
    if name == 'placed':
        return 1 / max(min(main.get('listed') or 0, pr.get('listed') or 0), 1)
    return SPEED_STEP_S


def person_verdict(name, main, pr, noise=0):
    """'better' | 'worse' | 'no change' | 'not measured' for one number of one person, main's row against the PR's. Speed None = no right 70+ job:
    losing the first one is worse, getting one is better; coverage or quality None on either side is not measurable; to or from 0 is always a change
    (one job of one is all of it). noise: the person's band half-width."""
    before, after = main.get(name), pr.get(name)
    if before is None and after is None or (name != 'speed' and (before is None or after is None)):
        return 'not measured'
    if name == 'speed' and (before is None or after is None):
        return 'better' if before is None else 'worse'
    change = after - before
    if name != 'speed' and (before == 0) != (after == 0):   # none <-> some is more than one job moving: a person who had one right job and lost it is worse
        return 'better' if change > 0 else 'worse'
    if abs(change) <= max(step_of(name, main, pr), noise) + 1e-9:
        return 'no change'
    return 'better' if (change > 0) != (name in LOWER_IS_BETTER) else 'worse'


def people(main_rows, pr_rows, noise=None):
    """{persona: {'main': row, 'pr': row, 'verdict': {number: ...}, 'overall': ...}} for each persona both sides measured; noise: {persona: {number: half-width}}.
    A person's overall is their worst cell: a person who got faster and lost jobs is named as worse."""
    mine, theirs, out = {r['persona']: r for r in pr_rows}, {r['persona']: r for r in main_rows}, {}
    for persona in sorted(mine.keys() & theirs.keys(), key=lambda name: int(name[1:])):
        verdict = {name: person_verdict(name, theirs[persona], mine[persona], ((noise or {}).get(persona) or {}).get(name, 0)) for name in PERSON_NUMBERS}
        out[persona] = {'main': theirs[persona], 'pr': mine[persona], 'verdict': verdict,
                        'overall': next(v for v in WORSE_FIRST if v in verdict.values())}
    return out


CHIP = {'better': '✅ better', 'no change': '➖ no change', 'worse': '❌ worse', 'not measured': '⚪ not measured'}
SHOWN = {'coverage': lambda v: f'{v:.0%}', 'quality': lambda v: f'{v:.0%}', 'speed': lambda v: f'{v:.0f} s', 'placed': lambda v: f'{v:.0%}'}


def cell(name, main, pr, verdict):
    """One table cell: main's number, an arrow, the PR's, and the verdict, so a one-job change shows even where it reads "no change"."""
    show = lambda row: '—' if row.get(name) is None else SHOWN[name](row[name])
    return f"{show(main)} → {show(pr)} {CHIP[verdict]}"


percent = lambda v: f'±{v:.0%}' if v >= 0.01 else f'±{v:.1%}'   # a half-width under 1 point is shown as 0.1 %, never as a noise-free "±0%"
HALF = {'coverage': percent, 'quality': percent, 'speed': lambda v: f'±{v:.0f} s' if v >= 1 else f'±{v:.1f} s', 'placed': percent}


def noisy(noise, persona):
    """The numbers of one person that main's own replays did not repeat, with their band half-width ("speed ±17 s"); [] = repeats to the digit (or no band for them)."""
    return [f'{name} {HALF[name](half)}' for name, half in ((noise or {}).get(persona) or {}).items() if half > 0]


def repeat_line(found, noise):
    """"12 of 16 people repeat to the digit on main; noisy: p3, p8" over the people of this table that main's band measured (sa, 10 Nov 2026: a reader must not take a noisy person's "worse" at face value)."""
    banded = [persona for persona in found if persona in (noise or {})]
    if not banded:
        return "Main's own repeat is not measured for these people yet (dispatch this workflow with mode=band on main): \"worse\" reads at one job or 5 s only."
    loud = [persona for persona in banded if noisy(noise, persona)]
    return f"{len(banded) - len(loud)} of {len(banded)} people repeat to the digit on main's own replays" + (f"; noisy, read their \"worse\" with their band: {', '.join(loud)}" if loud else '')


def people_table(found, all_people, why=None, noise=None):
    """The per-person markdown table, one row for each of all_people (persona names): a person with no replay on a side is "not measured" with
    the reason from why ({persona: 'no recording' | 'replay crashed'}); noise: main's band per person, a noisy person's row says so with the band."""
    lines = ['| Person | Coverage (main → PR) | Quality (main → PR) | Speed (main → PR) | Listed in the right place (main → PR) |', '|---|---|---|---|---|']
    for persona in all_people:
        if persona in found:
            one = found[persona]
            loud = noisy(noise, persona)
            lines.append(f'| {persona}' + (f" · noisy ({', '.join(loud)})" if loud else '') + ' | ' + ' | '.join(cell(name, one['main'], one['pr'], one['verdict'][name]) for name in PERSON_NUMBERS) + ' |')
        else:
            lines.append(f"| {persona} | {CHIP['not measured']} ({(why or {}).get(persona, 'no replay')}) | | | |")
    return '\n'.join(lines)


def people_line(found, all_people, label=''):
    """The first line over the table: "N better, N no change, N worse, N not measured; worse: p3 (speed), p7 (coverage, quality)"."""
    count = {kind: 0 for kind in WORSE_FIRST}
    for persona in all_people:
        count[found[persona]['overall'] if persona in found else 'not measured'] += 1
    worse = [f"{persona} ({', '.join(name for name in PERSON_NUMBERS if found[persona]['verdict'][name] == 'worse')})" for persona in all_people
             if persona in found and found[persona]['overall'] == 'worse']
    return f"{label}{count['better']} better, {count['no change']} no change, {count['worse']} worse, {count['not measured']} not measured" + (f"; worse: {', '.join(worse)}" if worse else '')


def wrong_place_line(found, count=3):
    """The people whose listed jobs are least often in their place, on the PR's side (main's share beside it): "Listed in the right place, lowest: p7 4% (main 4%), ...".
    The judge's verdict only (a job it never judged is not counted); nothing when no person has one."""
    shares = sorted((one['pr']['placed'], int(persona[1:]), one['main']['placed']) for persona, one in found.items() if one['pr'].get('placed') is not None)[:count]
    return ('Listed in the right place, lowest: ' + ', '.join(f"p{n} {share:.0%}" + (f" (main {before:.0%})" if before is not None else '') for share, n, before in shares)) if shares else ''


def _read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def persona_rows(tapes, replay, press):
    """Each persona in the replay folder: its three numbers against its tape's verdicts and ceiling press."""
    rows = []
    for folder in sorted(Path(replay).glob('p*')):
        tape = Path(tapes) / folder.name
        judge = _read(tape / 'judged.json')['rows']
        rows.append({'persona': folder.name, **three(_read(folder / f'jobs-{press}.json'), verdicts(judge), _read(tape / f'jobs-{press}.json'), places(judge))})
    return rows


def main(argv):
    if argv[:1] == ['summary'] and len(argv) >= 3:
        press = argv[argv.index('--press') + 1] if '--press' in argv else '1'
        rows = persona_rows(argv[1], argv[2], press)
        print(json.dumps({'personas': rows, 'summary': summary(rows)}, ensure_ascii=False))
    elif argv[:1] == ['band'] and len(argv) >= 2:
        print(json.dumps(band([_read(path)['summary'] for path in argv[1:]])))
    elif argv[:1] == ['compare'] and len(argv) == 3:
        print(table(_read(argv[1]), _read(argv[2])['summary']))
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
