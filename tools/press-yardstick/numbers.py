"""The press's three numbers (plan docs/superpowers/plans/2026-11-07-the-press.md 2c; owner, 7 Nov 2026: "We aim quality, speed and coverage. That's
the goal. To find as many jobs, as fast, as qualitive... as possible"). For one persona's press, from its jobs (tools/persona-search/ttfr.py --jobs)
and the blind judge's verdicts kept with its tape (tools/persona-search/gate_judge.py rows: right role, right place):
  coverage: right local jobs found / those the tape's ceiling press found (the most a longer press reaches);
  quality: the right local share of the jobs scored;
  speed: seconds to the first right local job scored 70+ (lower is better).
A job the judge never saw is unjudged: never right, counted apart, so a change that finds new jobs shows them (the next recording judges them).
Across personas coverage and quality are means and speed the median. A PR's number is better or worse only outside main's noise band (mean +- 2 sd
of main's own replays); inside it reads "no change".
  python3 tools/press-yardstick/numbers.py summary <tapes dir> <replay dir> [--press N]   per-persona numbers and their summary (JSON)
  python3 tools/press-yardstick/numbers.py band <summary.json>...                          main's band from its replays' summaries (JSON)
  python3 tools/press-yardstick/numbers.py compare <band.json> <summary.json>             one markdown table
A folder holds p<N>/jobs-<press>.json; the tapes folder also p<N>/judged.json. Tests: tests/unit/press/test_numbers.py."""
import json
import statistics
import sys
from pathlib import Path

NUMBERS = ('coverage', 'quality', 'speed')
LOWER_IS_BETTER = {'speed'}
SD = 2   # the band's width in standard deviations of main's replays


def key(job):
    """The judge sees title, employer and place only (no URL): a job is the same job when those three are."""
    return tuple((job.get(field) or '').strip().lower() for field in ('title', 'company', 'location'))


def verdicts(rows):
    """{key: right} from the judge's rows: right = right role and right place."""
    return {key(row): row.get('role') == 'yes' and row.get('place') == 'yes' for row in rows}


def distinct(jobs):
    """One row per job, as the judge counts them (Gitar on #3582: a posting read from two sources is one job): the one scored first."""
    out = {}
    for job in sorted(jobs, key=lambda j: (j.get('scored_s') is None, j.get('scored_s') or 0)):
        out.setdefault(key(job), job)
    return list(out.values())


def three(jobs, judged, ceiling):
    """One press's numbers. jobs, ceiling: ttfr.py --jobs rows (this press, the tape's ceiling press), seconds from the press's own start;
    judged: verdicts(). Speed counts a job scored in this press only (a later press's earlier scores are negative seconds). None = not measurable
    (nothing right at the ceiling, nothing scored, no right 70+)."""
    jobs, ceiling = distinct(jobs), distinct(ceiling)
    right = [job for job in jobs if judged.get(key(job)) is True]
    most = sum(1 for job in ceiling if judged.get(key(job)) is True)
    scored = [job for job in jobs if job.get('fit') is not None]
    fast = sorted(job['scored_s'] for job in right if (job.get('scored_s') is not None and job['scored_s'] >= 0) and (job.get('fit') or 0) >= 70)
    return {'coverage': len(right) / most if most else None,
            'quality': sum(1 for job in scored if judged.get(key(job)) is True) / len(scored) if scored else None,
            'speed': fast[0] if fast else None,
            'right': len(right), 'unjudged': sum(1 for job in jobs if key(job) not in judged)}


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


def _read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def persona_rows(tapes, replay, press):
    """Each persona in the replay folder: its three numbers against its tape's verdicts and ceiling press."""
    rows = []
    for folder in sorted(Path(replay).glob('p*')):
        tape = Path(tapes) / folder.name
        judged = verdicts(_read(tape / 'judged.json')['rows'])
        rows.append({'persona': folder.name, **three(_read(folder / f'jobs-{press}.json'), judged, _read(tape / f'jobs-{press}.json'))})
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
