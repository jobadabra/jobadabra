"""The Find jobs pipeline yardstick's last step (.github/workflows/press-yardstick.yml, plan docs/superpowers/plans/2026-11-07-the-press.md 2c-2):
the replay jobs' artifacts (art/yardstick-p<N>-<side>/result/: jobs-<run>.json, judged.json, ceiling/jobs-<run>.json) laid out the way
three_numbers.py reads them, then one markdown summary on stdout (the job summary) and the numbers as JSON in <out>.
  python3 tools/press-yardstick/ci.py pr <art> <out>     this ref and main, each Find jobs run (1 = first, 2 = repeat) against main's newest band
  python3 tools/press-yardstick/ci.py band <art> <out>   main's 5 replays per persona -> <out>/band.json: the recordings it used, the personas, {run: {number: [low, high]}}
A persona with no recording has no artifact and is left out ("not measured"); a missing band reads "not measured" on every number, never red."""
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('press_numbers', HERE / 'three_numbers.py')
numbers = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(numbers)
RUNS = {'1': 'first Find jobs run', '2': 'repeat Find jobs run'}
ALL_PEOPLE = [f'p{n}' for n in range(1, 19)]   # the night personas (press-tapes.yml): every one is a row of the per-person table, measured or not
PACE_NOTE = ("The recordings carry CI's slow AI pace (a Mac baseline scored 15 jobs a run against 2 here): read speed as a change between main and this PR, not as the product's speed.")
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


# Why (rf3, 8 Nov 2026, gi: "recording gap: re-record pN" instead of crediting it): a replay that asks for pages its recording lacks measured a path the recording never took (p11 after #3606: 551 of
# ~760 pages), so its coverage is not the pipeline's. The bounds are tools/persona-search/tape-store.mjs staleNote's (2 % of the web requests: "a few odd ones are noise"), measured on recordings made
# at the replayed commit: p18 (recorded after #3606), 3 replays at wait scale 1: 1 of 165 pages (0.6 %), 1 of ~35 AI answers (3 %), every run; p11 (recorded before): 551 of 760 pages, 13 of 77 AI answers (17 %).
# 10 % of the AI answers sits between the two. Report only: the numbers are shown as before, the persona is named.
GAP_WEB_SHARE = 0.02
GAP_AI_SHARE = 0.10


def report_gap(report):
    """(web missing, web asked, AI missing, AI asked) when one replay's tape-report.jsonl (src/search_tape.py: one 'replay' line per process) asked more than the bounds
    for what its recording lacks, else None (also for a replay that left no report)."""
    if not Path(report).exists():
        return None
    total = dict.fromkeys(('web_tape', 'web_missing', 'ai_tape', 'ai_missing', 'ai_rebuilt'), 0)
    for line in Path(report).read_text(encoding='utf-8').splitlines():
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if entry.get('mode') == 'replay':
            for name in total:
                total[name] += entry.get(name) or 0
    web, ai = total['web_tape'] + total['web_missing'], total['ai_tape'] + total['ai_missing'] + total['ai_rebuilt']
    if (web and total['web_missing'] / web > GAP_WEB_SHARE) or (ai and total['ai_missing'] / ai > GAP_AI_SHARE):
        return total['web_missing'], web, total['ai_missing'], ai
    return None


def recording_gaps(art):
    """{persona: (web missing, web asked, AI missing, AI asked)} for each persona whose replay on main (else on this ref) asked more than the bounds for what its recording lacks
    (art/yardstick-<persona>-<side>/tape-report.jsonl)."""
    gaps = {}
    for side in ('pr', 'main'):   # main last: the recording against main's code is the better witness of a stale recording
        for report in sorted(Path(art).glob(f'yardstick-p*-{side}/tape-report.jsonl')):
            persona, gap = report.parent.name[len('yardstick-'):].split('-', 1)[0], report_gap(report)
            if gap:
                gaps[persona] = gap
            elif side == 'main':
                gaps.pop(persona, None)
    return gaps


