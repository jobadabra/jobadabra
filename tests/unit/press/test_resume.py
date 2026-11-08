"""press_left.json: the work each step of a Find jobs run left for the next one, as counts (plan E2b; owner, 8 Nov 2026: "When 3 mins stops, the
next run nows where to continue and what are the left things to do and the next goals"). The planner (pl, P2) reads it through resume.load_left().
Counts only: the items stay in their owners' files (employers_left.json, title_triage.json, late_reads.json, found_boards.json, the jobs store)."""
import contextlib
import io
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from src import time_budget
from src.press import resume

NOW = datetime(2026, 11, 8, 12, 0, tzinfo=timezone.utc)


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


class WhatEachStepSaysIsSaved(Isolated):
    def test_a_stage_that_says_time_is_up_saves_its_count_under_its_stage_name(self):
        time_budget.later('employer sites', 7, 'sites')
        saved = resume.load_left()
        self.assertEqual(saved['employer_sites']['left'], 7)
        self.assertEqual(datetime.fromisoformat(saved['employer_sites']['saved_at']).tzinfo, timezone.utc)

    def test_the_ai_steps_left_lines_are_saved_under_the_stage_names_too(self):
        for step, key in (('titles', 'title_sorting'), ('score', 'scoring'), ('enrich', 'job_facts')):
            time_budget.left_line(step, 5, 'x')
            self.assertEqual(resume.load_left()[key]['left'], 5, step)

    def test_a_stage_name_the_table_lacks_is_a_loud_mistake_not_a_silent_new_key(self):
        with self.assertRaises(KeyError):
            resume.note('tea breaks', 1)

    def test_every_stage_marks_itself_ran_where_it_starts(self):
        # a stage without `resume.ran('<stage>')` would never be zeroed at a run's end: its old count would stay "40 left" for ever
        source = '\n'.join(path.read_text() for path in (Path(__file__).resolve().parents[3] / 'src').rglob('*.py') if path.name != 'resume.py')
        self.assertEqual([stage for stage in resume.STEPS if f"resume.ran('{stage}')" not in source], [])

    def test_every_time_budget_stage_has_a_step(self):
        self.assertEqual(set(resume.STEPS), set(time_budget.STAGES))


