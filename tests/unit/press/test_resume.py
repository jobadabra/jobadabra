"""press_left.json: the work each step of a Find jobs run left for the next one, as counts (plan E2b; owner, 8 Nov 2026: "When 3 mins stops, the
next run nows where to continue and what are the left things to do and the next goals"). The planner (pl, P2) reads it through resume.load_left().
Counts only: the items stay in their owners' files (employers_left.json, title_triage.json, late_reads.json, found_boards.json, the jobs store)."""
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

    def test_every_time_budget_stage_has_a_step(self):
        self.assertEqual(set(resume.STEPS), set(time_budget.STAGES))


class TheRunsEndFillsTheRest(Isolated):
    def test_a_stage_that_said_nothing_is_saved_as_zero_left_and_a_said_one_keeps_its_count(self):
        time_budget.later('employer sites', 7, 'sites')
        resume.save(NOW)
        saved = resume.load_left()
        self.assertEqual(sorted(saved), sorted(resume.STEPS.values()))
        self.assertEqual(saved['employer_sites']['left'], 7)
        self.assertEqual({k: v['left'] for k, v in saved.items() if k != 'employer_sites'}, {k: 0 for k in saved if k != 'employer_sites'})

    def test_another_process_of_the_same_run_does_not_zero_what_this_run_already_saved(self):
        # the job boards' step is its own process on a first run: its count must survive the search process's save()
        time_budget.later('job boards', 3, 'boards')
        time_budget.start(180)   # the search process: a new start of the same press (SEARCH_AT), no notes of its own
        now = datetime.now(timezone.utc)   # note() stamps with the real clock: the run began 10 real seconds ago
        with mock.patch.object(resume, '_run_start', return_value=now - timedelta(seconds=10)):
            resume.save(now)
        self.assertEqual(resume.load_left()['job_boards']['left'], 3)

    def test_a_count_from_an_earlier_run_is_replaced_by_this_runs_zero(self):
        old = {'scoring': {'left': 40, 'saved_at': (NOW - timedelta(days=1)).isoformat(timespec='seconds')}}
        (self.data / 'press_left.json').write_text(json.dumps(old))
        with mock.patch.object(resume, '_run_start', return_value=NOW - timedelta(seconds=170)):
            resume.save(NOW)
        self.assertEqual(resume.load_left()['scoring']['left'], 0)

    def test_a_run_that_did_not_reach_its_end_leaves_the_older_counts_with_their_older_dates(self):
        old = {'scoring': {'left': 40, 'saved_at': '2026-11-07T12:00:00+00:00'}}
        (self.data / 'press_left.json').write_text(json.dumps(old))
        time_budget.later('employer sites', 2, 'sites')   # the run is stopped here: save() is never called
        saved = resume.load_left()
        self.assertEqual(saved['scoring'], old['scoring'])
        self.assertEqual(saved['employer_sites']['left'], 2)


class OnlyATimedRunWrites(Isolated):
    def test_a_run_without_a_budget_writes_nothing(self):
        time_budget.start(0)
        time_budget.later('employer sites', 7, 'sites')
        resume.save(NOW)
        self.assertFalse((self.data / 'press_left.json').exists())


class TheReader(Isolated):
    def test_no_file_is_an_empty_dict(self):
        self.assertEqual(resume.load_left(), {})

    def test_a_broken_or_foreign_file_is_an_empty_dict_not_a_crash(self):
        for text in ('{not json', '[1, 2]', '{"scoring": 5}', '{"scoring": {"left": "many"}}'):
            (self.data / 'press_left.json').write_text(text)
            self.assertEqual(resume.load_left(), {}, text)

    def test_the_file_is_replaced_whole_and_leaves_no_part_file(self):
        time_budget.later('employer sites', 7, 'sites')
        self.assertEqual(sorted(p.name for p in self.data.iterdir()), ['press_left.json'])


if __name__ == '__main__':
    unittest.main()
