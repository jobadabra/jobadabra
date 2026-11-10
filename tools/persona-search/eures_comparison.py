"""Paired fresh Search checks, with and without the EURES reader; counts-only report, separate from nightly history. Privacy guard: tests/guards/privacy/test_search_comparison.py."""
import collections
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import gate
import gate_judge
import reference


def identity(row):
    """A conservative title/employer identity within one persona; missing employers cannot establish cross-source overlap."""
    title, company = (' '.join(str(row.get(k) or '').casefold().split()) for k in ('title', 'company'))
    return (title, company) if title and company and company != 'unknown employer' else None


def right(rows):
    """Distinct relevant title/employer pairs; unidentified rows retain their own identity rather than collapsing together."""
    return {identity(row) or ('unidentified', i): row for i, row in enumerate(rows)
            if row.get('role') == 'yes' and row.get('place') == 'yes'}


def eures_row(row):
    """Whether provenance identifies an EURES reader or portal result, including one found through another reader."""
    return gate.source_kind(row) == 'eures'


def summarize(pools, presses):
    """Counts only from a jointly judged pool; unmatched identities never mean proven additional vacancies."""
    ref = right(pools['reference'])
    ref_keys = {identity(r) for r in ref.values()} - {None}
    report = {'reference': len(ref), 'arms': {}}
    for arm in ('normal', 'without_eures'):
        rows, press = pools[arm], presses[arm]
        relevant = right(rows)
        keys = {identity(r) for r in relevant.values()} - {None}
        sources = collections.defaultdict(list)
        for row in rows:
            sources['EURES' if eures_row(row) else 'Other sources' if row.get('provider') else 'Unknown source'].append(row)
        contaminated = sum(eures_row(row) for row in rows) if arm == 'without_eures' else 0
        reasons = []
        if press.get('code') or press.get('crashes'):
            reasons.append('press failed')
        if not isinstance(press.get('seconds'), (int, float)) or press['seconds'] > gate.PRESS_LIMIT:
            reasons.append('press time missing or over 180 s')
        if any(r.get('role') not in ('yes', 'no') or r.get('place') not in ('yes', 'no', 'remote', 'unknown') for r in rows):
            reasons.append('incomplete judge')
        if contaminated:
            reasons.append('EURES results reached the disabled arm through another reader')
        report['arms'][arm] = {
            'status': 'not measured' if reasons else 'measured', 'reasons': reasons,
            'seconds': press.get('seconds'), 'first_job_s': (press.get('ttfr') or {}).get('first_in_places_s'),
            'first_fit70_s': (press.get('ttfr') or {}).get('first_fit70_s'), 'relevant': len(relevant),
            'eures_source': len(right([r for r in rows if eures_row(r)])),
            'other_sources': len(right([r for r in rows if not eures_row(r)])),
            'by_source': {source: len(right(items)) for source, items in sorted(sources.items())},
            'exact_overlap': len(keys & ref_keys), 'unmatched': len(keys - ref_keys),
            'unidentified': sum(identity(r) is None for r in relevant.values()), 'contamination': contaminated,
        }
    return report


