"""Yield per step of a Find jobs run (src/press/step_yield.py, plan P1): each step's jobs, local jobs, fit 70+ and wall seconds, kept per run and said in one line.
8 Nov 2026, p10: a repeat run spent 128 s scoring waiting jobs and read 0 of 561 employer sites; no step had a rate, so nothing could say which should go first."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import jobs_so_far, store
from src.press import step_yield

RUN = '2026-11-08T10:00:00+00:00'


def _db(tmp):
    db = store.connect(Path(tmp) / 'jobs.sqlite')
    db.execute("INSERT INTO companies (id, name, updated_at) VALUES (1, 'X', ?)", (RUN,))
    db.execute("INSERT INTO sources (id, name, kind) VALUES (1, 'S', 'employer feed')")
    for job_id, title, where in [(1, 'Driver', 'Nürnberg'), (2, 'Teamleiter', 'Hamburg'), (3, 'Fahrer', 'Nürnberg'), (4, 'Kraftfahrer', 'Fürth')]:
        db.execute('INSERT INTO jobs (id, canonical_key, source_id, company_id, title, url, location, first_seen_at, last_seen_at, state) '
                   "VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?, 'open')", (job_id, f'k{job_id}', title, f'https://x.test/{job_id}', where, RUN, RUN))
    db.execute('CREATE TABLE scores (job_id INTEGER PRIMARY KEY, scorer_version INTEGER NOT NULL, input_hash TEXT NOT NULL, model TEXT, created_at TEXT, data_json TEXT)')
    for job_id, fit in [(1, 82), (2, 90), (3, 40)]:   # job 4 found, never scored
        db.execute("INSERT INTO scores VALUES (?, 1, 'h', 'm', ?, ?)", (job_id, RUN, json.dumps({'score': fit})))
    return db


def _here(job):
    return job['location'] in ('Nürnberg', 'Fürth')


class StepYieldTests(unittest.TestCase):
    def setUp(self):
        step_yield.reset()
        self.addCleanup(step_yield.reset)

    def test_each_step_is_credited_with_its_own_jobs_and_their_fit(self):
        step_yield.landed('employer_sites', [{'url': 'https://x.test/1'}, {'url': 'https://x.test/2'}, {'url': 'https://x.test/4'}], ['new', 'new', 'new'])
        step_yield.landed('job_boards', [{'url': 'https://x.test/3'}, {'url': 'https://x.test/9'}], ['new', 'seen'])   # a job seen before is not its find
        step_yield.scored('scoring', {1, 3})
        with tempfile.TemporaryDirectory() as tmp, _db(tmp) as db:
            rows = {row['step']: row for row in step_yield.measure(db, in_my_place=_here)}
        self.assertEqual(list(rows), ['scoring', 'job_boards', 'employer_sites'], 'the steps that did nothing are left out; STEPS order')
        self.assertEqual({k: rows['employer_sites'][k] for k in ('jobs', 'local', 'scored', 'fit70', 'local_fit70')},
                         {'jobs': 3, 'local': 2, 'scored': 2, 'fit70': 2, 'local_fit70': 1}, 'Hamburg is not local; the unscored Fürth job is local, not scored')
        self.assertEqual({k: rows['job_boards'][k] for k in ('jobs', 'local', 'scored', 'local_fit70')}, {'jobs': 1, 'local': 1, 'scored': 1, 'local_fit70': 0})
        self.assertEqual({k: rows['scoring'][k] for k in ('jobs', 'local', 'scored', 'local_fit70')}, {'jobs': 2, 'local': 2, 'scored': 2, 'local_fit70': 1})

    def test_overlapping_spans_of_one_step_count_once(self):
        ticks = iter([0.0, 10.0, 5.0, 25.0, 40.0, 45.0])   # (0-10), (5-25) overlap -> 25 s; (40-45) -> +5 s
        with mock.patch.object(step_yield.time, 'monotonic', side_effect=lambda: next(ticks)):
            with step_yield.span('employer_sites'):
                pass
            with step_yield.span('employer_sites'):
                pass
            with step_yield.span('employer_sites'):
                pass
        with tempfile.TemporaryDirectory() as tmp, _db(tmp) as db:
            row, = step_yield.measure(db, in_my_place=_here)
        self.assertEqual(row['seconds'], 30.0)

    def test_a_block_that_raises_still_counts_its_seconds(self):
        ticks = iter([0.0, 7.0])
        with mock.patch.object(step_yield.time, 'monotonic', side_effect=lambda: next(ticks)):
            with self.assertRaises(ValueError), step_yield.span('free_job_apis'):
                raise ValueError('a reader failed')
        with tempfile.TemporaryDirectory() as tmp, _db(tmp) as db:
            row, = step_yield.measure(db, in_my_place=_here)
        self.assertEqual((row['step'], row['seconds']), ('free_job_apis', 7.0))

    def test_run_keeps_the_rows_says_one_line_and_starts_the_next_run_empty(self):
        step_yield.landed('employer_sites', [{'url': 'https://x.test/1'}, {'url': 'https://x.test/4'}], ['new', 'new'])
        ticks = iter([0.0, 30.0])
        with tempfile.TemporaryDirectory() as tmp, _db(tmp) as db, mock.patch.object(step_yield.time, 'monotonic', side_effect=lambda: next(ticks)):
            with step_yield.span('employer_sites'):
                pass
            with mock.patch('builtins.print') as said, mock.patch('src.sources.feeds.in_my_place', _here):
                rows = step_yield.run(db, RUN)
            kept = step_yield.latest(db)
            self.assertEqual(step_yield.measure(db, in_my_place=_here), [], 'the next run times its own steps')
        self.assertEqual(kept, [{'run_at': RUN, **rows[0]}])
        said.assert_called_once_with('Step yield: employer sites 2 local in 30 s (4/min, 1 fit 70+)', flush=True)
        self.assertEqual(step_yield.per_minute(rows[0], 'local_fit70'), 2.0)

    def test_a_step_with_no_local_job_is_not_said_and_a_step_with_no_seconds_has_no_rate(self):
        self.assertEqual(step_yield.line([{'step': 'employer_sites', 'seconds': 9.0, 'jobs': 3, 'local': 0, 'scored': 0, 'fit70': 0, 'local_fit70': 0}]),
                         'Step yield: no step brought a job in your places')
        row = {'step': 'job_boards', 'seconds': None, 'jobs': 2, 'local': 2, 'scored': 1, 'fit70': 0, 'local_fit70': 0}
        self.assertIsNone(step_yield.per_minute(row))
        self.assertEqual(step_yield.line([row]), 'Step yield: job boards 2 local')

    def test_the_place_check_gets_the_url_and_description_it_reads_a_posting_by(self):   # Gitar, #3603: a country-only place is decided by the posting's own read
        def read_by_url_and_text(job):
            return job.get('url') == 'https://x.test/4' and 'description' in job and job['location'] == 'Fürth'
        step_yield.landed('employer_sites', [{'url': 'https://x.test/4'}], ['new'])
        with tempfile.TemporaryDirectory() as tmp, _db(tmp) as db:
            row, = step_yield.measure(db, in_my_place=read_by_url_and_text)
        self.assertEqual(row['local'], 1)

    def test_the_employer_read_is_credited_and_timed_through_scan_beside(self):   # P1 follow-up, after E2a-2: the seconds of employer_sites and job_boards
        from src.sources import boards_ahead
        ticks = iter([0.0, 12.0])

        def scan(sources, db, on_jobs=None, **_):
            on_jobs([{'url': 'https://x.test/1'}, {'url': 'https://x.test/4'}])
            return {'jobs': []}
        with tempfile.TemporaryDirectory() as tmp, _db(tmp) as db, mock.patch.object(jobs_so_far.store, 'import_watch_report', return_value=['new', 'new']), \
                mock.patch.object(step_yield.time, 'monotonic', side_effect=lambda: next(ticks)):
            report, ahead = boards_ahead.scan_beside([], db, {}, jobs_so_far.SoFar(db, say=lambda _: None), due=False, scan=scan)
            row, = step_yield.measure(db, in_my_place=_here)
        self.assertEqual((row['step'], row['jobs'], row['local'], row['seconds']), ('employer_sites', 2, 2, 12.0))
        self.assertIsNone(ahead)

    def test_boards_that_end_after_the_last_employer_site_are_credited_to_job_boards(self):   # Gitar, #3616: their jobs went to free_job_apis while their seconds went to job_boards
        import threading
        from src.sources import aggregators, boards_ahead
        ended = threading.Event()

        def read(_search):
            ended.wait(60)   # a hang guard (10 Nov 2026: a 5 s wait decided a sibling's verdict on a loaded runner)
            return [{'url': 'https://x.test/3'}, {'url': 'https://x.test/4'}]

        def scan(sources, db, on_jobs=None, **_):
            on_jobs([{'url': 'https://x.test/1'}])   # the boards are still reading: nothing to show yet
            ended.set()
            return {'jobs': []}
        with tempfile.TemporaryDirectory() as tmp, _db(tmp) as db, \
                mock.patch.object(jobs_so_far.store, 'import_watch_report', side_effect=lambda _db, report: ['new'] * len(report['jobs'])), \
                mock.patch.object(aggregators, 'kept', side_effect=lambda _db, _name, found, now=None, shown=None, owed=None: found), \
                mock.patch.object(boards_ahead, 'start', side_effect=lambda *a, **k: boards_ahead.Ahead({}, read)):
            report, ahead = boards_ahead.scan_beside([], db, {}, jobs_so_far.SoFar(db, say=lambda _: None), due=True, scan=scan)
            rows = {row['step']: row for row in step_yield.measure(db, in_my_place=_here)}
        self.assertTrue(ahead.shown, 'aggregators.scan then skips its own on_jobs for them')
        self.assertEqual({step: row['jobs'] for step, row in rows.items()}, {'job_boards': 2, 'employer_sites': 1})
        self.assertNotIn('free_job_apis', rows)

    def test_soFar_credits_the_step_of_its_label_or_the_one_the_caller_names(self):
        with tempfile.TemporaryDirectory() as tmp, _db(tmp) as db, mock.patch.object(jobs_so_far.store, 'import_watch_report', return_value=['new']):
            sofar = jobs_so_far.SoFar(db, say=lambda _: None)
            sofar.add([{'url': 'https://x.test/1'}], 'employer sites')
            sofar.add([{'url': 'https://x.test/3'}], 'job boards')
            sofar.listener('job boards', 'free_job_apis')([{'url': 'https://x.test/4'}])   # the aggregators' label covers more than the free APIs: the caller names the step
            sofar.add([{'url': 'https://x.test/2'}], 'something else')   # a label with no step is unmeasured
            rows = {row['step']: row for row in step_yield.measure(db, in_my_place=_here)}
        self.assertEqual({step: row['jobs'] for step, row in rows.items()}, {'job_boards': 1, 'employer_sites': 1, 'free_job_apis': 1})

if __name__ == '__main__':
    unittest.main()
