"""Guard: release — an ending run (every job ended, the run not completed) names the run it waits on and is read again until it completes; without it #4177 sat pending ~10 min
(14 Nov 2026, tools/pr-verdict.py verdict() and read())."""
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('pr_verdict', ROOT / 'tools' / 'pr-verdict.py')
pv = importlib.util.module_from_spec(spec); spec.loader.exec_module(pv)


def run(name, status='completed', conclusion='success', event='pull_request', at='2026-10-26T03:00:00Z', end='2026-10-26T03:04:00Z', title='', id=1):
    return {'databaseId': id, 'workflowName': name, 'status': status, 'conclusion': conclusion if status == 'completed' else '', 'event': event,
            'createdAt': at, 'updatedAt': end, 'displayTitle': title or name}


def job(id, name, status='completed', conclusion='success'):
    return {'id': id, 'name': name, 'status': status, 'conclusion': conclusion, 'steps': []}


class AnEndingRunNamesItself(unittest.TestCase):
    def test_an_ending_run_links_the_run_it_waits_on_not_the_verdicts_own_page(self):
        """#4177, 14 Nov 2026, 13:31:10Z: every job of the e2e run had ended, the run itself had not; the status said "e2e ... ending" and linked this verdict's own 10 s green run."""
        e2e = dict(run('CI · End-to-end on Mac + Linux', event='workflow_dispatch', title='E2E for PR · settings · topic', id=5, status='in_progress'), conclusion='')
        state, why, _, _, target = pv.verdict([run('CI · Pull request', id=1), e2e], jobs={5: [job(50, 'E2E · settings')]})
        self.assertEqual((state, target), ('settling', 5), why)


class AnEndingRunIsLookedAtAgainUntilItEnds(unittest.TestCase):
    """#4177, 14 Nov 2026: the verdict read e2e's jobs ended and the run in progress; the run completed 1 s later and no event followed, so the status stayed pending until the 10-min sweep."""

    def read_with(self, ends_after):
        e2e = dict(run('CI · End-to-end on Mac + Linux', event='workflow_dispatch', title='E2E for PR · settings · topic', id=5, status='in_progress'), conclusion='')
        by_id = []

        def gh(*args, **kw):
            if '/jobs' in args[1]:
                return json.dumps([job(50, 'E2E · settings')])
            by_id.append(1)
            done = len(by_id) > ends_after
            return json.dumps({'id': 5, 'head_sha': 'abc', 'run_attempt': 1, 'status': 'completed' if done else 'in_progress', 'conclusion': 'success' if done else None, 'updated_at': '2026-10-26T03:04:00Z'})
        sleeps = []
        with patch.object(pv, 'gh', gh), patch.object(pv, 'list_runs', return_value=[dict(run('CI · Pull request', id=1), attempt=1), dict(e2e, attempt=1)]):
            runs, jobs = pv.read('o/r', 'abc', sleep=sleeps.append)
        return pv.verdict(runs, jobs=jobs)[0], sleeps

    def test_a_run_that_ends_a_few_seconds_later_is_green_in_the_same_look(self):
        state, sleeps = self.read_with(ends_after=3)
        self.assertEqual(state, 'success')
        self.assertEqual(sleeps, [pv.SETTLE[1]] * 3, 'it looked again after each step until the end, and did not wait the whole cap')

    def test_a_run_that_never_ends_stops_at_the_cap_and_stays_pending(self):
        state, sleeps = self.read_with(ends_after=10 ** 6)
        self.assertEqual(state, 'settling')
        self.assertEqual(len(sleeps), pv.SETTLE[0])


if __name__ == '__main__':
    unittest.main()