def markdown(report):
    """The counts-only review artifact; missing measurements and conservative matching limits stay visible."""
    lines = [f"## EURES comparison · {gate.label(report['persona'])}", '']
    if report.get('error'):
        return '\n'.join([*lines, '**Not measured:** ' + report['error'], ''])
    lines += [f"Fresh EURES reference: **{report['reference']}** relevant title/employer pairs.",
              f"Run order: {' → '.join(report['order'])}. Same saved strategy; two fresh installs.", '',
              '| Measurement | Normal search | EURES reader disabled |', '|---|---:|---:|']
    for label, field in [('Status', 'status'), ('Press seconds', 'seconds'), ('First in-place job (s)', 'first_job_s'), ('First 70+ in-place job (s)', 'first_fit70_s'), ('Relevant pairs', 'relevant'),
                         ('From EURES', 'eures_source'), ('From other sources', 'other_sources'),
                         ('Exact overlap with reference', 'exact_overlap'), ('Unmatched pairs', 'unmatched'),
                         ('Missing employer identity', 'unidentified')]:
        values = [report['arms'][arm][field] for arm in ('normal', 'without_eures')]
        values = ['not reached' if value is None else value for value in values]
        lines.append(f'| {label} | {values[0]} | {values[1]} |')
    for name, arm in report['arms'].items():
        lines += ['', f"**{name}:** " + ('; '.join(arm['reasons']) or 'press completed'),
                  'Relevant pairs by source: ' + ', '.join(f'{source}: {n}' for source, n in arm['by_source'].items())]
    lines += ['', 'Overlap uses exact title and employer after case/whitespace normalization within this persona. '
              'Different wording can hide duplicates; unmatched pairs are not proven additional vacancies. '
              'Unknown employers cannot establish overlap. Source contributions can overlap and need not sum to the total. '
              'The reference is a sampled EURES read, not the whole portal. Live sites and AI load can differ between presses. '
              'Disabling the EURES reader does not prevent another source from linking to EURES; any such result invalidates the disabled arm.', '']
    return '\n'.join(lines)


def run(n, out):
    """Two isolated app-path presses through the caller's existing relay; no owner data or nightly uploads."""
    out = Path(out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    report = {'persona': int(n)}
    try:
        if not os.environ.get('CI') or os.environ.get('JOBADABRA_PERSONA_CODEX') != '1':
            raise ValueError('live comparisons require the CI Codex relay')
        order = ['normal', 'without_eures'] if int(n) % 2 else ['without_eures', 'normal']
        report['order'] = order
        pools = {'reference': reference.eures_rows(gate.PERSONAS[int(n) - 1])}
        presses = {}
        draft = None
        for arm in order:
            folder = out / arm
            gate.make_cv(n, folder)
            tag = f'eures-{n}-{arm}-{os.environ.get("GITHUB_RUN_ID", "local")}'
            command = ['node', str(HERE / 'run.mjs'), 'draw', str(folder), '--presses', '1', '--fresh', '--engine', 'api', '--tag', tag]
            if arm == 'without_eures':
                command.append('--without-eures')
            if draft:
                command += ['--draft', str(draft)]
            with (folder / 'run.log').open('w') as log:
                done = subprocess.run(command, cwd=HERE.parents[1], stdout=log, stderr=subprocess.STDOUT, check=False)
            if done.returncode:
                raise ValueError(f'{arm}: press runner failed; see arm run.log')
            draft = folder / 'draw' / 'draft.json'
            presses[arm] = json.loads((folder / 'draw' / 'presses.jsonl').read_text().splitlines()[0])
            if gate.refused_reason(folder / 'run.log'):
                raise ValueError(f'{arm}: AI refused; see arm run.log')
            if presses[arm].get('code') or presses[arm].get('crashes'):
                raise ValueError(f'{arm}: press failed; see arm run.log')
            if not presses[arm].get('scored_in_places') and presses[arm]['seconds'] >= gate.CUT_FROM_S:
                raise ValueError(f'{arm}: press reached its time limit without scoring; not a measured zero')
            db = Path(tempfile.gettempdir()) / f'jp-persona-draw-{tag}' / 'data' / 'jobs.sqlite'
            pools[arm] = gate.extract(db, folder / 'jobs.json', include_urls=True)
        combined = [r for rows in pools.values() for r in rows]
        gate_judge.judge(n, combined)
        if any(r.get('role') not in ('yes', 'no') or r.get('place') not in ('yes', 'no', 'remote', 'unknown') for r in combined):
            raise ValueError('incomplete judge; comparison not measured')
        report.update(summarize(pools, presses))
    except Exception as error:  # A failed read/judge is not a measured zero or an independent-discovery claim.
        report['error'] = f'{type(error).__name__}: {error}'
    (out / 'comparison.json').write_text(json.dumps(report, indent=2) + '\n')
    (out / 'comparison.md').write_text(markdown(report))
    print(markdown(report))
    return int(bool(report.get('error')) or any(a['status'] != 'measured' for a in report.get('arms', {}).values()))


if __name__ == '__main__':
    sys.exit(run(*sys.argv[1:3]))
