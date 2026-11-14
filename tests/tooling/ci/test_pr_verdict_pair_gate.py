"""Guard: release — "All checks passed" on a search PR reads the pair's "Search before/after" row, so a PR whose pair lost, proved no gain, or has not decided is never green, and one with no
pair through no fault of its own is not red (owner, 14 Nov 2026: "I'm tired of having PRs with \"DONT Merge\"... The PR CI check (search pair) should tell us"; sa: no red for a PR that has no pair yet).
Plays tools/pr_verdict_pair_gate.py against a stub gh holding one row; fictional PR, no network."""
import importlib.util
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('pr_verdict_pair_gate', ROOT / 'tools' / 'pr_verdict_pair_gate.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
SHA = 'a' * 40
PULLS = [{'number': 7, 'state': 'open', 'merged_at': None, 'head_sha': SHA, 'cross_repo': False}]
SEARCH = ['src/press/rank.py']


def row(state, status='completed', conclusion=None, title='the row says'):
    return {'external_id': f'search-pair:{state}:3:9', 'status': status, 'conclusion': conclusion, 'title': title}


def stub(*rows):
    calls = []

    def gh(*args):
        calls.append(' '.join(args))
        return json.dumps(list(rows))
    gh.calls = calls
    return gh


class WhatTheRowMakesOfAGreenPr(unittest.TestCase):
    def test_the_table(self):
        table = [   # (the row, the starter on main?, the verdict) -> (state, word the status must say) or unchanged
            ('no row, no starter on main yet: a pair is started by ship or by hand, no fault of the PR', None, False, ('success', None)),
            ('no row, the starter is on main: it starts by itself', None, True, ('pending', 'no row yet')),
            ('waiting', row('waiting', 'queued', None, 'pair queued: starting'), True, ('pending', 'pair queued')),
            ('running', row('running', 'in_progress', None, 'running since 13:00Z'), False, ('pending', 'running since')),
            ('rerunning', row('rerunning', 'in_progress', None, 'running once more'), False, ('pending', 'running once more')),
            ('unproven (not counted, run again)', row('unproven', 'in_progress', None, 'not counted: b10'), False, ('pending', 'not counted')),
            ('superseded', row('superseded', 'completed', 'neutral', 'superseded: a newer head'), False, ('pending', 'superseded')),
            ('counted green', row('counted', 'completed', 'success', 'p3 5 → 20'), False, ('success', None)),
            ('counted red: a loss or no proven gain or not valid twice', row('counted', 'completed', 'failure', 'no proven gain: p3 15 → 17'), False, ('failure', 'no proven gain')),
            ('carried (search files unchanged since the measured head)', row('carried', 'completed', 'neutral', 'ran on abc1234'), False, ('success', None)),
            ('nothing (Moves: nothing)', row('nothing', 'completed', 'success', 'Moves says nothing moves'), False, ('success', None)),
            ('pair needed: the PR names nobody, its author fixes that', row('unnamed', 'completed', 'failure', "pair needed: name the people in the body's Moves lines"), False, ('failure', 'pair needed')),
            ('pair limit: the starter starts it when a place frees', row('unnamed', 'completed', 'failure', 'pair limit: 4 pairs started in 24 h; starts by itself once a place frees'), False, ('pending', 'pair limit')),
            ('pair not started: a failed dispatch, retried', row('unnamed', 'completed', 'failure', 'pair not started: the dispatch failed; start it by hand'), False, ('pending', 'pair not started')),
        ]
        for name, found, starter, want in table:
            state, why = gate.decide(found, starter) or ('success', None)
            self.assertEqual(state, want[0], name)
            if want[1]:
                self.assertIn(want[1], why, name)

    def test_apply_changes_only_a_green_verdict_of_a_search_pr_on_its_current_open_head(self):
        red = row('counted', 'completed', 'failure', 'no proven gain: p3 15 → 17')
        self.assertEqual(gate.apply('o/r', SHA, PULLS, SEARCH, 'success', 'all green', stub(red))[0], 'failure')
        for state in ('failure', 'pending', None):   # a verdict that is not green keeps its own words
            self.assertEqual(gate.apply('o/r', SHA, PULLS, SEARCH, state, 'x', stub(red)), (state, 'x'), state)
        self.assertEqual(gate.apply('o/r', SHA, PULLS, ['README.md'], 'success', 'g', stub(red)), ('success', 'g'), 'a PR outside the search files has no pair to read')
        self.assertEqual(gate.apply('o/r', SHA, PULLS, None, 'success', 'g', stub(red)), ('success', 'g'), 'a file list not read: no guess')
        for pulls in ([{**PULLS[0], 'head_sha': 'b' * 40}], [{**PULLS[0], 'cross_repo': True}], [{**PULLS[0], 'state': 'closed'}], []):
            self.assertEqual(gate.apply('o/r', SHA, pulls, SEARCH, 'success', 'g', stub(red)), ('success', 'g'), 'a replaced head, a fork, a closed PR: nothing')
        spy = stub(red)
        gate.apply('o/r', SHA, PULLS, ['README.md'], 'success', 'g', spy)
        self.assertEqual(spy.calls, [], 'no read at all for a PR outside the search files')

    def test_one_read_by_exact_name_and_a_read_error_leaves_the_verdict_alone(self):
        spy = stub(row('counted', 'completed', 'success', 'ok'))
        gate.apply('o/r', SHA, PULLS, SEARCH, 'success', 'g', spy)
        self.assertEqual(len(spy.calls), 1)
        self.assertIn('check_name=Search%20before/after', spy.calls[0])

        def broken(*args):
            raise RuntimeError('HTTP 502')
        self.assertEqual(gate.apply('o/r', SHA, PULLS, SEARCH, 'success', 'g', broken), ('success', 'g'))

    def test_the_status_words_fit_the_140_characters_a_status_description_holds(self):
        long = row('counted', 'completed', 'failure', 'x' * 300)
        self.assertLessEqual(len(gate.apply('o/r', SHA, PULLS, SEARCH, 'success', 'g', stub(long))[1]), 140)

    def test_the_starter_flag_is_the_starters_file_beside_the_gate(self):
        """Before the starter is on main the verdict waits for no row; once the file is there it does. The same module, the same file name the verdict workflow's checkout lists."""
        self.assertEqual(gate.STARTER, 'pr_verdict_pair.py')
        self.assertEqual(gate.decide({}, (ROOT / 'tools' / gate.STARTER).exists()) is not None, (ROOT / 'tools' / gate.STARTER).exists())


class TheWorkflowsWireItUp(unittest.TestCase):
    def test_the_verdict_checks_out_what_the_gate_loads_and_the_pair_asks_for_a_new_verdict(self):
        verdict = (ROOT / '.github' / 'workflows' / 'pr-verdict.yml').read_text()
        checkout = verdict.split('\n  verdict:\n', 1)[1].split('sparse-checkout: |', 1)[1].split('sparse-checkout-cone-mode', 1)[0]
        for name in ('tools/pr_verdict_pair_gate.py', 'tools/pr-body-check.py'):
            self.assertIn(name, checkout)
        pair = (ROOT / '.github' / 'workflows' / 'search-pair.yml').read_text()
        status = pair.split('\n  status:\n', 1)[1]
        self.assertIn('actions: write', status, 'a dispatch needs it')
        self.assertIn('gh workflow run pr-verdict.yml', status)
        self.assertIn('tools/persona-search/pair_row.py', status.split('sparse-checkout: |', 1)[1].split('sparse-checkout-cone-mode', 1)[0], 'the end step runs pair_row.py: the job needs it checked out (run 43608451071 failed without)')
        self.assertIsNotNone(re.search(r'(?m)^  workflow_dispatch:', verdict), 'the verdict takes a dispatch: it is the sweep that reads pending heads')

    def test_pr_verdict_calls_the_gate_after_the_state_is_known_and_before_it_is_written(self):
        text = (ROOT / 'tools' / 'pr-verdict.py').read_text()
        call = text.index("'pr_verdict_pair_gate').apply(")
        self.assertLess(text.index("state = 'pending' if state == 'settling' else state"), call)
        self.assertLess(call, text.index("gh('api', f'repos/{a.repo}/statuses/{a.sha}'"))


if __name__ == '__main__':
    unittest.main()