def failed_presses(art):
    """{run: {persona: [sides]}} for each Find jobs press a replay's own log says failed (`PRESS draw <n> FAILED: <step>: <error>`, tools/persona-search/run.mjs): killed at the
    run's hard stop (src/run_log.py _on_terminate, SystemExit 143) or crashed. Its jobs are a cut-off press, not the pipeline's: the person leaves both sides of that run (cr's #3682, run 42827634813:
    main's p12 press 1 was killed at 175 s with 6 scored, the PR's ended at 139 s with 0, and the means moved 0.50 → 0.34 with no code difference)."""
    found = {}
    for log in sorted(Path(art).glob('yardstick-p*-*/run.log')):
        persona, side = log.parent.name[len('yardstick-'):].split('-', 1)
        for line in log.read_text(encoding='utf-8', errors='replace').splitlines():
            failed = re.match(r'PRESS draw (\d+) FAILED', line)
            if failed:
                found.setdefault(failed.group(1), {}).setdefault(persona, []).append(side)
    return found


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


def stamps(recordings):
    """{persona: sha256 of its recording's files}: which recordings a band or a replay was measured on."""
    found = {}
    for persona in sorted(Path(recordings).glob('p*')):
        digest = hashlib.sha256()
        for file in sorted(persona.iterdir()):
            digest.update(file.name.encode() + b'\0' + file.read_bytes())
        found[persona.name] = digest.hexdigest()
    return found


def comparable(band, recordings, run, personas):
    """(main's band for this run, or {} with the reason): a band counts only when it was built on these same recordings and personas
    (Gitar on #3594: a band of 2 personas compared with a mean of 5, or of recordings re-made since, reads as a change)."""
    if not band:
        return {}, None
    if band.get('recordings') != stamps(recordings):
        return {}, "main's band was built on other recordings (a recording was made or re-made since): not measured; dispatch mode=band again"
    if sorted(band.get('personas', {}).get(run, [])) != sorted(personas):
        return {}, f"main's band measured {band.get('personas', {}).get(run, [])}, this replay {sorted(personas)}: not measured"
    return band['runs'].get(run, {}), None


def either_run(noises):
    """{persona: {number: widest half-width of the runs}}: a person is noisy for the headline when main's replays of either Find jobs run did not repeat."""
    out = {}
    for noise in noises.values():
        for persona, widths in noise.items():
            into = out.setdefault(persona, {})
            for name, half in widths.items():
                into[name] = max(half, into.get(name, 0))
    return out


def noise_for(band, recordings, run):
    """{persona: {number: half-width}} from main's band for the personas whose recording is the one the band was measured on (a re-made recording has no noise yet: the one-job step alone)."""
    now = stamps(recordings)
    return {persona: noise for persona, noise in (band.get('people') or {}).get(run, {}).items() if (band.get('recordings') or {}).get(persona) == now.get(persona)}


