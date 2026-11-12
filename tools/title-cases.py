"""Replays the title step's fixed case set (tests/fixtures/title-cases.json) with the step's own question on the person's Claude plan ($0, never an API key).

Usage: python3 tools/title-cases.py [--runs 10] [--case <id>]
Each case is one numbered batch of titles, asked as src/ai/title_triage.py asks it, through the client it makes (engine.client(action='title_triage')).
Prints one line per call (titles of other work it kept, right titles kept, seconds), then per case the calls that kept any title of other work.
Exit 1 when a call kept FAIL_AT or more titles of other work. Why 2 (gp, 12 Nov 2026): the failure was one-turn answers naming 2-14 of them on a batch where
no title fits (7 of 10 calls); the step is lenient by the owner's 7 Oct 2026 "Only the location should be strict", and a single doubtful yes came back on
2 of 30 calls of the structured answer and 1 of 20 of the one-turn answer on the batches that hold right titles.
"""
import argparse
import json
import os
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ['JOBADABRA_AI_ENGINE'] = 'cli'   # the person's own Claude Code: the replay never reaches an API account
os.environ['ANTHROPIC_API_KEY'] = ''
for name in ('JOBADABRA_DATA_DIR', 'JOBADABRA_CONFIG_DIR'):   # a folder of its own: never the app's data
    os.environ.setdefault(name, tempfile.mkdtemp(prefix='title-cases-'))

from src.ai import engine, title_triage  # noqa: E402

CASES = ROOT / 'tests' / 'fixtures' / 'title-cases.json'
FAIL_AT = 2


def ask(client, case):
    """One call of the title step on the case's batch -> (titles of other work kept, right titles kept, right titles, seconds)."""
    titles = [title for title, _ in case['titles']]
    listed = '\n'.join(f'{n}. {title}' for n, title in enumerate(titles, 1))
    began = time.monotonic()
    response = client.messages.create(model=title_triage.MODEL, max_tokens=1500, system=[{'type': 'text', 'text': title_triage.SYSTEM}],
                                      messages=[{'role': 'user', 'content': f"The search (JSON): {json.dumps(case['search'], ensure_ascii=False)}\nThe titles:\n{listed}"}],
                                      output_config=engine.structured(title_triage.SCHEMA, title_triage.MODEL, 'low'))
    seconds = time.monotonic() - began
    fit = {int(n) for n in json.loads(response.content[0].text).get('fit') or [] if str(n).isdigit()}
    wrong = [title for n, (title, want) in enumerate(case['titles'], 1) if want == 'no' and n in fit]
    right = [n for n, (_, want) in enumerate(case['titles'], 1) if want == 'yes']
    return wrong, sum(1 for n in right if n in fit), len(right), seconds


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runs', type=int, default=10)
    parser.add_argument('--case', default='')
    options = parser.parse_args()
    cases = [case for case in json.loads(CASES.read_text())['cases'] if not options.case or case['id'] == options.case]
    client = engine.client(action='title_triage')
    jobs = [case for case in cases for _ in range(options.runs)]
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda case: (case['id'], *ask(client, case)), jobs))
    failed = 0
    for case_id, wrong, kept, right, seconds in results:
        failed += len(wrong) >= FAIL_AT
        print(f'{case_id}: other work kept {len(wrong)}, right kept {kept}/{right}, {seconds:.1f} s{"  " + "; ".join(wrong[:3]) if wrong else ""}')
    for case in cases:
        mine = [r for r in results if r[0] == case['id']]
        print(f"{case['id']}: {sum(1 for r in mine if r[1])} of {len(mine)} calls kept other work ({sum(len(r[1]) for r in mine)} titles; "
              f"{sum(1 for r in mine if len(r[1]) >= FAIL_AT)} kept {FAIL_AT} or more); mean {sum(r[4] for r in mine) / len(mine):.1f} s")
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
