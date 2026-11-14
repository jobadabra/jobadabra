"""A first press reads its country's job boards as soon as the country answer is in, never waiting for the field answer, whose boards only take the places the country leaves.
Why (14 Nov 2026, benchmark run 43642654233, Krakow chef): the country proposal answered at 37 s and the field one at 53 s; the slice
read nothing until 53 s, so Pracuj.pl and Aplikuj.pl landed at 120 s, after the search's time, and 0 board jobs were kept (24 on 13 Nov)."""
import threading
import unittest
from unittest import mock

from src import first_jobs
from src.ai import board_ideas
from src.sources import careers

_READER = careers.READER


def setUpModule():   # no page read reaches a real model from this file (tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'locations': ['Krakow'], 'role_keywords': ['Chef de Partie']}
ASKED = ('k1', ['Poland'], ['Chef de Partie'], ['hospitality'], ['krakow'])
COUNTRY = [{'name': f'Country {i}', 'search_url': f'https://c{i}.test/?q={{role}}', 'countries': ['Poland'], 'kinds': ['hospitality'],
            'source_kind': 'general'} for i in range(first_jobs.SLICE_BOARDS)]
FIELD = [{'name': 'Field 0', 'search_url': 'https://f0.test/?q={role}', 'countries': ['Poland'], 'kinds': ['hospitality'],
          'source_kind': 'sector'}]


class TheCountrysBoardsStartBeforeTheFieldAnswers(unittest.TestCase):
    def setUp(self):
        self.addCleanup(first_jobs._early.clear)
        self.field_asked, self.field_release, self.reads, store = threading.Event(), threading.Event(), [], {}
        self.country, self.country_asks, self.country_release = list(COUNTRY), [], threading.Event()
        self.country_release.set()

        def ask(system, content, client=None):
            if system == board_ideas.FIELD_SYSTEM:
                self.field_asked.set()
                self.field_release.wait(10)
                return list(FIELD)
            self.country_asks.append(1)
            self.country_release.wait(2)
            return list(self.country)
        for name, value in (('_ask', ask), ('proven', lambda search, limit=2: []), ('slices', lambda search: [ASKED]),
                            ('asked_for', lambda search: ASKED), ('load', lambda: store), ('save', lambda data: None),
                            ('served', lambda countries: [])):
            patcher = mock.patch.object(board_ideas, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

        def read(search, top, later=None, spare=(), **kw):
            self.reads.append(([b['host'] for b in top], [b['host'] for b in spare]))
            return later
        patcher = mock.patch('src.sources.found_boards.read', side_effect=read)
        patcher.start()
        self.addCleanup(patcher.stop)
        for name in ('seconds_left',):
            patcher = mock.patch(f'src.sources.read_budget.{name}', lambda *a: 10)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = mock.patch('src.sources.read_budget.past_cut', lambda *a: False)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.finish_early)
        self.addCleanup(self.field_release.set)
        self.addCleanup(self.country_release.set)

    def finish_early(self):
        """Each test waits for its own background proposal before its patches stop (#2228)."""
        self.field_release.set()
        self.country_release.set()
        for key in ('future', 'country'):
            future = first_jobs._early.get(key)
            if future is not None:
                with mock.patch('builtins.print'):
                    future.exception(timeout=10)

    def start_slice(self):
        out = {}
        with mock.patch('builtins.print'):
            first_jobs.propose_early(SEARCH)
        thread = threading.Thread(target=lambda: out.setdefault('later', first_jobs.board_jobs(lambda line: None, SEARCH)), daemon=True)
        with mock.patch('builtins.print'):
            thread.start()
            self.assertTrue(self.field_asked.wait(5), 'the field is asked beside the country')
            thread.join(3)
        return thread, out

    def test_the_read_starts_while_the_field_is_still_asked(self):
        thread, out = self.start_slice()
        self.assertFalse(thread.is_alive(), 'the slice waited for the field answer before reading any board')
        self.assertEqual(self.reads[0][0], [b['search_url'].split('/')[2] for b in COUNTRY], "the country's boards fill the read")

    def test_the_field_boards_join_the_same_read_once_answered(self):
        thread, out = self.start_slice()
        self.assertFalse(thread.is_alive())
        self.field_release.set()
        with mock.patch('builtins.print'):
            later = out['later']()
        self.assertIn('f0.test', [b['host'] for b in later], "the field's boards are offered to the read's places left")
        self.assertEqual(len(self.reads), 1, 'one read, never a second one')

    def test_no_country_board_waits_for_the_field(self):
        self.country = []
        out, seen = {}, []
        with mock.patch('builtins.print'):
            first_jobs.propose_early(SEARCH)
            threading.Timer(0.3, lambda: (seen.append(len(self.reads)), self.field_release.set())).start()
            out['later'] = first_jobs.board_jobs(lambda line: None, SEARCH)
        self.assertEqual(seen, [0], 'no board was read before the field answered')
        self.assertEqual(self.reads[0][0], ['f0.test'], 'with no country board the field boards are the read')


    def test_a_late_country_call_is_not_asked_again_past_the_cut(self):
        self.country_release.clear()
        with mock.patch('builtins.print'), mock.patch('src.sources.read_budget.seconds_left', lambda *a: 0.2), \
                mock.patch('src.sources.read_budget.past_cut', lambda *a: True):
            first_jobs.propose_early(SEARCH)
            got = first_jobs.board_jobs(lambda line: None, SEARCH)
        self.assertEqual(got, [], 'nothing is read once the cut has come')
        self.assertEqual(len(self.country_asks), 1, 'the late country call was asked again inline, past the read cut')
        self.assertEqual(self.reads, [])


if __name__ == '__main__':
    unittest.main()
