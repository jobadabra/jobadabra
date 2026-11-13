"""Replays the fit score's fixed case set (tests/fixtures/score-cases.json) through the app's own score._score_once on the person's Claude plan ($0, never an API key).

Usage: python3 tools/score-cases.py [--runs 3] [--model claude-sonnet-5-5] [--engine cli|codex]
Prints one line per case and run (pass, or what failed, with the ring and the AI's own fit to the search), then the totals. Exit 1 when any case failed.
The ring is the scorer's own overall (13 Nov 2026, owner: "We should be realistic"); the fit to the search never replaces it. Every case also holds the
invariant ring_over_fit_max: the overall is at most the fit to the search + 25. The role check (`searched`) is stubbed to yes: no call, no store.
--engine: cli = the person's Claude Code (Claude plan, default), codex = their Codex CLI (ChatGPT plan); both $0. Free AI is replayed through
tools/free-ai-eval.mjs on its own token, never here, in two steps: `--dump-free cases.json` writes the real score requests (runs x cases, no call),
then `node tools/free-ai-eval.mjs --cases cases.json --models small --allow-production --max-calls <n> --raw raw.jsonl` (the owner's yes for the spend),
then `--check-free raw.jsonl` applies the app's own score_search.apply to each reply and holds it to the same expectations (one ask per case:
the app's second ask on Free AI, score_agree, is not replayed).
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
ENGINE = sys.argv[sys.argv.index('--engine') + 1] if '--engine' in sys.argv else 'cli'
assert ENGINE in ('cli', 'codex'), 'a plan engine only: no API key is ever used here'
os.environ['JOBADABRA_AI_ENGINE'] = ENGINE   # the person's own Claude Code or Codex: the eval never reaches an API account
os.environ['ANTHROPIC_API_KEY'] = ''
os.environ['JOBADABRA_CONFIG_DIR'] = str(ROOT / 'tests' / 'fixtures' / 'config')   # the fictional SRE in Zurich, never the person's settings or places
os.environ['JOBADABRA_DATA_DIR'] = tempfile.mkdtemp(prefix='jobadabra-score-cases-')   # a throwaway store: the replay never reads or writes the app's data

from src.ai import engine, locations, score, score_search  # noqa: E402

RING_OVER_FIT_MAX = 25   # Why (13 Nov 2026, owner: "We should be realistic"): the overall may not climb far above the fit to the search; a replay that breaks it is the only reason to add a prompt sentence
GOLDEN = ROOT / 'desktop' / 'e2e' / 'fixtures' / 'golden'


def failures(case, data):
    """What the scored answer got wrong against the case's expectations: a list of short reasons, empty when it passed."""
    want, out = case['expect'], []
    total, part = int(data['score']), data.get('search') or {}
    fit = part.get('fit')
    if 'score_max' in want and total > want['score_max']:
        out.append(f"score {total} above {want['score_max']}")
    if 'score_min' in want and total < want['score_min']:
        out.append(f"score {total} under {want['score_min']}")
    if 'fit_max' in want and isinstance(fit, int) and fit > want['fit_max']:
        out.append(f"search fit {fit} above {want['fit_max']}")
    if 'fit_min' in want and isinstance(fit, int) and fit < want['fit_min']:
        out.append(f"search fit {fit} under {want['fit_min']}")
    if isinstance(fit, int) and total > fit + RING_OVER_FIT_MAX:
        out.append(f"ring {total} is more than {RING_OVER_FIT_MAX} above the search fit {fit}")
    if 'career_change' in want and part.get('career_change') is not want['career_change']:
        out.append(f"career_change {part.get('career_change')!r}, wanted {want['career_change']!r}")
    if want.get('gap') and not (data.get('search') or {}).get('cv_gap'):
        out.append('cv_gap empty')
    location = (data.get('components') or {}).get('location')
    if 'location_min' in want and isinstance(location, (int, float)) and location < want['location_min']:
        out.append(f"location {location} under {want['location_min']}")
    if 'needs_credential' in want and (data.get('search') or {}).get('needs_credential') is not want['needs_credential']:
        out.append(f"needs_credential {(data.get('search') or {}).get('needs_credential')!r}, wanted {want['needs_credential']!r}")
    return out


def job_of(case):
    """The case's posting as the scorer takes it: its own text, or a golden job's (fixtures/golden/truth.json) named by id."""
    if case.get('golden'):
        item = next(j for j in json.loads((GOLDEN / 'truth.json').read_text(encoding='utf-8')) if str(j['id']) == case['golden'])
        return {'title': item['title'], 'company': 'Example Co', 'location': item['location'], 'description': item['description'], 'url': item['url']}
    return dict(case['job'], url=f"https://example.com/{case['id']}")


class Stop(Exception):
    pass


