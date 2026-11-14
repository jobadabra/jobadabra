"""Dormant queue-settlement and pass-time helpers leave the current search and read cuts unchanged."""
import contextlib
import io
import os
import sqlite3
import unittest
from datetime import datetime, timezone
from unittest import mock

from src import time_budget
from src.ai import slots
from src.sources import read_budget, waiting_jobs


class PassTime(unittest.TestCase):
    def setUp(self):
        time_budget.start(180, now=1000)
        self.addCleanup(time_budget.start, 0)
        patch = mock.patch.object(time_budget, '_paces', return_value={'place_rounds': 8.0, 'title_rounds': 7.0})
        self.paces = patch.start()
        self.addCleanup(patch.stop)

    def test_one_place_and_title_round_before_the_existing_run_end(self):
        before = (time_budget.BEGAN, time_budget.DEADLINE, time_budget.STAGE_END)
        self.assertEqual(read_budget.run_end(), 1165)
        self.assertEqual(read_budget.pass_at(), 1150)
        self.assertEqual((time_budget.BEGAN, time_budget.DEADLINE, time_budget.STAGE_END), before)

    def test_measured_rounds_are_clamped_by_the_budget_rows(self):
        for pace, allowance in ((0.1, read_budget.PASS_MIN), (100, read_budget.PASS_MAX)):
            with self.subTest(pace=pace):
                self.paces.return_value = {'place_rounds': pace, 'title_rounds': pace}
                self.assertEqual(read_budget.run_end() - read_budget.pass_at(), time_budget.part(allowance))
        self.paces.return_value = {}
        fallback = time_budget.PACE['place_rounds'] + time_budget.PACE['title_rounds']
        self.assertEqual(read_budget.run_end() - read_budget.pass_at(), min(max(fallback, read_budget.PASS_MIN), read_budget.PASS_MAX))

    def test_shorter_runs_scale_the_bounds_and_stage_end_is_respected(self):
        time_budget.start(90, now=1000)
        self.assertEqual(read_budget.pass_at(), 1067.5)
        time_budget.start(180, now=1000, stage=60)
        self.assertEqual(read_budget.pass_at(), 1030)
        time_budget.start(0)
        self.assertIsNone(read_budget.pass_at())

    def test_default_lane_and_employer_cuts_do_not_switch_to_the_pass_time(self):
        pass_at, lane_end = read_budget.pass_at(), read_budget.run_end()
        self.assertTrue(read_budget.past_cut(now=pass_at + 1))
        self.assertEqual(read_budget.cut_at(), 1090)
        with slots.in_lane(lane_end):
            self.assertFalse(read_budget.past_cut(now=pass_at + 1))
            self.assertEqual(read_budget.cut_at(), lane_end)
            self.assertTrue(read_budget.past_cut(now=lane_end))
        self.assertEqual(read_budget.cut_at(), 1090)


class SettledQueue(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.now = datetime(2026, 11, 14, tzinfo=timezone.utc)
        self.jobs = [{'url': f'https://board.example.test/job/{n}', 'title': f'Example role {n}'} for n in range(4)]
        for patch in (mock.patch.object(waiting_jobs, '_worth', return_value=True),
                      mock.patch.object(waiting_jobs, '_key', return_value='fictional-search'),
                      mock.patch('src.run_details.failed')):
            patch.start()
            self.addCleanup(patch.stop)
        with mock.patch.dict(os.environ, {'JOBADABRA_STAGE_LOG': '0'}), contextlib.redirect_stdout(io.StringIO()):
            waiting_jobs.keep(self.db, 'Fictional board', self.jobs, self.now, search={})

    def urls(self):
        return [row[0] for row in self.db.execute('SELECT url FROM waiting_jobs ORDER BY url')]

    def test_only_selected_first_and_last_urls_leave_and_a_second_call_is_harmless(self):
        chosen = [self.jobs[n]['url'] for n in (0, 3)]
        waiting_jobs.listed(self.db, [chosen[0], None, '', chosen[1], chosen[0], 'https://board.example.test/unknown'])
        self.assertEqual(self.urls(), [self.jobs[n]['url'] for n in (1, 2)])
        waiting_jobs.listed(self.db, chosen)
        waiting_jobs.listed(self.db, [])
        self.assertEqual(self.urls(), [self.jobs[n]['url'] for n in (1, 2)])

    def test_empty_input_needs_no_table(self):
        self.db.execute('DROP TABLE waiting_jobs')
        waiting_jobs.listed(self.db, [None, ''])
        self.assertEqual(self.db.execute("SELECT name FROM sqlite_master WHERE name = 'waiting_jobs'").fetchall(), [])

    def test_a_failed_delete_rolls_back_all_rows_and_names_its_failure(self):
        self.db.execute("CREATE TRIGGER refuse_delete BEFORE DELETE ON waiting_jobs WHEN OLD.url LIKE '%/3' BEGIN SELECT RAISE(ABORT, 'fictional failure'); END")
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            waiting_jobs.listed(self.db, [job['url'] for job in self.jobs])
        self.assertEqual(self.urls(), [job['url'] for job in self.jobs])
        self.assertIn('Warning: 4 listed job(s) still wait for the queue (IntegrityError)', output.getvalue())

    def test_keep_default_output_and_rows_stay_the_same(self):
        output = io.StringIO()
        with mock.patch.dict(os.environ, {'JOBADABRA_STAGE_LOG': '0'}), contextlib.redirect_stdout(output):
            kept = waiting_jobs.keep(self.db, 'Fictional board', self.jobs, self.now, search={})
        self.assertEqual(kept, 4)
        self.assertEqual(output.getvalue(), f'{waiting_jobs.SAID}4 job(s) of Fictional board\n')
        self.assertEqual(self.urls(), [job['url'] for job in self.jobs])

    def test_stage_log_names_only_jobs_accepted_by_keep(self):
        output = io.StringIO()
        rejected = [dict(self.jobs[0], title=''), dict(self.jobs[1], url='')]
        refused = {'url': 'https://board.example.test/refused', 'title': 'Refused role'}
        with mock.patch.dict(os.environ, {'JOBADABRA_STAGE_LOG': '1'}), \
             mock.patch.object(waiting_jobs, '_worth', side_effect=lambda name, job, places: job != refused), contextlib.redirect_stdout(output):
            kept = waiting_jobs.keep(self.db, 'Fictional board', self.jobs + rejected + [refused], self.now, search={})
        self.assertEqual(kept, 4)
        self.assertEqual(output.getvalue().splitlines(), [f'{waiting_jobs.SAID}4 job(s) of Fictional board'] +
                         [f"Waiting: Fictional board {job['url']}" for job in self.jobs])
        self.assertEqual(self.urls(), [job['url'] for job in self.jobs])
