"""Guard: release (and safety, see TheStartWorkflowRunsOnlyMainsCode) — a search PR must get its before/after row from the PR's opening and its pair only when it needs one: a missing row lets an unproven PR through, an extra pair burns broker room and
a body edit that restarts a running pair loses its numbers (owner via sa, 13 Nov 2026: "instead of having \"DONT MERGE\"... we'll just have red check"; sa: "do not run a pair a push does not need")."""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'tools' / 'persona-search'))
import start  # noqa: E402

REACH = ['src/sources/careers_parse.py', 'docs/x.md']
MOVES = 'Moves: p3 right jobs 0 → pending (1 run a side, same minute, usual difference 2)\nMoves: c04 right jobs 9 → pending (1 run a side, same minute, usual difference not measured yet)'


class WhatTheRowSays(unittest.TestCase):
    def test_a_pr_with_no_search_file_gets_no_row(self):
        self.assertEqual(start.decide(['docs/x.md', 'tools/ship.sh'], MOVES)['action'], 'none')

    def test_every_src_ai_board_file_is_in_reach(self):
        for path in ('src/ai/board_ideas.py', 'src/ai/board_search_first.py', 'src/ai/board_web.py', 'src/sources/careers_parse.py'):
            self.assertEqual(start.in_reach([path]), [path], path)

    def test_no_person_named_is_red_with_the_way_out(self):
        out = start.decide(REACH, 'A body with no moves line')
        self.assertEqual((out['action'], out['title']), ('red', 'name up to 3 people in a Moves line'))
        self.assertIn('Moves: nothing', out['summary'])

    def test_a_moves_nothing_line_is_green_with_its_reason_visible(self):
        out = start.decide(REACH, 'Moves: nothing (a log line only; no read changes)')
        self.assertEqual(out['action'], 'green')
        self.assertIn('no search change: a log line only; no read changes', out['title'])

    def test_the_people_are_the_moves_lines_in_order_night_people_as_numbers(self):
        out = start.decide(REACH, MOVES)
        self.assertEqual((out['action'], out['people']), ('wait', [3, 'c04']))
        self.assertEqual(out['external_id'], 'search-pair:waiting:3,c04')

    def test_at_most_three_people_and_no_person_twice(self):
        body = '\n'.join(f'Moves: {p} right jobs 1 → pending (1 run a side, same minute, usual difference 2)' for p in ('p1', 'p2', 'p2', 'b10', 'c04'))
        self.assertEqual(start.named(body), [1, 2, 'b10'])


class ABodyEditDoesNotRestartAPair(unittest.TestCase):
    def test_the_same_people_on_a_row_that_waits_runs_or_counted_is_nothing_to_do(self):
        for state in ('waiting', 'running', 'done', 'carried'):
            row = start.external_id(state, [3, 'c04'])
            self.assertEqual(start.decide(REACH, MOVES + '\nmore words', row)['action'], 'none', state)

    def test_other_people_make_a_new_row(self):
        row = start.external_id('running', [3])
        self.assertEqual(start.decide(REACH, MOVES, row)['action'], 'wait')

    def test_a_row_that_is_not_ours_does_not_stop_the_row(self):
        self.assertEqual(start.decide(REACH, MOVES, 'something-else')['action'], 'wait')


class CarryAndReady(unittest.TestCase):
    def test_a_head_whose_search_files_are_the_paired_heads_carries_the_result(self):
        self.assertEqual(start.carry(['tests/tooling/ci/test_x.py', '.github/workflows/x.yml', 'docs/y.md']), 'carry')
        self.assertEqual(start.carry(['tests/x.py', 'src/sources/feeds.py']), 'search')

    def test_a_compare_list_cut_at_githubs_cap_never_proves_nothing_differs(self):
        self.assertEqual(start.carry([f'docs/{n}.md' for n in range(start.COMPARE_CAP)]), 'search')
        self.assertEqual(start.carry([f'docs/{n}.md' for n in range(start.COMPARE_CAP - 1)]), 'carry')

    def test_the_pair_waits_for_every_other_check_but_not_for_itself(self):
        runs = [{'name': 'Unit', 'status': 'completed', 'conclusion': 'success'}, {'name': start.ROW, 'status': 'in_progress', 'conclusion': None},
                {'name': 'Gitar', 'status': 'completed', 'conclusion': 'neutral'}]
        self.assertEqual(start.ready(runs, [{'context': 'All checks passed', 'state': 'pending'}]), (True, ''))
        self.assertEqual(start.ready(runs + [{'name': 'Integration', 'status': 'in_progress', 'conclusion': None}], []), (False, 'Integration has not ended'))
        self.assertEqual(start.ready(runs + [{'name': 'Guard', 'status': 'completed', 'conclusion': 'failure'}], [])[0], False)
        self.assertEqual(start.ready(runs, [{'context': 'PR description', 'state': 'pending'}])[0], False)


WORKFLOW = Path(__file__).resolve().parents[3] / '.github' / 'workflows' / 'search-pair-start.yml'


class TheStartWorkflowRunsOnlyMainsCode(unittest.TestCase):
    """Guard: safety — pull_request_target runs with the repo's token on a PR's events: checking out or running the PR's code there would hand the token to it (sa, 13 Nov 2026)."""

    def test_every_checkout_is_the_default_branch_and_nothing_from_the_pr_reaches_a_run_line(self):
        text = WORKFLOW.read_text(encoding='utf-8')
        checkouts = re.findall(r'uses: actions/checkout@\S+\n(?:\s+(?:with:|[a-z-]+:.*)\n)*', text)
        self.assertTrue(checkouts)
        for block in checkouts:
            self.assertIn('ref: ${{ github.event.repository.default_branch }}', block)
        for run in re.findall(r'\n\s+run: [|>]?-?\n?((?:(?:\s{10,}.*)?\n)+)', text):
            self.assertNotIn('${{ github.event.pull_request', run)   # body, title, head.ref ... come in through env, never into a script line
            self.assertNotIn('${{ github.head_ref', run)
        self.assertNotIn('github.event.pull_request.title', text)   # no title is read at all


if __name__ == '__main__':
    unittest.main()
