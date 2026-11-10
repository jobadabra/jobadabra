"""The Find jobs code shape's contracts as data (docs/superpowers/specs/2026-11-10-find-jobs-code-shape.md, cr 1/5): the Run names a run's state
(C1), a stage leaves a Result (C2), a job's states each have one owner (C4). The Run's fields still shared by two Runs are listed and only shrink."""
import unittest
from pathlib import Path

from src.press import job, run, stage

ROOT = Path(__file__).resolve().parents[3]

# Fields two Runs still share, because their state is still at module level. Only shrinks: a PR that gives a field a per-run object deletes it here.
# TODO(AI): clock leaves last, when sf 3/8 moves the ~57 patches of time_budget.<name> to the Run (2026-11-10).
SHARED_TODAY = {'clock', 'claims', 'counts', 'details', 'resume', 'yields', 'titles', 'scope', 'ai', 'methods', 'cut', 'reads'}
CALLBACKS = {'say', 'sync'}


class RunTest(unittest.TestCase):
    def test_every_field_is_bound_to_the_live_state(self):
        made = run.Run.current()
        self.assertEqual(set(run.FIELDS), SHARED_TODAY | CALLBACKS)
        for name in run.FIELDS:
            with self.subTest(name):
                self.assertIsNotNone(getattr(made, name))
        from src import run_counts, time_budget
        from src.press import scorer
        from src.sources import eures
        self.assertIs(made.clock, time_budget.CLOCK)
        self.assertIs(made.claims, scorer)
        self.assertIs(made.counts, run_counts)
        self.assertIs(made.reads['EURES'].cut, eures.CUT, 'the live holder, not a copy')

    def test_two_runs_share_only_the_fields_still_listed(self):
        one, two = run.Run.current(), run.Run.current()
        for name in SHARED_TODAY:
            with self.subTest(name):
                self.assertIs(getattr(one, name) if name != 'reads' else one.reads['EURES'].early,
                              getattr(two, name) if name != 'reads' else two.reads['EURES'].early,
                              f'{name} is no longer shared: delete it from SHARED_TODAY (the list only shrinks)')

    def test_callbacks_are_the_runs_own(self):
        said = []
        made = run.Run.current(say=said.append)
        made.say('⏳ x')
        self.assertEqual(said, ['⏳ x'])
        self.assertIsNone(made.sync())


class StageResultTest(unittest.TestCase):
    def test_status_is_one_of_three_and_a_failure_names_its_reason(self):
        self.assertEqual(stage.Result(stage.DONE, items=(1, 2)).items, (1, 2))
        self.assertEqual(stage.Result(stage.CUT, reason='time is up').status, 'cut')
        with self.assertRaises(ValueError):
            stage.Result('empty')
        with self.assertRaises(ValueError):
            stage.Result(stage.FAILED)


class GuardTest(unittest.TestCase):
    def setUp(self):
        from src import run_details
        self.details = run_details
        run_details.reset()
        self.addCleanup(run_details.reset)

    def test_a_block_that_runs_through_caught_nothing(self):
        with stage.guard('job boards first') as caught:
            pass
        self.assertFalse(caught)
        self.assertEqual((caught.error, caught.reason), (None, ''))
        self.assertEqual(self.details.failures(), {})

    def test_a_failure_lets_the_run_go_on_and_is_counted_without_its_words(self):
        with stage.guard('job boards first') as caught:
            raise TimeoutError('https://board.test/jobs?q=nurse+geneva timed out')
        self.assertTrue(caught)
        self.assertEqual(caught.reason, 'TimeoutError')
        self.assertEqual(self.details.failures(), {'failed job boards first: TimeoutError': 1})
        self.assertNotIn('failures', self.details.build({}), 'shown later, not in the saved details yet')

    def test_an_interrupt_is_never_caught(self):
        with self.assertRaises(KeyboardInterrupt):
            with stage.guard('job boards first'):
                raise KeyboardInterrupt

    def test_guards_in_many_threads_lose_no_count(self):
        import threading

        def fail_often():
            for _ in range(500):
                with stage.guard('beside'):
                    raise OSError('x')
        threads = [threading.Thread(target=fail_often) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(30)
        self.assertEqual(self.details.failures(), {'failed beside: OSError': 4000})


class JobStatesTest(unittest.TestCase):
    def test_each_state_has_one_owner_that_exists(self):
        self.assertEqual(set(job.OWNERS), set(job.STATES))
        self.assertNotIn(job.UNKNOWN, job.STATES)
        for state, path in job.OWNERS.items():
            with self.subTest(state):
                self.assertTrue((ROOT / path).exists(), path)


if __name__ == '__main__':
    unittest.main()
