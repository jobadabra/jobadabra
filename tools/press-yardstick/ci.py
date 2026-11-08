"""The Find jobs pipeline yardstick's last step (.github/workflows/press-yardstick.yml, plan docs/superpowers/plans/2026-11-07-the-press.md 2c-2):
the replay jobs' artifacts (art/yardstick-p<N>-<side>/result/: jobs-<run>.json, judged.json, ceiling/jobs-<run>.json) laid out the way
three_numbers.py reads them, then one markdown summary on stdout (the job summary) and the numbers as JSON in <out>.
  python3 tools/press-yardstick/ci.py pr <art> <out>     this ref and main, each Find jobs run (1 = first, 2 = repeat) against main's newest band
  python3 tools/press-yardstick/ci.py band <art> <out>   main's 5 replays per persona -> <out>/band.json (what the pr mode compares with)
A persona with no recording has no artifact and is left out ("not measured"); a missing band reads "not measured" on every number, never red."""
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('press_numbers', HERE / 'three_numbers.py')
numbers = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(numbers)
RUNS = {'1': 'first Find jobs run', '2': 'repeat Find jobs run'}
BAND_RUN = 'Find jobs pipeline yardstick band'   # the run-name of a mode=band dispatch


def lay_out(art, out):
    """{side: folder} with <folder>/p<N>/jobs-<run>.json, and <out>/recordings/p<N>/ (judged.json + the ceiling's jobs-<run>.json)."""
    sides = {}
    for result in sorted(Path(art).glob('yardstick-p*-*/result')):
        persona, side = result.parent.name[len('yardstick-'):].split('-', 1)
        if not (result / 'judged.json').exists():
            continue
        rec = Path(out) / 'recordings' / persona
        if not rec.exists():
            rec.mkdir(parents=True)
            shutil.copy(result / 'judged.json', rec)
            for ceiling in (result / 'ceiling').glob('jobs-*.json'):
                shutil.copy(ceiling, rec)
        dest = Path(out) / 'replays' / side / persona
        dest.mkdir(parents=True, exist_ok=True)
        for jobs in result.glob('jobs-*.json'):
            shutil.copy(jobs, dest)
        sides[side] = dest.parent
    return sides


def rows(recordings, folder, run):
    """numbers.persona_rows for the personas this side replayed that run (one whose replay crashed before that run is left out)."""
    kept = Path(folder).parent / f'.run{run}-{Path(folder).name}'
    shutil.rmtree(kept, ignore_errors=True)
    for persona in Path(folder).glob('p*'):
        if (persona / f'jobs-{run}.json').exists() and (Path(recordings) / persona.name / f'jobs-{run}.json').exists():
            shutil.copytree(persona, kept / persona.name)
    return numbers.persona_rows(recordings, kept, run) if kept.exists() else []


def by_minute(recordings, run, minutes=(3, 5, 9)):
    """The recordings' curve: right local jobs found by minute 3, 5 and 9 of the 540 s ceiling (seen_s of each job), summed over the personas;
    what a longer Find jobs run would add (owner, 8 Nov 2026: "I'd rather get first 200 jobs in 3 mins, then I can rerun to get more and more")."""
    counts = dict.fromkeys(minutes, 0)
    for persona in Path(recordings).glob('p*'):
        ceiling = persona / f'jobs-{run}.json'
        if not ceiling.exists():
            continue
        judged = numbers.verdicts(json.loads((persona / 'judged.json').read_text(encoding='utf-8'))['rows'])
        for job in numbers.distinct(json.loads(ceiling.read_text(encoding='utf-8'))):
            if judged.get(numbers.key(job)) is True and job.get('seen_s') is not None:
                for minute in minutes:
                    counts[minute] += job['seen_s'] <= minute * 60
    return counts


def newest_band():
    """main's newest band ({run: {number: [low, high]}}), from the last successful mode=band run on main; {} when there is none yet."""
    try:
        runs = json.loads(subprocess.run(['gh', 'run', 'list', '--workflow', 'press-yardstick.yml', '--branch', 'main', '--status', 'success',
                                          '--json', 'databaseId,displayTitle', '-L', '30'], capture_output=True, text=True, check=True).stdout)
        run = next((r['databaseId'] for r in runs if r['displayTitle'] == BAND_RUN), None)
        if run is None:
            return {}
        folder = Path('band-download')
        subprocess.run(['gh', 'run', 'download', str(run), '-n', 'press-yardstick-band', '-D', str(folder)], check=True, capture_output=True)
        return json.loads((folder / 'band.json').read_text(encoding='utf-8'))
    except (subprocess.CalledProcessError, FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def pr(art, out):
    """mode=pr: the replays in <art> (this ref and main) -> the markdown summary on stdout and <out>/numbers.json; returns 0. No recording yet or
    no band yet is said in the summary ("not measured"), never an error; a missing band artifact reads as no band (newest_band)."""
    sides = lay_out(art, out)
    recordings = Path(out) / 'recordings'
    band = newest_band()
    lines = ['## Find jobs pipeline yardstick', '']
    if 'pr' not in sides:
        lines.append('No persona has a Find jobs recording yet (`press-tapes.yml`): not measured.')
        print('\n'.join(lines))
        return 0
    if not band:
        lines.append("main's noise band is not measured yet (dispatch this workflow with mode=band on main): every verdict reads \"not measured\".")
    found = {}
    for run, label in RUNS.items():
        mine = rows(recordings, sides['pr'], run)
        theirs = rows(recordings, sides['main'], run) if 'main' in sides else []
        found[run] = {'pr': {'personas': mine, 'summary': numbers.summary(mine) if mine else {}},
                      'main': {'personas': theirs, 'summary': numbers.summary(theirs) if theirs else {}}}
        lines += ['', f'### The {label} ({len(mine)} personas)', '', numbers.table(band.get(run, {}), found[run]['pr']['summary'] or {'unjudged': 0}), '']
        if theirs:
            main_said = found[run]['main']['summary']
            shown = ', '.join(f"{name} {'—' if main_said.get(name) is None else round(main_said[name], 2)}" for name in numbers.NUMBERS)
            lines.append(f'main on the same recordings: {shown}')
        curve = by_minute(recordings, run)
        lines.append('right local jobs the recordings found by minute ' + ', '.join(f'{m}: {n}' for m, n in curve.items()))
    Path(out, 'numbers.json').write_text(json.dumps(found, ensure_ascii=False), encoding='utf-8')
    print('\n'.join(lines))
    return 0


def band_mode(art, out):
    """mode=band: main's 5 replays per persona in <art> -> <out>/band.json ({run: {number: [low, high] or None}}) and a short summary; returns 0.
    A number fewer than 2 replays measured has no band (None)."""
    sides = lay_out(art, out)
    recordings = Path(out) / 'recordings'
    band = {}
    for run in RUNS:
        summaries = [numbers.summary(found) for side, folder in sorted(sides.items()) if side.startswith('main-') and (found := rows(recordings, folder, run))]
        band[run] = numbers.band(summaries)
    Path(out, 'band.json').write_text(json.dumps(band), encoding='utf-8')
    print('## Find jobs pipeline yardstick: main\'s noise band\n')
    for run, label in RUNS.items():
        print(f'- {label}: ' + ', '.join(f'{name} {band[run].get(name)}' for name in numbers.NUMBERS))
    return 0


def main(argv):
    if len(argv) != 3 or argv[0] not in ('pr', 'band'):
        print(__doc__, file=sys.stderr)
        return 2
    Path(argv[2]).mkdir(parents=True, exist_ok=True)
    return (pr if argv[0] == 'pr' else band_mode)(argv[1], argv[2])


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
