"""EURES's vacancies are sorted by title in the first press, whenever the read lands (#3339, 6 Nov 2026; owner: "go ahead. Fix the search"). Night run 42152934954: EURES
listed right local jobs for 3 personas and none was scored. (a) p13 Prague: the place AI had answered 'in' for a vacancy ("Praha, Czech Republic"; the place words say
"czechia"), `feeds.in_my_place` counted only 'best' and the words, so its title was not local, met the titles' clock (71 s of a 135 s press: time_budget RESERVE) and was
refused: 0 of 202 sorted. The AI's answer now decides. (b) p10 Amsterdam: the reader's thread placed 200 locations with the AI before it handed its jobs over (61 s on a
slow AI). (c) p1 Sofia: the hub scored one batch (31 s) before it looked at a reader that was ready. Each is played below. The employer sites' titles keep their floor
(the shared LOCAL_TITLES). Tests: this file, tests/unit/sources/test_first_jobs_hub.py."""
import json
import pathlib
import re
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest import mock

from src import first_jobs, geo, time_budget
from src.ai import engine, place_triage, title_triage
from src.sources import careers, eures, feeds

_READER = careers.READER
WAIT = 10   # a hang guard only: nothing below waits for the clock
SEARCH = {'role_keywords': ['teacher'], 'title_exclude_keywords': []}
PORTAL = 'Praha, Czech Republic'   # how the EURES portal names the country; the person's place words say "czechia"


def setUpModule():   # no page read reaches a real model from this file (tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def vacancy(title, where, n):
    return {'company': 'C', 'id': str(n), 'title': title, 'url': f'https://x.test/{n}', 'date_posted': '', 'description': '', 'location': where, 'remote': False, 'salary': ''}


class Model:
    """A fake model that records every title it was asked about (the shape of tests/unit/ai/test_title_triage_local.py)."""

    def __init__(self):
        self.asked, self.messages = [], SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        listed = kwargs['messages'][0]['content'].split('The titles:\n', 1)[1].split('\n')
        self.asked += [line.split('. ', 1)[1] for line in listed]
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'fit': [1]}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class TitlesPastTheClock(unittest.TestCase):
    """The press is at 73 s of its 135: the titles' clock (71 s) is over, scoring's share (90 s) has not begun, as in p13 Prague of the night."""

    def setUp(self):
        tmp = pathlib.Path(tempfile.mkdtemp())
        self.model = Model()
        for patch in (mock.patch.object(title_triage, 'STORE', tmp / 't.json'), mock.patch.object(place_triage, 'STORE', tmp / 'p.json'), mock.patch.object(geo, 'STORE', tmp / 'g.json'),
                      mock.patch('src.paths.DATA', tmp), mock.patch.object(feeds, 'PLACE', re.compile(r'prague|czechia', re.I)), mock.patch.object(feeds, '_SEARCH', SEARCH),
                      mock.patch.object(feeds, 'wanted_location', lambda job: True),   # these locations reached the titles: wanted, whoever said so
                      mock.patch.object(engine, 'ready', return_value=True), mock.patch.object(engine, 'client', lambda **kw: self.model), mock.patch('builtins.print')):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(lambda: setattr(feeds, 'TRIAGED', None))
        feeds.PLACED = feeds.TRIAGED = feeds.READ = None
        time_budget.start(135, now=time.monotonic() - 73)
        self.addCleanup(lambda: setattr(time_budget, 'DEADLINE', None))
        self.addCleanup(lambda: setattr(feeds, 'PLACED', None))

    def placed(self, locations, verdict):
        feeds.PLACED = {place_triage.norm(location): verdict for location in locations}

    def test_a_title_the_ai_placed_inside_your_places_is_sorted_after_the_titles_clock(self):
        self.placed([PORTAL], 'in')   # p13: the place AI said 'in'; no place word names "Czech Republic"
        feeds.triage([vacancy(f'Teacher of subject {n}', PORTAL, n) for n in range(20)])
        self.assertEqual(len(set(self.model.asked)), 20, 'the AI said the vacancies are in your places: they are local, the clock\'s floor covers them')

    def test_a_title_nobody_placed_and_no_word_names_still_waits_for_the_next_refresh(self):
        """The titles' clock is unchanged for everything else (no widening of the 180 s limit, no new special case)."""
        feeds.triage([vacancy(f'Teacher of subject {n}', PORTAL, n) for n in range(20)])
        self.assertEqual(self.model.asked, [], 'an unplaced location no place word names is not a local title')

    def test_the_employer_sites_local_titles_keep_their_floor(self):
        """Shared floor (LOCAL_TITLES): EURES's local titles do not starve the employer sites' own, asked in the same press."""
        self.placed([PORTAL], 'in')
        feeds.triage([vacancy(f'Teacher of subject {n}', PORTAL, n) for n in range(20)])
        feeds.triage([vacancy(f'Primary teacher {n}', 'Prague, Czechia', 100 + n) for n in range(5)])
        employer = {title for title in self.model.asked if title.startswith('primary teacher')}   # a set: the second look asks some twice
        self.assertEqual(employer, {f'primary teacher {n}' for n in range(5)}, f'the employer sites\' local titles were asked too: {self.model.asked}')

    def test_the_ais_answer_decides_and_the_words_only_when_it_has_none(self):
        """The AI decides; a word list is only the offline floor (CLAUDE.md): an 'out' is not overridden by a place word, an unplaced location falls back to the words."""
        word = 'Prague, Czechia'
        for verdict, location, expected in (('best', PORTAL, True), ('in', PORTAL, True), ('out', word, False), (None, word, True), (None, PORTAL, False)):
            with self.subTest(verdict=verdict, location=location):
                feeds.PLACED = {place_triage.norm(location): verdict} if verdict else {}
                self.assertEqual(feeds.in_my_place(vacancy('Teacher', location, 1)), expected)


