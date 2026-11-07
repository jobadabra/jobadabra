"""Replays the fit score's fixed case set (tests/fixtures/score-cases.json) through the app's own score._score_once on the person's Claude plan ($0, never an API key).

Usage: python3 tools/score-cases.py [--runs 3] [--model claude-sonnet-5-5] [--lift]
Prints one line per case and run (pass, or what failed, with the score and the AI's own fit to the search), then the totals. Exit 1 when any case failed.
--lift: also let the title check raise a career change's fit to SEARCH_ROLE_FIT (score_search.apply); off by default, so the line measures the prompt alone.
The profile is the golden fictional candidate (desktop/e2e/fixtures/golden/candidate.txt); a case's search roles stand in for the person's search.
"""
import argparse
import json
import os
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ['JOBADABRA_AI_ENGINE'] = 'cli'   # the person's own Claude Code: the eval never reaches an API account
os.environ['ANTHROPIC_API_KEY'] = ''
os.environ['JOBADABRA_CONFIG_DIR'] = str(ROOT / 'tests' / 'fixtures' / 'config')   # the fictional SRE in Zurich, never the person's settings or places
os.environ['JOBADABRA_DATA_DIR'] = tempfile.mkdtemp(prefix='jobadabra-score-cases-')   # a throwaway store: the replay never reads or writes the app's data

from src.ai import engine, score, score_search  # noqa: E402

GOLDEN = ROOT / 'desktop' / 'e2e' / 'fixtures' / 'golden'


def failures(case, data):
    """What the scored answer got wrong against the case's expectations: a list of short reasons, empty when it passed."""
    want, out = case['expect'], []
    total, fit = int(data['score']), (data.get('search') or {}).get('asked')
    if 'score_max' in want and total > want['score_max']:
        out.append(f"score {total} above {want['score_max']}")
    if 'score_min' in want and total < want['score_min']:
        out.append(f"score {total} under {want['score_min']}")
    if 'fit_max' in want and isinstance(fit, int) and fit > want['fit_max']:
        out.append(f"search fit {fit} above {want['fit_max']}")
    if want.get('gap') and not (data.get('search') or {}).get('cv_gap'):
        out.append('cv_gap empty')
    return out


def job_of(case):
    """The case's posting as the scorer takes it: its own text, or a golden job's (fixtures/golden/truth.json) named by id."""
    if case.get('golden'):
        item = next(j for j in json.loads((GOLDEN / 'truth.json').read_text(encoding='utf-8')) if str(j['id']) == case['golden'])
        return {'title': item['title'], 'company': 'Example Co', 'location': item['location'], 'description': item['description'], 'url': item['url']}
    return dict(case['job'], url=f"https://example.com/{case['id']}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--model', default=score.DEFAULT_MODEL)
    parser.add_argument('--lift', action='store_true')
    args = parser.parse_args()
    fixture = json.loads((ROOT / 'tests' / 'fixtures' / 'score-cases.json').read_text(encoding='utf-8'))
    profile = (GOLDEN / 'candidate.txt').read_text(encoding='utf-8')
    client = engine.client(action='score')
    lock_roles = {}
    score_search._roles = lambda search=None: lock_roles.get('roles', [])
    if not args.lift:
        score_search._search_role = lambda job: False

    def one(task):
        case, run = task
        try:
            data, usage = score.score_one(client, args.model, dict(job_of(case), ai={}), profile)
        except Exception as error:   # one failed call is a failed case, the others still run
            return case['id'], run, [f'error: {type(error).__name__}: {error}'], ''
        return case['id'], run, failures(case, data), f"score {data['score']}, fit {(data.get('search') or {}).get('asked')}, gap {(data.get('search') or {}).get('cv_gap')!r}"

    results = []
    for case in fixture['cases']:   # one case's roles at a time: the search block is a module-level read
        lock_roles['roles'] = case['search']
        with ThreadPoolExecutor(max_workers=3) as pool:
            results += list(pool.map(one, [(case, run) for run in range(1, args.runs + 1)]))
    for case_id, run, failed, seen in results:
        print(f"{'pass' if not failed else 'FAIL'} {case_id} run {run} ({seen}){'' if not failed else ': ' + '; '.join(failed)}", flush=True)
    passed = sum(1 for _, _, failed, _ in results if not failed)
    print(f"{passed} of {len(results)} passed{' (with the title lift)' if args.lift else ''}", flush=True)
    return 0 if passed == len(results) else 1


if __name__ == '__main__':
    sys.exit(main())
