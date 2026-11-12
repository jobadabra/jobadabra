"""Replays the fixed case sets of the steps that answer a numbered pick list (src/ai/providers/claude_code.py THINK_FIRST) with each step's own question,
on the person's Claude plan ($0, never an API key).

Usage: python3 tools/pick-cases.py [--step title|visit] [--runs 10] [--case <id>] [--paths one-turn,think-first]
  title: tests/fixtures/title-cases.json, asked as src/ai/title_triage.py asks (engine.client(action='title_triage'))
  visit: tests/fixtures/visit-cases.json, asked as src/sources/visits.py relevant() asks (engine.client(action='visit_relevant'))
Prints one line per call (items marked "no" it kept, items marked "yes" it kept, seconds), then per case and path the calls that kept a "no" item,
the "yes" items kept, seconds a call and items sorted a second (a slower call sorts fewer titles inside a press's budget: say both paths in the PR).
Exit 1 when a think-first call kept FAIL_AT or more "no" items. Why 2 (gp, 12 Nov 2026): the failure was one-turn answers keeping 2-15 of them on a list where
nothing fits (title sort 7 of 10 calls, visit list 8 of 10); both steps are lenient ("When unsure, include it" / "keep it"), and a single doubtful
keep came back on 2 of 30 calls of the structured answer and 1 of 20 of the one-turn answer on the title batches that hold right titles.
"""
import argparse
import json
import os
import statistics
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
    os.environ[name] = tempfile.mkdtemp(prefix='pick-cases-')   # even when set: a shell opened from the app carries the app's folders

from src.ai import engine, title_triage  # noqa: E402
from src.sources import visits  # noqa: E402

FIXTURES = ROOT / 'tests' / 'fixtures'
FAIL_AT = 2


def title_question(case):
    """(action, model, system, schema, user text, answer key, [(item, want)]) of the title sort for one case."""
    items = [(title, want) for title, want in case['titles']]
    listed = '\n'.join(f'{n}. {title}' for n, (title, _) in enumerate(items, 1))
    return ('title_triage', title_triage.MODEL, title_triage.SYSTEM, title_triage.SCHEMA,
            f"The search (JSON): {json.dumps(case['search'], ensure_ascii=False)}\nThe titles:\n{listed}", ('fit', 'near'), items)   # kept = its own kind of work or a close neighbour (12 Nov 2026: three groups)


def visit_question(case):
    """The same for the visit list's judge, each site written as relevant() writes it (a case row's optional 5th field is its "found in"),
    with the case's own "unsure" rule."""
    items = [(f'{row[0]} ({row[1]}) [{row[2]}]' + (f' found in: {row[4]}' if len(row) > 4 and row[4] else ''), row[3]) for row in case['sites']]   # relevant()'s line
    listed = '\n'.join(f'{n}. {site}' for n, (site, _) in enumerate(items, 1))
    return ('visit_relevant', visits.RELEVANT_MODEL, f"{visits.RELEVANT_SYSTEM} {visits.RELEVANT_UNSURE[case['unsure']]}", visits.RELEVANT_SCHEMA,
            f"Their roles: {json.dumps(case['roles'], ensure_ascii=False)}\nTheir places: {json.dumps(case['places'], ensure_ascii=False)}\nThe sites:\n{listed}", 'keep', items)


STEPS = {'title': ('title-cases.json', title_question), 'visit': ('visit-cases.json', visit_question)}


def ask(question, path):
    """One call of a step on one path -> ("no" items kept, "yes" items kept, "yes" items, seconds). `path`: 'think-first' asks as the step does (its own
    action, so THINK_FIRST steps get Claude Code's structured answer); 'one-turn' asks with no step name, so Claude Code answers as text in one turn (#3836)."""
    action, model, system, schema, user, key, items = question
    client = engine.client(action=action if path == 'think-first' else '')
    began = time.monotonic()
    response = client.messages.create(model=model, max_tokens=1500, system=[{'type': 'text', 'text': system}],
                                      messages=[{'role': 'user', 'content': user}], output_config=engine.structured(schema, model, 'low'))
    seconds = time.monotonic() - began
    answer = json.loads(response.content[0].text)
    picked = {int(n) for group in ([key] if isinstance(key, str) else key) for n in answer.get(group) or [] if str(n).isdigit()}
    wrong = [item for n, (item, want) in enumerate(items, 1) if want == 'no' and n in picked]
    right = [n for n, (_, want) in enumerate(items, 1) if want == 'yes']
    return wrong, sum(1 for n in right if n in picked), len(right), seconds


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--step', choices=sorted(STEPS), default='title')
    parser.add_argument('--runs', type=int, default=10)
    parser.add_argument('--case', default='')
    # Why (sa, 12 Nov 2026, the owner asked whether CI caught #3891's right-job loss; it did not): the think-first answer took ~5 s a batch against ~3 s,
    # so a press sorted 947 titles against 1,169 and listed fewer right jobs; a replay plays recorded answers at the recorded pace and cannot see it.
    # Both paths side by side, with seconds per call and items per second, so a slower or larger call shows on the fixed set before any live proof.
    parser.add_argument('--paths', default='one-turn,think-first', help='one-turn, think-first or both (comma)')
    options = parser.parse_args()
    paths = [p for p in options.paths.split(',') if p in ('one-turn', 'think-first')]
    fixture, question = STEPS[options.step]
    cases = [case for case in json.loads((FIXTURES / fixture).read_text())['cases'] if not options.case or case['id'] == options.case]
    jobs = [(case, path) for case in cases for path in paths for _ in range(options.runs)]
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda job: (job[0]['id'], job[1], len(question(job[0])[6]), *ask(question(job[0]), job[1])), jobs))
    failed = 0
    for case_id, path, size, wrong, kept, right, seconds in results:
        failed += path == 'think-first' and len(wrong) >= FAIL_AT
        print(f'{case_id} [{path}]: "no" kept {len(wrong)}, "yes" kept {kept}/{right}, {seconds:.1f} s{"  " + "; ".join(wrong[:3]) if wrong else ""}')
    for case in cases:
        for path in paths:
            mine = [r for r in results if r[0] == case['id'] and r[1] == path]
            seconds = statistics.median(r[6] for r in mine)
            print(f"{case['id']} [{path}]: {sum(1 for r in mine if r[3])} of {len(mine)} calls kept a \"no\" item ({sum(len(r[3]) for r in mine)} in all; "
                  f"{sum(1 for r in mine if len(r[3]) >= FAIL_AT)} kept {FAIL_AT} or more); \"yes\" kept {sum(r[4] for r in mine)}/{sum(r[5] for r in mine)}; "
                  f"{seconds:.1f} s a call (median), {mine[0][2] / seconds:.1f} items sorted a second")
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
