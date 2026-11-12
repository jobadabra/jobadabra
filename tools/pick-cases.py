"""Replays the fixed case sets of the steps that answer a numbered pick list (src/ai/providers/claude_code.py THINK_FIRST) with each step's own question,
on the person's Claude plan ($0, never an API key).

Usage: python3 tools/pick-cases.py [--step title|visit] [--runs 10] [--case <id>]
  title: tests/fixtures/title-cases.json, asked as src/ai/title_triage.py asks (engine.client(action='title_triage'))
  visit: tests/fixtures/visit-cases.json, asked as src/sources/visits.py relevant() asks (engine.client(action='visit_relevant'))
Prints one line per call (items marked "no" it kept, items marked "yes" it kept, seconds), then per case the calls that kept a "no" item.
Exit 1 when a call kept FAIL_AT or more "no" items. Why 2 (gp, 12 Nov 2026): the failure was one-turn answers keeping 2-15 of them on a list where
nothing fits (title sort 7 of 10 calls, visit list 8 of 10); both steps are lenient ("When unsure, include it" / "keep it"), and a single doubtful
keep came back on 2 of 30 calls of the structured answer and 1 of 20 of the one-turn answer on the title batches that hold right titles.
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
    os.environ.setdefault(name, tempfile.mkdtemp(prefix='pick-cases-'))

from src.ai import engine, title_triage  # noqa: E402
from src.sources import visits  # noqa: E402

FIXTURES = ROOT / 'tests' / 'fixtures'
FAIL_AT = 2


def title_question(case):
    """(action, model, system, schema, user text, answer key, [(item, want)]) of the title sort for one case."""
    items = [(title, want) for title, want in case['titles']]
    listed = '\n'.join(f'{n}. {title}' for n, (title, _) in enumerate(items, 1))
    return ('title_triage', title_triage.MODEL, title_triage.SYSTEM, title_triage.SCHEMA,
            f"The search (JSON): {json.dumps(case['search'], ensure_ascii=False)}\nThe titles:\n{listed}", 'fit', items)


def visit_question(case):
    """The same for the visit list's judge (visits.relevant), with the case's own "unsure" rule."""
    items = [(f'{name} ({url}) [{kind}]', want) for name, url, kind, want in case['sites']]
    listed = '\n'.join(f'{n}. {site}' for n, (site, _) in enumerate(items, 1))
    return ('visit_relevant', visits.RELEVANT_MODEL, f"{visits.RELEVANT_SYSTEM} {visits.RELEVANT_UNSURE[case['unsure']]}", visits.RELEVANT_SCHEMA,
            f"Their roles: {json.dumps(case['roles'], ensure_ascii=False)}\nTheir places: {json.dumps(case['places'], ensure_ascii=False)}\nThe sites:\n{listed}", 'keep', items)


STEPS = {'title': ('title-cases.json', title_question), 'visit': ('visit-cases.json', visit_question)}


def ask(question):
    """One call of a step -> ("no" items kept, "yes" items kept, "yes" items, seconds)."""
    action, model, system, schema, user, key, items = question
    client = engine.client(action=action)
    began = time.monotonic()
    response = client.messages.create(model=model, max_tokens=1500, system=[{'type': 'text', 'text': system}],
                                      messages=[{'role': 'user', 'content': user}], output_config=engine.structured(schema, model, 'low'))
    seconds = time.monotonic() - began
    picked = {int(n) for n in json.loads(response.content[0].text).get(key) or [] if str(n).isdigit()}
    wrong = [item for n, (item, want) in enumerate(items, 1) if want == 'no' and n in picked]
    right = [n for n, (_, want) in enumerate(items, 1) if want == 'yes']
    return wrong, sum(1 for n in right if n in picked), len(right), seconds


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--step', choices=sorted(STEPS), default='title')
    parser.add_argument('--runs', type=int, default=10)
    parser.add_argument('--case', default='')
    options = parser.parse_args()
    fixture, question = STEPS[options.step]
    cases = [case for case in json.loads((FIXTURES / fixture).read_text())['cases'] if not options.case or case['id'] == options.case]
    jobs = [case for case in cases for _ in range(options.runs)]
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda case: (case['id'], *ask(question(case))), jobs))
    failed = 0
    for case_id, wrong, kept, right, seconds in results:
        failed += len(wrong) >= FAIL_AT
        print(f'{case_id}: "no" kept {len(wrong)}, "yes" kept {kept}/{right}, {seconds:.1f} s{"  " + "; ".join(wrong[:3]) if wrong else ""}')
    for case in cases:
        mine = [r for r in results if r[0] == case['id']]
        print(f"{case['id']}: {sum(1 for r in mine if r[1])} of {len(mine)} calls kept a \"no\" item ({sum(len(r[1]) for r in mine)} in all; "
              f"{sum(1 for r in mine if len(r[1]) >= FAIL_AT)} kept {FAIL_AT} or more); mean {sum(r[4] for r in mine) / len(mine):.1f} s")
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
