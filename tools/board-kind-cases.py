"""Replays the board-kind case set (tests/fixtures/board-kind-cases.json) through both board judges of src/sources/board_check.py, main's words
on main's page (before) against this branch's words on this branch's page (after), on the person's own plan engine ($0, never an API key).

Usage: python3 tools/board-kind-cases.py [--engine cli|codex] [--asks 5] [--judge field|kind|both] [--base origin/main] [--case <id>]
       python3 tools/board-kind-cases.py --record   (writes each case's after side: the text this branch's judges send, one plain GET a page)
Each case is asked --asks times a side, one call each (decide._ask: no cache, no batch with another case), and prints per case and side the
answers and "n of N right", then the totals. A case is fixed only when all its asks on the after side are right: a flip is reported as such.
An engine failure is shown as "unknown" and left out of "n of N". A 'scripted' case is not asked after (board_check returns 'browser' / None); before, it is right when the board is not left out.
"""
import argparse
import ast
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ['ANTHROPIC_API_KEY'] = ''   # the plan engines only: the replay never reaches an API account
os.environ['OPENAI_API_KEY'] = ''
for name in ('JOBADABRA_DATA_DIR', 'JOBADABRA_CONFIG_DIR'):   # a folder of its own: never the app's data
    os.environ[name] = tempfile.mkdtemp(prefix='board-kind-cases-')

FIXTURE = ROOT / 'tests' / 'fixtures' / 'board-kind-cases.json'
RIGHT = {'field': {'board': {'field board', 'job board'}, 'other': {'other'}, 'one employer': {'one employer'}},
         'kind': {'board': {'job board'}, 'other': {'other'}, 'one employer': {'one employer'}}}


def words(base):
    """{'INSTRUCTIONS': ..., 'FIELD_INSTRUCTIONS': ...} of board_check.py at `base` (git), read without importing it."""
    source = subprocess.run(['git', 'show', f'{base}:src/sources/board_check.py'], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    known = {}   # every top-level string constant in order, so one built from another (JOB_BOARD_EXAMPLES) reads as the module does
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
            try:
                known[node.targets[0].id] = eval(compile(ast.Expression(node.value), 'board_check', 'eval'), {'__builtins__': {}}, dict(known))
            except Exception:  # noqa: BLE001 — not a plain string constant (a class, a call): not a prompt
                continue
    return {name: known[name] for name in ('INSTRUCTIONS', 'FIELD_INSTRUCTIONS')}


def record(cases):
    """Each case's after side: the exact text this branch's field_kind and kind send for its link, or scripted (neither asked), pages read once each
    through the engine's own reader, 2 s apart."""
    import time
    from src.sources import board_check, careers
    careers.READER = 'auto'
    pages = {}

    def get(url):
        if url not in pages:
            time.sleep(2)
            try:
                pages[url] = str(careers.get_text(url) or '')
            except Exception as error:  # noqa: BLE001 — kept and raised again: the judge's own fallback is recorded
                pages[url] = error
        if isinstance(pages[url], Exception):
            raise pages[url]
        return pages[url]
    for case in cases:
        sent = {}
        board = {'search_url': case['link']}
        board_check.field_kind(board, get, case['roles'], ask=lambda topic, key, text, *_, kept=sent: kept.setdefault('field', text))
        board_check.kind(board, get, case['roles'][0], ask=lambda topic, key, text, *_, kept=sent: kept.setdefault('kind', text))
        case['after'] = sent or {'scripted': True}   # neither judge asked: a list built by scripts (or no page at all)
        print(case['id'], sorted(case['after']), flush=True)


def right(judge, want, answer):
    """True when the answer is the case's: a scripted list is right when the board is not left out."""
    if want == 'scripted':
        return answer not in ('other', 'one employer')
    return answer in RIGHT[judge][want]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--engine', choices=('cli', 'codex'), default='cli')
    parser.add_argument('--asks', type=int, default=5)
    parser.add_argument('--judge', choices=('field', 'kind', 'both'), default='both')
    parser.add_argument('--base', default='origin/main')
    parser.add_argument('--case', default='')
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--record', action='store_true')
    options = parser.parse_args()
    if options.record:
        data = json.loads(FIXTURE.read_text())
        record(data['cases'])
        FIXTURE.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n')
        return
    os.environ['JOBADABRA_AI_ENGINE'] = options.engine
    from src.ai import decide, engine
    from src.sources import board_check
    decide._db = lambda: sqlite3.connect(':memory:')   # never the cache: every ask is a fresh call
    before = words(options.base)
    after = {'INSTRUCTIONS': board_check.INSTRUCTIONS, 'FIELD_INSTRUCTIONS': board_check.FIELD_INSTRUCTIONS}
    cases = [case for case in json.loads(FIXTURE.read_text())['cases'] if not options.case or case['id'] == options.case]
    judges = ('field', 'kind') if options.judge == 'both' else (options.judge,)
    client = engine.client(action='decide')

    def ask(job):
        case, judge, side, n = job
        seen = case[side]
        if seen.get('scripted'):
            return job, 'not asked'
        if judge not in seen:
            return job, 'no page'
        host, text = case['link'].split('/')[2], seen[judge]
        words_of = before if side == 'before' else after
        if judge == 'field':
            topic, answers, instructions = board_check.FIELD_TOPIC, board_check.FIELD_KINDS, words_of['FIELD_INSTRUCTIONS']
        else:
            topic, answers, instructions = board_check.TOPIC, board_check.KINDS, words_of['INSTRUCTIONS']
        decide.reset_run()
        got = decide._ask(topic, [(host, text)], answers, instructions, client, 10 ** 6)[0]
        return job, got if isinstance(got, str) else 'unknown'

    jobs = [(case, judge, side, n) for case in cases for judge in judges for side in ('before', 'after') for n in range(options.asks)]
    results = {}
    with ThreadPoolExecutor(max_workers=options.workers) as pool:
        for (case, judge, side, n), answer in pool.map(ask, jobs):
            results.setdefault((case['id'], judge, side), []).append(answer)
            print(f"{case['id']:34} {judge:5} {side:6} #{n + 1}: {answer}", flush=True)
    print(f"\nengine {options.engine}, {options.asks} asks a side, base {options.base}")
    totals = Counter()
    for judge in judges:
        print(f"\n| {judge} judge | want | before (main) | after (branch) |\n|---|---|---|---|")
        for case in cases:
            row = []
            for side in ('before', 'after'):
                got = results[(case['id'], judge, side)]
                answered = [answer for answer in got if answer != 'unknown']   # an engine failure (CliError) is not an answer
                ok = sum(right(judge, case['want'], answer) for answer in answered)
                totals[(judge, side)] += bool(answered) and ok == len(answered)
                common = ', '.join(f'{answer} ×{count}' for answer, count in Counter(got).most_common())
                row.append(f"{ok} of {len(answered)} right ({common})")
            print(f"| {case['id']} | {case['want']} | {row[0]} | {row[1]} |")
        print(f"| **cases right on every ask** | | **{totals[(judge, 'before')]} of {len(cases)}** | **{totals[(judge, 'after')]} of {len(cases)}** |")


if __name__ == '__main__':
    main()