class TheRunsEndFillsTheRest(Isolated):
    OLD = '2026-11-07T12:00:00+00:00'

    def seed(self, **left):
        (self.data / 'press_left.json').write_text(json.dumps({k: {'left': n, 'saved_at': self.OLD} for k, n in left.items()}))

    def test_a_step_that_ran_and_said_nothing_is_zero_left_and_a_said_one_keeps_its_count(self):
        resume.ran('employer sites')
        resume.ran('scoring')
        time_budget.later('employer sites', 7, 'sites')
        resume.save(NOW)
        saved = resume.load_left()
        self.assertEqual({k: v['left'] for k, v in saved.items()}, {'employer_sites': 7, 'scoring': 0})
        self.assertEqual(saved['scoring']['saved_at'], NOW.isoformat(timespec='seconds'))

    def test_a_step_that_never_started_keeps_its_older_entry_and_date(self):
        # contract with the planner: stale is not empty (gi, 8 Nov 2026): kits off, no alert e-mails: no fresh 0 for them
        self.seed(kits=2, job_alert_emails=1, scoring=40)
        resume.ran('scoring')
        resume.save(NOW)
        saved = resume.load_left()
        self.assertEqual(saved['kits'], {'left': 2, 'saved_at': self.OLD})
        self.assertEqual(saved['job_alert_emails'], {'left': 1, 'saved_at': self.OLD})
        self.assertEqual(saved['scoring']['left'], 0, 'the step that ran and said nothing is done')

    def test_a_first_runs_three_processes_a_step_one_never_started_keeps_its_date(self):
        # desktop/lib/search-steps.js: a first run is the search (firstJobs), then `src discover`, then the search again (mode today), one SEARCH_AT.
        # A process is a time_budget.start(): its own notes start empty; the file is all they share (review of E2b: the order is not "boards, then search").
        self.seed(kits=2)
        time_budget.start(180)   # process 1: the search; it ran scoring and the boards, left 40 jobs unscored
        resume.ran('scoring')
        resume.ran('job boards')
        time_budget.left_line('score', 40, 'jobs')
        resume.save(NOW)
        time_budget.start(180)   # process 2: discover; it ran the boards, said 3 left, never saves
        resume.ran('job boards')
        time_budget.later('job boards', 3, 'boards')
        boards_at = resume.load_left()['job_boards']['saved_at']
        time_budget.start(180)   # process 3: the search that scores what discover found; it never started the boards
        resume.ran('scoring')
        resume.save(NOW + timedelta(seconds=90))
        saved = resume.load_left()
        self.assertEqual(saved['scoring']['left'], 0, 'process 1 left 40, process 3 finished them: not "40 left"')
        self.assertEqual(saved['job_boards'], {'left': 3, 'saved_at': boards_at}, "process 3 never started the boards: discover's count and date stay")
        self.assertEqual(saved['kits'], {'left': 2, 'saved_at': self.OLD}, 'a step no process of this run started keeps its older date')

    def test_a_search_process_that_ran_the_boards_and_said_nothing_zeroes_discovers_count(self):
        time_budget.start(180)
        resume.ran('job boards')
        time_budget.later('job boards', 3, 'boards')   # discover
        time_budget.start(180)
        resume.ran('job boards')   # a later search process read the found boards to the end
        resume.save(NOW)
        self.assertEqual(resume.load_left()['job_boards']['left'], 0)

    def test_a_run_that_did_not_reach_its_end_leaves_the_older_counts_with_their_older_dates(self):
        self.seed(scoring=40)
        resume.ran('employer sites')
        time_budget.later('employer sites', 2, 'sites')   # the run is stopped here: save() is never called
        saved = resume.load_left()
        self.assertEqual(saved['scoring'], {'left': 40, 'saved_at': self.OLD})
        self.assertEqual(saved['employer_sites']['left'], 2)

    def test_a_step_name_the_table_lacks_is_a_loud_mistake_for_ran_too(self):
        with self.assertRaises(KeyError):
            resume.ran('tea breaks')


class OnlyATimedRunWrites(Isolated):
    def test_a_run_without_a_budget_writes_nothing(self):
        time_budget.start(0)
        resume.ran('scoring')
        time_budget.later('employer sites', 7, 'sites')
        resume.save(NOW)
        self.assertFalse((self.data / 'press_left.json').exists())


class AWriteThatFailsNeverStopsTheRun(Isolated):
    def test_a_folder_that_cannot_be_written_is_said_on_stderr_and_the_step_goes_on(self):
        err = io.StringIO()
        with mock.patch('src.press.resume._write', side_effect=PermissionError('read-only')), contextlib.redirect_stderr(err):
            self.assertIsNone(resume.note('kits', 2))   # the caller's line (time_budget.later, left_line) is still said
            resume.save(NOW)
        self.assertIn('could not be saved', err.getvalue())


class TheReader(Isolated):
    def test_no_file_is_an_empty_dict(self):
        self.assertEqual(resume.load_left(), {})

    def test_a_file_that_is_not_a_dict_is_an_empty_dict_and_a_broken_entry_is_skipped_alone(self):
        for text in ('{not json', '[1, 2]'):
            (self.data / 'press_left.json').write_text(text)
            self.assertEqual(resume.load_left(), {}, text)
        good = {'left': 4, 'saved_at': '2026-11-08T12:00:00+00:00'}
        (self.data / 'press_left.json').write_text(json.dumps({'scoring': 5, 'kits': {'left': 'many', 'saved_at': 'x'}, 'places': {'left': True, 'saved_at': 'x'}, 'job_facts': good,
                                                          'places': {'left': 1, 'saved_at': '2026-11-08T12:00:00'}}))   # no timezone: not an entry
        self.assertEqual(resume.load_left(), {'job_facts': good})

    def test_the_file_is_replaced_whole_and_leaves_no_part_file(self):
        time_budget.later('employer sites', 7, 'sites')
        self.assertEqual(sorted(p.name for p in self.data.iterdir()), ['press_left.json'])


if __name__ == '__main__':
    unittest.main()