def newest_band():
    """main's newest band (band_mode's band.json), from the last successful mode=band run on main; {} when there is none yet."""
    try:
        runs = json.loads(subprocess.run(['gh', 'run', 'list', '--workflow', 'press-yardstick.yml', '--branch', 'main', '--status', 'success',
                                          '--json', 'databaseId,displayTitle', '-L', '30'], capture_output=True, text=True, check=True).stdout)
        run = next((r['databaseId'] for r in runs if r['displayTitle'] == BAND_RUN), None)
        if run is None:
            return {}
        folder = Path('band-download', str(run))
        # Why (11 Nov 2026, #3805): the verdict reads the band again in the same job, and gh refuses to extract over the first download ("file exists"),
        # so the second read was {} and every person read "no band on this recording": the band of that run is read once, then reused.
        if not next(folder.rglob('band.json'), None):
            subprocess.run(['gh', 'run', 'download', str(run), '-n', 'press-yardstick-band', '-D', str(folder)], check=True, capture_output=True)
        # Why (10 Nov 2026, ys 1/2): the artifact keeps its folders (the upload names out/ and art/..., so the file is out/band.json); this read band-download/band.json, found nothing in every PR run since #3594 (8 Nov)
        # and every verdict read "not measured". Found by reading the first PR comment against the band's own artifact.
        found = next(folder.rglob('band.json'), None)
        return json.loads(found.read_text(encoding='utf-8')) if found else {}
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
    found, everyone, noises, cuts = {}, {}, {}, {}
    gaps = recording_gaps(art)
    if gaps:
        lines += ['', '**Recording gap, re-record (their numbers below are not the pipeline\'s): ' + '; '.join(
            f'{persona} ({web_missing} of {web} pages and {ai_missing} of {ai} AI answers missing)' for persona, (web_missing, web, ai_missing, ai) in sorted(gaps.items(), key=lambda item: int(item[0][1:]))) + '**']
    for run, label in RUNS.items():
        cut = failed_presses(art).get(run, {})
        mine = [row for row in rows(recordings, sides['pr'], run) if row['persona'] not in cut]
        theirs = [row for row in rows(recordings, sides['main'], run) if row['persona'] not in cut] if 'main' in sides else []
        cuts[run] = cut
        found[run] = {'pr': {'personas': mine, 'summary': numbers.summary(mine) if mine else {}},
                      'main': {'personas': theirs, 'summary': numbers.summary(theirs) if theirs else {}}}
        measured = [row['persona'] for row in mine]
        noise = noises[run] = noise_for(band, recordings, run)
        seen = numbers.people(theirs, mine, noise)
        everyone[run] = seen
        against, why = comparable(band, recordings, run, measured)
        lines += ['', f'### The {label} ({len(mine)} personas)', '']
        lines += (['No replay measured this run.', ''] if not seen else
                  [numbers.people_line(seen, ALL_PEOPLE), ''] + ([numbers.repeat_line(seen, noise), ''] if noise else []) + [numbers.people_table(seen, ALL_PEOPLE, missing_why(recordings, run, cut), noise), ''])
        if why:
            lines += [why, '']
        crashed = sorted(p.name for p in recordings.glob('p*') if (p / f'jobs-{run}.json').exists() and p.name not in measured)
        if crashed:
            lines += [f"replay crashed or missing on this ref (left out, see its job's log): {', '.join(crashed)}", '']
        lines += [numbers.table(against, found[run]['pr']['summary'] or {'unjudged': 0}), '']
        if theirs:
            main_said = found[run]['main']['summary']
            shown = ', '.join(f"{name} {'—' if main_said.get(name) is None else round(main_said[name], 2)}" for name in numbers.NUMBERS)
            lines.append(f'main on the same recordings: {shown}')
        curve = by_minute(recordings, run)
        lines.append('right local jobs the recordings found by minute ' + ', '.join(f'{m}: {n}' for m, n in curve.items()))
    Path(out, 'numbers.json').write_text(json.dumps(found, ensure_ascii=False), encoding='utf-8')
    wrong = numbers.wrong_place_line(next((seen for seen in everyone.values() if seen), {}))   # the first run's: the repeat run lists the same jobs again
    crashed = sorted({(side, persona) for cut in cuts.values() for persona, sides in cut.items() for side in sides}, key=lambda item: (item[0], int(item[1][1:])))
    head = ['## Find jobs pipeline yardstick', '', '**' + numbers.people_line(worst_of(everyone), ALL_PEOPLE, 'People, both runs: ') + '**'] + (
        ['', '**Press failed, the person is left out of both sides of that run: ' + '; '.join(f'{side} side: {persona}' for side, persona in crashed) + '**'] if crashed else []) + ['', numbers.repeat_line({persona: one for seen in everyone.values() for persona, one in seen.items()}, either_run(noises))] + (['', wrong] if wrong else []) + ['', PACE_NOTE]
    text = '\n'.join(head + lines[1:])
    Path(out, 'summary.md').write_text(text + '\n', encoding='utf-8')   # the PR comment's body (the workflow's comment job posts it)
    print(text)
    return 0


