"""Guard: release — an hourly look that records nothing must never replace a re-record that is waiting, so the 10:30 catch-all (or a by-hand run) still records.

Why (13 Nov 2026, sa's finding on #3943, found while run 43320816550 sat in its guard for hours): press-tapes-auto.yml's workflow-level concurrency group keeps one running and one pending run, and a newer
pending run REPLACES the older one. The hourly :30 looks of #3943 all entered that group, so a look below the line (which records nothing) replaced a waiting 10:30 run or by-hand run, and they piled up as cancelled runs.
Fix: a look runs in a group of its own (gaps and decide are offline and free); only a run that records (the day's run, by hand, or the one a look queues) is in the serialized group.
The model below is GitHub's rule, fed by the workflow's own `concurrency.group` expression.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = (ROOT / '.github' / 'workflows' / 'press-tapes-auto.yml').read_text()
SERIAL = 'press-tapes-auto'


class _Ns(dict):
    __getattr__ = dict.__getitem__


def group_of(inputs, run_id):
    """The group the workflow's `concurrency.group` expression gives a run started with these inputs (the dispatch's defaults filled in)."""
    expr = re.search(r'concurrency:\n  group: \$\{\{ (.+?) \}\}\n', WORKFLOW).group(1)
    py = re.sub(r'!(?!=)', ' not ', expr).replace('&&', ' and ').replace('||', ' or ')
    values = {'min_gaps': '', 'queued': False, **inputs}
    return eval(py, {'__builtins__': {}}, {'inputs': _Ns(values), 'github': _Ns(run_id=run_id), 'format': lambda text, *args: text.format(*args)})


class Groups:
    """GitHub's concurrency: per group one running run and one pending run; a newer pending run cancels the older pending one (cancel-in-progress: false)."""

    def __init__(self):
        self.running, self.pending, self.state = {}, {}, {}

    def start(self, run, inputs):
        group = group_of(inputs, run)
        if group not in self.running:
            self.running[group], self.state[run] = run, 'running'
        else:
            if group in self.pending:
                self.state[self.pending[group]] = 'cancelled'
            self.pending[group], self.state[run] = run, 'pending'
        return group

    def finish(self, run):
        self.state[run] = 'done'
        for group, current in list(self.running.items()):
            if current == run:
                del self.running[group]
                if group in self.pending:
                    self.running[group] = self.pending.pop(group)
                    self.state[self.running[group]] = 'running'


class TheLooksNeverReplaceAWaitingReRecord(unittest.TestCase):
    def test_the_ten_thirty_run_waiting_behind_a_long_record_survives_a_look_below_the_line(self):
        groups = Groups()
        groups.start('a', {})                          # 43320816550: a run in its guard for hours
        groups.start('b', {})                          # 10:30, the catch-all: waits
        self.assertEqual(groups.state['b'], 'pending')
        for look in ('l1', 'l2', 'l3'):                # :30 looks below the line: each runs at once and records nothing
            groups.start(look, {'min_gaps': '12'})
            self.assertEqual(groups.state[look], 'running', 'a look is free: it never waits behind a recording')
            groups.finish(look)
        self.assertEqual(groups.state['b'], 'pending', 'the 10:30 run is still waiting, not replaced')
        groups.finish('a')
        self.assertEqual(groups.state['b'], 'running', 'it starts when the long record ends, and records (any gap)')
        self.assertFalse([run for run, state in groups.state.items() if state == 'cancelled'], 'no look piles up as a cancelled run')

    def test_a_by_hand_run_waiting_is_not_replaced_either(self):
        groups = Groups()
        groups.start('a', {})
        groups.start('hand', {})
        groups.start('look', {'min_gaps': '12'})
        self.assertEqual((groups.state['hand'], groups.state['look']), ('pending', 'running'))

    def test_the_run_a_look_queues_is_in_the_serialized_group(self):
        groups = Groups()
        groups.start('a', {})
        self.assertEqual(groups.start('queued', {'min_gaps': '12', 'queued': True}), SERIAL, 'the recording path is one at a time')
        self.assertEqual(groups.state['queued'], 'pending')

    def test_the_serialized_group_is_the_one_the_day_and_by_hand_runs_use(self):
        self.assertEqual(group_of({}, 'x'), SERIAL)
        self.assertEqual(group_of({'min_gaps': '12'}, 'x'), 'press-tapes-look-x', 'a look has its own group per run')
        self.assertNotIn('search-personas', WORKFLOW[WORKFLOW.index('concurrency:'):WORKFLOW.index('jobs:')])
        self.assertRegex(WORKFLOW, r'cancel-in-progress: false')


class OnlyTheRecordingPathIsSerialized(unittest.TestCase):
    def job(self, name):
        start = WORKFLOW.index(f'\n  {name}:')
        nxt = re.search(r'\n  [a-z]+:\n', WORKFLOW[start + 1:])
        return WORKFLOW[start:start + 1 + nxt.start()] if nxt else WORKFLOW[start:]

    def test_a_look_runs_gaps_and_decide_and_nothing_that_records(self):
        self.assertIn("(inputs.min_gaps == '' || inputs.queued)", self.job('guard'))   # a look's guard is skipped, and so is everything after it
        self.assertIn('needs.guard.outputs.go', self.job('record'))
        self.assertIn("needs.decide.outputs.daily == 'true' || needs.record.result != 'skipped'", self.job('table'))   # a look that records nothing has no table

    def test_a_look_over_the_line_queues_one_run_and_only_when_none_is_waiting(self):
        queue = self.job('queue')
        self.assertIn("inputs.min_gaps != '' && !inputs.queued", queue)
        self.assertIn("needs.decide.outputs.record == 'true'", queue)
        self.assertIn('actions: write', queue)
        self.assertIn('--status pending', queue)
        self.assertIn('-f queued=true', queue)
        self.assertIn('-f min_gaps=', queue)

    def test_the_run_name_tells_a_look_from_a_re_record(self):
        # the guard's `newer()` filter reads this title (executed against fake runs in test_press_tapes_auto_guard.py)
        self.assertIn('hourly look', WORKFLOW[:WORKFLOW.index('\non:')])
        self.assertIn('hourly look', self.job('guard'))


if __name__ == '__main__':
    unittest.main()