class Capture:
    """A client that keeps the request the scorer builds and stops: the real prompt, no call."""
    def __init__(self):
        self.params, self.messages = None, self

    def create(self, **params):
        self.params = params
        raise Stop


def free_ai(args, fixture, profile, lock_roles, places_now):
    """--dump-free: every case's real score request, repeated --runs times, as free-ai-eval.mjs cases. --check-free: its replies against the expectations."""
    cases = []
    for case in fixture['cases']:
        lock_roles['roles'] = case['search']
        locations.block_now = (lambda places: lambda: locations.block({'locations': places}))(case['places']) if case.get('places') else places_now
        capture = Capture()
        try:
            score._ask(capture, args.model, dict(job_of(case), ai={}), profile + case.get('profile_add', ''), None, '', score.SCHEMA)
        except Stop:
            pass
        cases += [{'id': case['id'], 'action': 'score', 'params': {k: v for k, v in capture.params.items() if k != 'model'}}] * args.runs
    if args.dump_free:
        Path(args.dump_free).write_text(json.dumps(cases, ensure_ascii=False), encoding='utf-8')
        print(f'{len(cases)} requests written ({len(fixture["cases"])} cases x {args.runs} runs): the call count to cap the Free AI run at', flush=True)
        return 0
    by_id = {case['id']: case for case in fixture['cases']}
    seen, bad = {}, 0
    for line in Path(args.check_free).read_text(encoding='utf-8').splitlines():
        for result in json.loads(line)['results']:
            case, run = by_id[result['id']], seen.get(result['id'], 0) + 1
            seen[result['id']] = run
            if not result.get('reply'):
                failed, shown = ['no reply'], ''
            else:
                data = score_search.apply(dict(result['reply']), dict(job_of(case)))
                failed, shown = failures(case, data), f"score {data['score']}, fit {(data.get('search') or {}).get('fit')}, gap {(data.get('search') or {}).get('cv_gap')!r}"
            bad += bool(failed)
            print(f"{'pass' if not failed else 'FAIL'} {result['id']} run {run} ({shown}){'' if not failed else ': ' + '; '.join(failed)}", flush=True)
    print(f"{sum(seen.values()) - bad} of {sum(seen.values())} passed (Free AI, model per desktop/lib/free-ai-models.js SMALL)", flush=True)
    return 1 if bad else 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runs', type=int, default=3)
    parser.add_argument('--model', default=score.DEFAULT_MODEL)
    parser.add_argument('--engine', choices=('cli', 'codex'), default='cli')
    parser.add_argument('--dump-free', metavar='CASES_JSON')
    parser.add_argument('--check-free', metavar='RAW_JSONL')
    args = parser.parse_args()
    fixture = json.loads((ROOT / 'tests' / 'fixtures' / 'score-cases.json').read_text(encoding='utf-8'))
    profile = (GOLDEN / 'candidate.txt').read_text(encoding='utf-8')
    client = engine.client(action='score')
    lock_roles = {}
    places_now = locations.block_now
    score_search._roles = lambda search=None: lock_roles.get('roles', [])
    score_search._search_role = lambda job: True   # the role check (two AI yeses), stubbed: no call, no store; it only sets `searched`

    if args.dump_free or args.check_free:
        return free_ai(args, fixture, profile, lock_roles, places_now)

    def one(task):
        case, run = task
        try:
            data, usage = score.score_one(client, args.model, dict(job_of(case), ai={}), profile + case.get('profile_add', ''))
        except Exception as error:   # one failed call is a failed case, the others still run
            return case['id'], run, [f'error: {type(error).__name__}: {error}'], ''
        return case['id'], run, failures(case, data), f"score {data['score']}, fit {(data.get('search') or {}).get('fit')}, gap {(data.get('search') or {}).get('cv_gap')!r}"

    results = []
    for case in fixture['cases']:   # one case's roles at a time: the search block is a module-level read
        lock_roles['roles'] = case['search']
        # A case's own Strategy places (else the fixture config's): the places block is a module-level read too, so one case at a time.
        locations.block_now = (lambda places: lambda: locations.block({'locations': places}))(case['places']) if case.get('places') else places_now
        with ThreadPoolExecutor(max_workers=3) as pool:
            results += list(pool.map(one, [(case, run) for run in range(1, args.runs + 1)]))
    for case_id, run, failed, seen in results:
        print(f"{'pass' if not failed else 'FAIL'} {case_id} run {run} ({seen}){'' if not failed else ': ' + '; '.join(failed)}", flush=True)
    passed = sum(1 for _, _, failed, _ in results if not failed)
    print(f"{passed} of {len(results)} passed{' (' + args.engine + ')'}", flush=True)
    return 0 if passed == len(results) else 1


if __name__ == '__main__':
    sys.exit(main())