class TheHandOverDoesNotWaitForPlacing(unittest.TestCase):
    def test_eures_jobs_reach_the_hub_before_their_locations_are_placed(self):
        """Night p10 Amsterdam: EURES read at 52 s, its 200 locations placed by the AI until 115 s (one call took 61 s), and only then handed over."""
        release, placing, placed_for = threading.Event(), threading.Event(), []
        jobs = [vacancy('Teacher', 'Praha, Czech Republic', 1)]

        def place(locations, share=False):
            placing.set()
            placed_for.extend(locations)
            release.wait(WAIT)   # a slow AI: the placing ends only when the test lets it
        pool = ThreadPoolExecutor(max_workers=2)
        try:
            with mock.patch.object(eures, 'early', return_value=object()), mock.patch.object(eures, 'read', return_value=jobs), mock.patch('src.paths.load_search_config', return_value={}), \
                    mock.patch.object(geo, 'resolve', side_effect=place):
                futures = first_jobs._others(pool)
                self.assertEqual(futures['EURES'].result(WAIT), jobs, 'the read was handed over while the placing was still waiting for the AI')
                self.assertTrue(placing.wait(WAIT), 'positive control: the placing started')
                release.set()
        finally:
            release.set()
            pool.shutdown(wait=True)
        self.assertEqual(placed_for, ['Praha, Czech Republic'], 'the locations are still placed on the map (geo keeps the answer for the next ordering)')


    def test_a_failed_read_reaches_the_hub_as_it_did_before(self):
        pool = ThreadPoolExecutor(max_workers=2)
        try:
            with mock.patch.object(eures, 'early', return_value=object()), mock.patch.object(eures, 'read', side_effect=OSError('down')), mock.patch('src.paths.load_search_config', return_value={}):
                futures = first_jobs._others(pool)
                with self.assertRaises(OSError):
                    futures['EURES'].result(WAIT)
        finally:
            pool.shutdown(wait=True)


    def test_placing_stays_inside_the_presss_stop_no_new_thread_and_nothing_asked_past_the_deadline(self):
        """The invariant: the placing runs in the reader's own worker thread (no extra thread to outlive the press; src/run_exit.py bounds that thread as before), and
        `placed` asks the AI nothing once the press's time is over."""
        before = threading.active_count()
        pool, asked = ThreadPoolExecutor(max_workers=2), []
        try:
            with mock.patch.object(eures, 'early', return_value=object()), mock.patch.object(eures, 'read', return_value=[vacancy('Teacher', PORTAL, 1)]), \
                    mock.patch('src.paths.load_search_config', return_value={}), mock.patch.object(geo, 'resolve', side_effect=lambda locations, share=False: asked.append(threading.current_thread().name)):
                first_jobs._others(pool)['EURES'].result(WAIT)
        finally:
            pool.shutdown(wait=True)
        self.assertEqual(threading.active_count(), before, 'no thread left running after the pool ended')
        self.assertEqual(len(asked), 1)
        self.assertTrue(asked[0].startswith('ThreadPoolExecutor'), f'placed in the pool\'s own worker, not a thread of its own: {asked}')
        time_budget.start(135, now=time.monotonic() - 200)   # the press's time is over
        self.addCleanup(lambda: setattr(time_budget, 'DEADLINE', None))
        with mock.patch.object(geo, 'resolve', side_effect=AssertionError('no AI call past the deadline')):
            first_jobs.placed([vacancy('Teacher', PORTAL, 2)])


if __name__ == '__main__':
    unittest.main()
