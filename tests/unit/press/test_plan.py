"""The Find jobs planner (src/press/plan.py, plan P2; owner, 8 Nov 2026: "Log first, reorder later"): the whole plan of the steps, said and saved at each press start, never applied.
Owner's words behind it: "Even if you stop me at step 3, I know that there are steps 4-10" · "based on the fastest pathway to get those 'as many jobs as possible'"."""
import io
import contextlib
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from src import store, time_budget
from src.press import plan, resume, step_yield

NOW = datetime(2026, 11, 8, 12, 0, tzinfo=timezone.utc)
SAVED = '2026-11-08T11:00:00+00:00'


def _left(**counts):
    return {step: {'left': n, 'saved_at': SAVED} for step, n in counts.items()}


def _row(run_at, step, seconds, fit):
    return {'step': step, 'seconds': seconds, 'jobs': fit, 'local': fit, 'scored': fit, 'fit70': fit, 'local_fit70': fit, 'run_at': run_at}


class Isolated(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.data = Path(tmp.name)
        patch = mock.patch('src.paths.DATA', self.data)
        patch.start()
        self.addCleanup(patch.stop)
        self.addCleanup(time_budget.start, 0)
        time_budget.start(180)   # a timed run: the app's 3 minutes


class TheOrderIsOwnedHere(unittest.TestCase):
    def test_the_fastest_step_with_work_left_goes_first_the_unmeasured_follow_in_the_engines_order_and_a_finished_step_drops_out(self):
        rate = {'job_boards': 1 / 60, 'employer_sites': 3 / 60, 'scoring': 9 / 60}
        made = plan.plan(_left(employer_sites=561, job_boards=4, scoring=0, places=12), rate)
        self.assertEqual([item['step'] for item in made['order']][:3], ['employer_sites', 'job_boards', 'web_search'],
                         'fastest measured first (scoring is done, so its rate does not count); then the unmeasured in the engine order')
        self.assertEqual([item['step'] for item in made['done']], ['scoring'])
        self.assertEqual({item['step']: item['per_min'] for item in made['order'][:2]}, {'employer_sites': 3.0, 'job_boards': 1.0})
        self.assertEqual(len(made['order']) + len(made['done']), len(plan.ENGINE_ORDER), 'every step is in the plan: "steps 4-10" are known')

    def test_a_step_that_never_said_what_it_left_stays_in_the_plan_as_unknown_not_as_done(self):
        made = plan.plan({}, {})
        self.assertEqual(made['done'], [])
        self.assertEqual([item['step'] for item in made['order']], list(plan.ENGINE_ORDER), 'no history at all: the engine order, nothing invented')
        self.assertTrue(all(item['left'] is None and item['per_min'] is None for item in made['order']))

    def test_equal_rates_keep_the_engines_order(self):
        made = plan.plan({}, {'free_job_apis': 0.5, 'job_boards': 0.5})
        self.assertEqual([item['step'] for item in made['order']][:2], ['job_boards', 'free_job_apis'])


class TheRateIsTheLastRunsRightLocalJobsOverTheirSeconds(Isolated):
    def test_seconds_and_jobs_are_summed_over_the_last_runs_not_averaged_and_older_runs_are_ignored(self):
        with store.connect(self.data / 'jobs.sqlite') as db:
            runs = [('2026-11-01T10:00:00+00:00', 600, 90)] + [(f'2026-11-0{n}T10:00:00+00:00', secs, fit) for n, (secs, fit) in zip(range(2, 7), [(10, 1), (10, 1), (10, 1), (10, 1), (100, 4)])]
            for run_at, secs, fit in runs:
                step_yield.record(db, run_at, [_row(run_at, 'employer_sites', secs, fit)])
            rate = plan.rates(db)
        self.assertAlmostEqual(rate['employer_sites'], 8 / 140, msg='runs 2-6: (1+1+1+1+4) fit 70+ over (10+10+10+10+100) s; run 1 is older than 5 runs')

    def test_a_step_with_no_seconds_has_no_rate(self):
        with store.connect(self.data / 'jobs.sqlite') as db:
            step_yield.record(db, '2026-11-08T10:00:00+00:00', [_row('x', 'job_boards', None, 3)])
            self.assertEqual(plan.rates(db), {})


class TheWholePlanIsSavedAndSaidButNeverApplied(Isolated):
    def test_run_saves_the_whole_plan_says_one_line_and_leaves_the_engine_alone(self):
        with store.connect(self.data / 'jobs.sqlite') as db, mock.patch.object(resume, 'load_left', return_value=_left(employer_sites=561, scoring=0)):
            step_yield.record(db, '2026-11-08T10:00:00+00:00', [_row('x', 'employer_sites', 60, 3)])
            said = io.StringIO()
            with contextlib.redirect_stdout(said):
                made = plan.run(db, NOW)
        saved = plan.load()
        self.assertEqual(saved, made)
        self.assertIs(saved['applied'], False, 'log first, reorder later (owner, 8 Nov 2026)')
        self.assertEqual(saved['planned_at'], '2026-11-08T12:00:00+00:00')
        self.assertEqual(said.getvalue().strip(), 'Plan (logged, not applied yet): 1 employer sites 3 fit 70+/min, 561 left · 2 web search not measured · 3 job boards not measured · '
                                                  '4 free job APIs not measured · +8 more · done: scoring')

    def test_a_save_that_fails_is_said_and_ignored_so_a_search_goes_on(self):
        with store.connect(self.data / 'jobs.sqlite') as db, mock.patch.object(plan, '_write', side_effect=PermissionError('read-only')), \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as warned:
            made = plan.run(db, NOW)
        self.assertIn('could not be saved', warned.getvalue())
        self.assertTrue(made['order'])

    def test_a_run_without_a_budget_says_the_plan_but_writes_nothing(self):   # a CLI run or a test never leaves a file in the data folder
        time_budget.start(0)
        with store.connect(self.data / 'jobs.sqlite') as db, contextlib.redirect_stdout(io.StringIO()):
            plan.run(db, NOW)
        self.assertFalse((self.data / plan.FILE).exists())

    def test_a_missing_or_broken_file_has_no_plan(self):
        self.assertIsNone(plan.load())
        (self.data / plan.FILE).write_text('[1, 2')
        self.assertIsNone(plan.load())


class TheCardsNextLine(Isolated):
    """Plan P3 (owner, 8 Nov 2026, asked via AskUserQuestion: "Yes, as drawn"): "Next: employer sites (561 left to read), then job boards" says what the saved plan has first."""

    def _plan(self, order, planned_at='2026-11-08T11:00:00+00:00', applied=False):
        plan._write({'order': [{'step': step, 'left': left, 'saved_at': SAVED, 'per_min': None} for step, left in order], 'done': [], 'planned_at': planned_at, 'applied': applied})

    def test_the_first_two_steps_with_their_counts_come_from_the_saved_plan(self):
        self._plan([('employer_sites', 561), ('job_boards', 4), ('web_search', 9)], applied=True)
        self.assertEqual(plan.next_steps(NOW), {'steps': [{'step': 'employer_sites', 'left': 561}, {'step': 'job_boards', 'left': 4}], 'planned_at': '2026-11-08T11:00:00+00:00'}, 'an applied plan is the order the run follows')

    def test_a_plan_the_engine_does_not_follow_is_said_in_the_engines_order(self):   # gi, 8 Nov 2026: the card must not say what the next run will not do
        self._plan([('employer_sites', 561), ('job_boards', 4), ('web_search', 9)])
        self.assertEqual([item['step'] for item in plan.next_steps(NOW)['steps']], ['web_search', 'job_boards'], 'the planner picked employer sites first, the engine starts with web search')
        self._plan([('employer_sites', 561), ('job_boards', 4)])
        self.assertEqual(plan.next_steps(NOW)['steps'], [{'step': 'job_boards', 'left': 4}, {'step': 'employer_sites', 'left': 561}])

    def test_a_step_with_nothing_left_or_that_never_said_has_no_count_and_one_step_stays_one(self):
        self._plan([('employer_sites', None), ('job_boards', 0)])
        self.assertEqual([item['left'] for item in plan.next_steps(NOW)['steps']], [None, None])
        self._plan([('employer_sites', 7)])
        self.assertEqual(plan.next_steps(NOW)['steps'], [{'step': 'employer_sites', 'left': 7}])

    def test_no_plan_no_step_or_an_old_plan_says_nothing(self):
        self.assertIsNone(plan.next_steps(NOW), 'no file')
        self._plan([])
        self.assertIsNone(plan.next_steps(NOW), 'a plan with no step with work left')
        self._plan([('employer_sites', 5)], planned_at='2026-11-04T11:00:00+00:00')
        self.assertIsNone(plan.next_steps(NOW), 'older than MAX_AGE_DAYS')
        self._plan([('employer_sites', 5)], planned_at='not a time')
        self.assertIsNone(plan.next_steps(NOW))
        self._plan([('employer_sites', 5)], planned_at='2026-11-08T11:00:00')
        self.assertIsNone(plan.next_steps(NOW), 'a time without a zone')

    def test_an_unknown_step_is_never_handed_to_the_screen(self):
        self._plan([('not_a_step', 3), ('job_boards', 2)])
        self.assertEqual(plan.next_steps(NOW)['steps'], [{'step': 'job_boards', 'left': 2}])

    def test_a_step_this_run_finished_is_done_in_the_end_plan_not_named_next(self):   # review of #P3: the plan was made before resume.save, so it still named a finished step
        resume.begin()
        resume.note('employer sites', 561)   # the last run's time-up count
        resume.begin()                      # this run reads them all in time and says nothing
        resume.ran('employer sites')
        resume.save()
        with store.connect(self.data / 'jobs.sqlite') as db, contextlib.redirect_stdout(io.StringIO()):
            made = plan.run(db, datetime.now(timezone.utc), head='Next plan')
        self.assertIn('employer_sites', [item['step'] for item in made['done']])
        self.assertNotIn('employer_sites', [step['step'] for step in plan.next_steps()['steps']])

    def test_search_makes_the_end_plan_after_resume_save(self):   # the real order inside daily_search.search, played through the search characterization test
        import unittest
        order = []
        original = plan.run
        with mock.patch.object(resume, 'save', side_effect=lambda *a, **k: order.append('resume.save')), \
                mock.patch.object(plan, 'run', side_effect=lambda db, now=None, head='Plan': order.append(head) or original(db, now, head)):
            suite = unittest.defaultTestLoader.loadTestsFromName('tests.unit.ai.test_daily_search_phases.SearchCharacterization.test_new_jobs_score_sync_save_and_report_in_order')
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                result = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
        self.assertTrue(result.wasSuccessful())
        self.assertEqual(order, ['Plan', 'resume.save', 'Next plan'], 'the plan at the start, then the steps zeroed, then the plan for the next run')

    def test_a_plan_file_with_a_broken_entry_still_answers(self):
        self._plan([('employer_sites', 5)])
        saved = plan.load()
        plan._write({**saved, 'order': ['junk', None, *saved['order']]})
        self.assertEqual(plan.next_steps(NOW)['steps'], [{'step': 'employer_sites', 'left': 5}])

    def test_the_run_end_plan_says_its_own_head_and_the_app_command_answers_with_the_steps(self):
        with store.connect(self.data / 'jobs.sqlite') as db, mock.patch.object(resume, 'load_left', return_value=_left(web_search=0, job_boards=0, employer_sites=561)):
            said = io.StringIO()
            with contextlib.redirect_stdout(said):
                plan.run(db, datetime.now(timezone.utc), head='Next plan')
        self.assertTrue(said.getvalue().startswith('Next plan (logged, not applied yet): 1 employer sites'), said.getvalue())
        from src import desktop
        answer, _ = desktop._next_step(None, None)
        self.assertEqual((answer['ok'], answer['steps'][0]), (True, {'step': 'employer_sites', 'left': 561}))
        plan._write({'order': [], 'done': [], 'planned_at': NOW.isoformat(), 'applied': False})
        self.assertEqual(desktop._next_step(None, None)[0], {'ok': True, 'steps': []})


if __name__ == '__main__':
    unittest.main()