def missing_why(recordings, run, cut=None):
    """{persona: reason} for the night personas a run's table has no row for: no recording, a press that failed on a side (cut: failed_presses()[run]), or a replay that left no jobs."""
    why = {persona: 'replay crashed or missing on a side' if (Path(recordings) / persona / f'jobs-{run}.json').exists() else 'no recording' for persona in ALL_PEOPLE}
    why.update({persona: f"press failed on {' and '.join(sorted(set(sides)))}, left out of both sides" for persona, sides in (cut or {}).items()})
    return why


def worst_of(everyone):
    """{persona: {'overall', 'verdict'}} over both runs: each number's worst verdict of the two, so the headline names anyone who got worse in either."""
    merged = {}
    for seen in everyone.values():
        for persona, one in seen.items():
            into = merged.setdefault(persona, {'verdict': {}})['verdict']
            for name, verdict in one['verdict'].items():
                into[name] = min(verdict, into.get(name, verdict), key=numbers.WORSE_FIRST.index)
    for one in merged.values():
        one['overall'] = next(v for v in numbers.WORSE_FIRST if v in one['verdict'].values())
    return merged


def band_mode(art, out):
    """mode=band: main's 5 replays per persona in <art> -> <out>/band.json ({'recordings': stamps, 'personas': {run: [...]}, 'runs': {run:
    {number: [low, high] or None}}}) and a short summary; returns 0. A number fewer than 2 replays measured has no band (None)."""
    sides = lay_out(art, out)
    recordings = Path(out) / 'recordings'
    band, every = {'recordings': stamps(recordings), 'personas': {}, 'runs': {}}, {}
    for run in RUNS:
        replays = every[run] = [found for side, folder in sorted(sides.items()) if side.startswith('main-') and (found := rows(recordings, folder, run))]
        # A persona counts in the band only when every replay of main measured it, so each replay's mean is over the same personas.
        common = set.intersection(*({row['persona'] for row in found} for found in replays)) if replays else set()
        band['personas'][run] = sorted(common)
        band.setdefault('people', {})[run] = numbers.person_noise([[row for row in found if row['persona'] in common] for found in replays]) if common else {}
        band['runs'][run] = numbers.band([numbers.summary([row for row in found if row['persona'] in common]) for found in replays if common])
    # The verdict's inputs (tools/press-yardstick/verdict.py): which lanes ran in every replay of main, and who is on a clock cliff (said here, once, not per PR).
    verdict = importlib.util.module_from_spec(spec := importlib.util.spec_from_file_location('press_verdict', HERE / 'verdict.py'))
    spec.loader.exec_module(verdict)
    band['lanes'], cliff = verdict.band_lanes(art, sorted(side for side in sides if side.startswith('main-')), verdict.lanes())
    band['cliff'] = verdict.right_cliff(cliff, every)
    Path(out, 'band.json').write_text(json.dumps(band), encoding='utf-8')
    print('## Find jobs pipeline yardstick: main\'s noise band\n')
    for run, label in RUNS.items():
        print(f"- {label} ({len(band['personas'][run])} personas): " + ', '.join(f"{name} {band['runs'][run].get(name)}" for name in numbers.NUMBERS))
        if band['cliff'].get(run):
            print(f"  - on a clock cliff (main's own replays disagree; the verdict reads them not measured): {', '.join(band['cliff'][run])}")
    return 0


def main(argv):
    if len(argv) != 3 or argv[0] not in ('pr', 'band'):
        print(__doc__, file=sys.stderr)
        return 2
    Path(argv[2]).mkdir(parents=True, exist_ok=True)
    return (pr if argv[0] == 'pr' else band_mode)(argv[1], argv[2])


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
