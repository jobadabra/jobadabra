"""2/2 of #3892 (bj, 12 Nov 2026; sa's plan): a job board whose read left jobs never asked (no place or title answer in time, job_stage
never_asked) is read again by the next press, not rested 6 h; a board whose jobs were all judged still rests (the same rule as #3893's
aggregators.mark_read_unless_waiting for the free APIs, owner-accepted as its rule 6, bound owed_reads.MOST). The first test fails on main (`[] != ['b1.example']`); the second is the positive control. No AI call, no live site."""
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from src.ai import board_ideas
from src.sources import board_yield, careers, feeds, found_boards, owed_reads

NOW = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)   # pinned: the read's own time, so the 6 h rest is computed from it
SEARCH = {'role_keywords': ['data analyst'], 'locations': {'top_tier': ['Nuremberg'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Board 1', 'host': 'b1.example', 'search_url': 'https://b1.example/?q={role}', 'countries': ['Germany'], 'kinds': ['any'],
         'source_kind': 'general'}
JOBS = [{'title': 'Data Analyst', 'url': f'https://b1.example/{n}', 'location': town} for n, town in enumerate(['Fürth', 'Erlangen', 'Zirndorf'])]


class ABoardWithJobsNeverAsked(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.data = {'boards': {}}
        self.addCleanup(setattr, careers, 'READER', careers.READER)
        careers.READER = None   # the page reader stays off: no real model call (test_found_boards_ai)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(board_ideas, 'load', return_value=self.data), mock.patch.object(board_ideas, 'save'),
                      mock.patch.object(found_boards, '_dead', return_value=set()), mock.patch.object(found_boards.board_employers, 'note'),
                      mock.patch.object(found_boards, 'read_board', return_value=(JOBS, 'ok', None)),
                      mock.patch.object(feeds, 'placing', return_value=True), mock.patch.object(feeds, 'wanted_location', return_value=False),
                      mock.patch('builtins.print')):
            patch.start()
            self.addCleanup(patch.stop)

    def read(self, place_answer):
        with mock.patch.object(feeds, 'place_of', return_value=place_answer):
            found_boards.read(SEARCH, [BOARD], early=False, web=False, workers=1, is_relevant=lambda jobs: [], dead=set(), now=NOW)

    def read_then_press_an_hour_later(self, place_answer):
        self.read(place_answer)
        since = NOW - timedelta(hours=1)   # the next press, 1 h later, asks what was read in the last 6 h
        return board_yield.not_read_since([BOARD], self.data['boards'], since - timedelta(hours=5))

    def test_its_jobs_never_asked_it_is_read_again_by_the_next_press(self):
        self.assertEqual([b['host'] for b in self.read_then_press_an_hour_later(None)], ['b1.example'],
                         'the AI never placed its jobs (no answer in time): the next press reads the board again with the answers it gets then')

    def test_its_jobs_all_judged_it_rests(self):
        self.assertEqual(self.read_then_press_an_hour_later('out'), [], 'every job was placed (out of your places): the board rests 6 h as before')

    def test_it_is_read_again_by_at_most_owed_reads_most_searches_then_rests(self):
        self.read(None)
        for press in range(owed_reads.MOST):
            self.assertEqual(len(board_yield.not_read_since([BOARD], self.data['boards'], NOW - timedelta(hours=6))), 1, f'press {press + 2} reads it again')
            self.read(None)
        self.assertEqual(board_yield.not_read_since([BOARD], self.data['boards'], NOW - timedelta(hours=6)), [],
                         'the AI never answered for its jobs: after the bound it rests 6 h like any board')

    def test_a_read_that_left_jobs_waiting_is_not_a_yield_row_but_the_judged_one_is(self):
        self.read(None)
        self.assertEqual(found_boards.read_since('2000-01-01T00:00:00'), {}, 'nothing was measured: three of these must not make the board dead')
        self.read('out')
        self.assertEqual(list(found_boards.read_since('2000-01-01T00:00:00')), ['b1.example'])
        self.assertNotIn('owed', self.data['boards']['b1.example'])


if __name__ == '__main__':
    unittest.main()
