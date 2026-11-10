"""EURES reader (src/sources/eures.py): a job counts only where its region code lies in the user's place; the region comes from the AI, validated. No network."""
import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src import geo  # noqa: E402
from src.sources import aggregators, careers, eures, host_pace, nuts_names  # noqa: E402

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER

TABLE = {'BE10': 'Brussels Region', 'BE100': 'Brussels', 'BG41': 'Yugozapaden', 'BG42': 'Yuzhen tsentralen', 'BG423': 'Pazardzhik', 'BG411': 'Sofia (stolitsa)', 'BG331': 'Varna',
         'FR10': 'Ile-de-France'}   # Eurostat's NUTS table, as src/sources/nuts_names.py gives it
SEARCH = {'role_keywords': ['carpenter'], 'locations': {'top_tier': ['Brussels'], 'country_wide': [], 'abroad': []}}


class Client:
    """Answers the region question with a fixed NUTS-2 code per place word."""
    def __init__(self, answers):
        self.answers, self.messages, self.asked = answers, SimpleNamespace(create=self.create), []

    def create(self, **kwargs):
        self.asked.append(kwargs)
        words = [line.split('. ', 1)[1] for line in kwargs['messages'][0]['content'].splitlines()[1:]]
        body = {'regions': [{'n': n, 'nuts2': self.answers.get(word, '')} for n, word in enumerate(words, 1)]}
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(body))], usage=SimpleNamespace(input_tokens=0, output_tokens=0))


def jv(id, title, code, employer='Acme'):
    return {'id': id, 'title': title, 'description': '<p>Join us</p>', 'creationDate': 1792768562000, 'employer': {'name': employer}, 'locationMap': {code[:2]: [code]}}


class EuresTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        for target in ('src.sources.eures.STORE', 'src.geo.STORE'):
            mock.patch(target, Path(self.tmp.name) / (target.split('.')[-2] + '.json')).start()
        self.addCleanup(mock.patch.stopall)
        self.addCleanup(self.tmp.cleanup)
        mock.patch.object(nuts_names, 'names', lambda fetch=None: TABLE).start()
        mock.patch.object(geo, 'resolve', lambda words, client=None, ask=True, share=False: {geo.norm(w): {'kind': 'city', 'cc': 'BE', 'lat': 50.8, 'lon': 4.4, 'r': 30} for w in words}).start()

    def test_keeps_only_jobs_whose_region_is_the_places_with_the_place_as_location(self):
        calls = []

        def get(url, data=None, headers=None, timeout=None):
            calls.append(json.loads(data))
            return {'jvs': [jv('a', 'Carpenter', 'BE100'), jv('b', 'Carpenter', 'BE255')]}   # Brussels region; West Flanders
        found = eures.eures(SEARCH, get=get, client=Client({'Brussels': 'BE10'}))
        self.assertEqual([(j['id'], j['location']) for j in found], [('eures:a', 'Brussels, Belgium')])
        self.assertEqual([call['locationCodes'][0] for call in calls], ['be10', 'be'], 'the region first, the country last')

    def test_a_title_and_employer_the_portal_sends_escaped_are_text(self):
        # Why (4 Nov 2026, a tester on 0.9.6): "Audit Pharmaceutical &amp; Life Sciences" in the Jobs list, from a EURES job.
        found = eures.eures(SEARCH, get=lambda url, data=None, headers=None, timeout=None: {'jvs': [jv('a', 'Audit Pharmaceutical &amp; Life Sciences', 'BE100', 'Smith &amp; Sons')]},
                            client=Client({'Brussels': 'BE10'}))
        self.assertEqual([(j['title'], j['company']) for j in found], [('Audit Pharmaceutical & Life Sciences', 'Smith & Sons')])

    def test_a_posting_the_portal_sends_as_a_markdown_page_is_kept_as_plain_text(self):
        # Why (4 Nov 2026, a tester on 0.9.6): the Description tab opened on "---base:meta-keywords…" and literal "###" for a EURES job.
        page = '---base:meta-keywords:meta-viewport: width=device-width, initial-scale=1.0title: Cook--- Cook=====Acme hires. ### Tasks Cook **well**.'
        found = eures.eures(SEARCH, get=lambda url, data=None, headers=None, timeout=None: {'jvs': [{**jv('a', 'Cook', 'BE100'), 'description': page}]}, client=Client({'Brussels': 'BE10'}))
        self.assertEqual(found[0]['description'], 'Cook\nAcme hires. Tasks Cook well.')

    def test_a_country_word_does_not_admit_other_cities_when_the_person_named_a_city(self):
        # Why (27 Oct 2026, benchmark 40509412515, persona Krakow): "poland" matched every Polish job, shown as "poland, Poland": 1 of 52 local.
        search = {'role_keywords': ['cook'], 'locations': {'top_tier': ['Brussels', 'Belgium'], 'country_wide': [], 'abroad': []}}

        def get(url, data=None, headers=None, timeout=None):
            return {'jvs': [jv('a', 'Cook', 'BE100'), jv('b', 'Cook', 'BE255')]}
        with mock.patch.object(geo, 'resolve', lambda words, client=None, ask=True, share=False: {geo.norm(w): {'kind': 'country' if w == 'Belgium' else 'city', 'cc': 'BE', 'lat': 50.8, 'lon': 4.4, 'r': 30} for w in words}):
            found = eures.eures(search, get=get, client=Client({'Brussels': 'BE10'}))
        self.assertEqual([(j['id'], j['location']) for j in found], [('eures:a', 'Brussels, Belgium')])

    def test_a_country_listed_as_anywhere_in_keeps_the_whole_country_beside_a_town(self):
        search = {'role_keywords': ['cook'], 'locations': {'top_tier': ['Brussels'], 'country_wide': ['Belgium'], 'abroad': []}}

        def get(url, data=None, headers=None, timeout=None):
            return {'jvs': [jv('b', 'Cook', 'BE255')]}
        with mock.patch.object(geo, 'resolve', lambda words, client=None, ask=True, share=False: {geo.norm(w): {'kind': 'country' if w == 'Belgium' else 'city', 'cc': 'BE', 'lat': 50.8, 'lon': 4.4, 'r': 30} for w in words}):
            found = eures.eures(search, get=get, client=Client({'Brussels': 'BE10'}))
        self.assertEqual([j['id'] for j in found], ['eures:b'])

    def test_a_country_only_search_keeps_the_whole_country_with_no_city_in_the_location(self):
        search = {'role_keywords': ['cook'], 'locations': {'top_tier': [], 'country_wide': ['Belgium'], 'abroad': []}}

        def get(url, data=None, headers=None, timeout=None):
            return {'jvs': [jv('b', 'Cook', 'BE255')]}
        with mock.patch.object(geo, 'resolve', lambda words, client=None, ask=True, share=False: {geo.norm(w): {'kind': 'country', 'cc': 'BE'} for w in words}):
            found = eures.eures(search, get=get, client=Client({}))
        self.assertEqual([j['location'] for j in found], ['Belgium'], 'a code the table lacks: the country alone, never the person\'s word as if it were the job\'s place')

    def test_each_job_carries_the_area_of_its_own_code_never_the_persons_place_word(self):
        # Why (27 Oct 2026, search check 40528942517, persona 1 Truck Driver, Sofia): 5 jobs were all stamped "bulgaria, Bulgaria" (the person's word),
        # one lay ~200 km away and the judge could not place any. The portal gives only a NUTS code per job; Eurostat's table names it.
        search = {'role_keywords': ['truck driver'], 'locations': {'top_tier': ['Sofia'], 'country_wide': ['Bulgaria'], 'abroad': []}}
        codes = {'a': 'BG423', 'b': 'BG411', 'c': 'BG411', 'd': 'BG331', 'e': 'BG999'}

        def get(url, data=None, headers=None, timeout=None):
            return {'jvs': [jv(id, f'Driver {id}', code) for id, code in codes.items()]}
        kinds = lambda words, client=None, ask=True, share=False: {geo.norm(w): {'kind': 'country' if w == 'Bulgaria' else 'city', 'cc': 'BG', 'lat': 42.7, 'lon': 23.3, 'r': 30} for w in words}
        with mock.patch.object(geo, 'resolve', kinds):
            found = eures.eures(search, get=get, client=Client({'Sofia': 'BG41'}))
        self.assertEqual({j['id'][6:]: j['location'] for j in found},
                         {'a': 'Pazardzhik, Bulgaria', 'b': 'Sofia (stolitsa), Bulgaria', 'c': 'Sofia (stolitsa), Bulgaria', 'd': 'Varna, Bulgaria', 'e': 'Bulgaria'})
        self.assertNotIn('bulgaria, Bulgaria', [j['location'] for j in found])

    def test_a_region_code_of_another_country_is_dropped_and_the_place_not_read(self):
        read = []
        found = eures.eures(SEARCH, get=lambda *a, **k: read.append(1) or {'jvs': []}, client=Client({'Brussels': 'FR10'}))
        self.assertEqual((found, read), ([], []), 'an unvalidated region is unknown, never read on a guess')

    def test_a_code_no_region_has_is_dropped_and_the_place_not_read(self):
        # Why (5 Nov 2026, #2918): the same Toulouse got FRJ2 in 2 installs and FR61 in 2; FR61 is in no NUTS 2021 table, so the region asked gave 0 rows and no job's code matched.
        read = []
        found = eures.eures(SEARCH, get=lambda *a, **k: read.append(1) or {'jvs': []}, client=Client({'Brussels': 'BE99'}))
        self.assertEqual((found, read), ([], []), 'the country letters alone do not make a code real')

    def test_the_ai_chooses_from_the_real_regions_of_the_places_countries(self):
        client = Client({'Brussels': 'BE10'})
        eures.eures(SEARCH, get=lambda *a, **k: {'jvs': []}, client=client)
        system = client.asked[0]['system'][0]['text']
        self.assertIn('BE10 Brussels Region', system)
        self.assertNotIn('BG41', system, 'only the countries of the places asked')
        self.assertNotIn('BE100', system, 'regions, not their parts')

    def test_a_kept_code_no_region_has_is_asked_again(self):
        eures.STORE.write_text(json.dumps({'brussels': 'BE99'}))   # an install that kept an AI answer from memory
        asked = []

        def get(url, data=None, headers=None, timeout=None):
            asked.append(json.loads(data)['locationCodes'][0])
            return {'jvs': []}
        client = Client({'Brussels': 'BE10'})
        eures.eures(SEARCH, get=get, client=client)
        self.assertEqual((asked, json.loads(eures.STORE.read_text())), (['be10', 'be'], {'brussels': 'BE10'}))

    def test_a_kept_real_code_is_not_asked_again(self):
        eures.STORE.write_text(json.dumps({'brussels': 'BE10'}))
        client = Client({})
        eures.eures(SEARCH, get=lambda *a, **k: {'jvs': []}, client=client)
        self.assertEqual(client.asked, [])

    def test_with_no_table_a_code_of_the_right_shape_is_still_read(self):
        client = Client({'Brussels': 'BE10'})
        with mock.patch.object(nuts_names, 'names', lambda fetch=None: {}):
            self.assertEqual(eures.regions(['Brussels'], client), {'Brussels': ['BE10']})
        self.assertIn(eures.NO_LIST, client.asked[0]['system'][0]['text'], 'the question never points at a list that is not there')

    def test_registered_as_a_free_api_only_when_the_app_turns_it_on_and_off_by_its_switch(self):
        # Owner, 10 Nov 2026: "we should consider that we don't have access to EURES"; "In the beta/stable releases it should be on... But local and on CI ... it should be off".
        names = lambda env: [name for name, _ in aggregators.sources(env)]
        self.assertNotIn('EURES', names({}), 'a run from source, on CI or from the command line searches without EURES')
        self.assertIn('EURES', names({'JOBADABRA_EURES': '1'}), 'an installed beta or stable build (desktop/lib/eures-on.js)')
        self.assertNotIn('EURES', names({'JOBADABRA_EURES': '1', 'JOBADABRA_DISABLE': 'eures'}))
        self.assertNotIn('EURES', names({'JOBADABRA_EURES': '1', 'JOBADABRA_DISABLE': 'aggregators'}))

    def test_always_on_hands_the_installed_apps_switch_to_the_engine(self):
        """Review of oe 1/3, 10 Nov 2026: the cloud daily search is an installed app's search; the app sends the variable (desktop/lib/github.js) and daily.yml must export it."""
        daily = (Path(__file__).resolve().parents[3] / '.github' / 'workflows' / 'daily.yml').read_text()
        self.assertIn('  JOBADABRA_EURES: ${{ vars.JOBADABRA_EURES }}\n', daily)

    def test_it_runs_past_the_read_cut_and_stops_asking_after_its_own_time(self):
        from src.sources import read_budget
        self.assertIn('EURES', aggregators.CHEAP_PAST_CUT)
        asked = []
        with mock.patch.object(eures, 'out_of_time', lambda began, now=None: True):
            found = eures.eures(SEARCH, get=lambda *a, **k: asked.append(1) or {'jvs': []}, client=Client({'Brussels': 'BE10'}))
        self.assertEqual((found, asked), ([], []), 'past its own time it asks for nothing more')

    def test_scan_reads_eures_after_the_cut_but_queues_the_others(self):
        import sqlite3
        from src.sources import read_budget
        read = []
        db = sqlite3.connect(':memory:')
        with mock.patch.object(read_budget, 'past_cut', lambda now=None: True), mock.patch('builtins.print'), mock.patch('src.time_budget.later'):
            aggregators.scan(db, SEARCH, readers=[('Arbeitnow', lambda s: read.append('A') or []), ('EURES', lambda s: read.append('E') or [])])
        self.assertEqual(read, ['E'])


    def test_it_never_reads_into_the_ai_steps_share_of_the_180_seconds(self):
        from src import time_budget
        began = time_budget.BEGAN
        try:
            time_budget.start(180, now=1000.0)
            self.assertFalse(eures.out_of_time(1000.0 + 72, now=1000.0 + 80), 'at 80 s there is room')
            self.assertFalse(eures.out_of_time(1000.0 + 20, now=1000.0 + 90), 'a read that started early uses the time up to the AI steps, not a share of its own (#2918)')
            self.assertTrue(eures.out_of_time(1000.0 + 90, now=1000.0 + 95), 'titles reserve (70 s) + tail (15 s) before 180 s')
        finally:
            time_budget.DEADLINE = time_budget.STARTED = time_budget.BEGAN = time_budget.STAGE_END = None

    def _read_with_a_slow_region_answer(self, seconds):
        """eures() on a fake clock where the region question takes `seconds`; returns (jobs, pages asked)."""
        clock, asked = [1000.0], []

        def slow(places, client=None):
            clock[0] += seconds
            return {'Brussels': ['BE10']}

        def get(url, data=None, headers=None, timeout=None):
            asked.append(timeout)
            return {'jvs': [jv('a', 'Carpenter', 'BE100')]}
        with mock.patch.object(eures, 'time', SimpleNamespace(monotonic=lambda: clock[0])), mock.patch.object(eures, 'regions', slow):
            return eures.eures(SEARCH, get=get), asked

    def test_a_slow_region_answer_leaves_the_pages_their_own_time(self):
        found, asked = self._read_with_a_slow_region_answer(40)
        self.assertEqual((len(found), bool(asked), eures.CUT[0]), (1, True, False), 'the AI wait is not page time (#2918: 0 jobs when the answer took 36 s)')

    def test_a_region_answer_past_the_ai_steps_share_asks_for_no_page(self):
        from src import time_budget
        try:
            time_budget.start(135, now=1000.0)
            found, asked = self._read_with_a_slow_region_answer(72)
            self.assertEqual((found, asked, eures.CUT[0]), ([], [], True), 'the press keeps its deadline: 135 s less the titles reserve and tail is 71 s')
        finally:
            time_budget.DEADLINE = time_budget.STARTED = time_budget.BEGAN = time_budget.STAGE_END = None

    def _read(self, get, wanted, words=('carpenter',), places=None):
        """eures() with fixed region answers; `get` sees (location code, word, page)."""
        def ask(url, data=None, headers=None, timeout=None):
            body = json.loads(data)
            return get(body['locationCodes'][0], body['keywords'][0]['keyword'], body['page'])
        search = {'role_keywords': list(words), 'locations': {'top_tier': places or list(wanted), 'country_wide': [], 'abroad': []}}
        with mock.patch.object(eures, 'regions', lambda words, client=None: wanted), mock.patch('src.sources.nuts_names.names', lambda: TABLE):
            return eures.eures(search, get=ask)

    def test_it_asks_the_persons_regions_nearest_first_and_the_country_last(self):
        asked = []
        self._read(lambda area, word, page: asked.append(area) or {'jvs': []}, {'Sofia': ['BG41'], 'Varna': ['BG33']})
        self.assertEqual(asked, ['bg41', 'bg33', 'bg'], 'the country stays last, so a code the portal does not know loses nothing')

    def test_a_word_with_no_rows_does_not_end_the_read(self):
        def get(area, word, page):
            return {'jvs': [jv('a', 'Teacher', 'BG411')] if word == 'teacher' else []}
        found = self._read(get, {'Sofia': ['BG41']}, words=('rare one', 'rare two', 'rare three', 'teacher'))
        self.assertEqual([job['title'] for job in found], ['Teacher'], 'three narrow words found nothing, the fourth did (#2918, Copenhagen)')

    def test_each_word_gets_its_first_page_before_any_word_gets_a_second(self):
        asked = []

        def get(area, word, page):
            asked.append((word, page))
            return {'jvs': [jv(f'{word}{page}{n}', 'Teacher', 'BG411' if n < 10 else 'BG331') for n in range(eures.PAGE_SIZE)] if area == 'bg41' else []}   # few in the place: KEEP is far off
        self._read(get, {'Sofia': ['BG41']}, words=('one', 'two'))
        self.assertEqual(asked[:3], [('one', 1), ('two', 1), ('one', 2)])

    def test_a_full_area_stops_there_and_a_read_stops_at_its_most(self):
        asked = []

        def get(area, word, page):
            asked.append(area)
            return {'jvs': [jv(f'{area}{word}{page}{n}', 'Teacher', 'BG411') for n in range(eures.PAGE_SIZE)]}
        found = self._read(get, {'Sofia': ['BG41'], 'Plovdiv': ['BG42'], 'Varna': ['BG43']}, words=('one', 'two'))
        self.assertEqual(asked.count('bg41'), eures.KEEP // eures.PAGE_SIZE, 'enough near home: the next place gets its turn')
        self.assertEqual(len(found), eures.MOST)

    def test_one_request_names_the_region_its_parent_and_its_parts(self):
        # Why (5 Nov 2026, #2918, measured): the portal's filter takes one code level per country: DE and BE one up, SE, FI and CZ one down; a NUTS-2 code alone gave them 0 rows.
        table = {'DE21': 'Oberbayern', 'DE211': 'Ingolstadt', 'DE212': 'München', 'DE22': 'Niederbayern', 'DE221': 'Landshut'}
        self.assertEqual(eures._codes('DE21', table), ['de21', 'de2', 'de211', 'de212'])
        self.assertEqual(eures._codes('DE', table), ['de'], 'a country is itself')
        self.assertEqual(eures._codes('DE21', {}), ['de21', 'de2'], 'no table: the region and its parent')

    def test_the_code_table_is_read_before_the_page_clock_starts(self):
        clock, began = [1000.0], []

        def slow(fetch=None):
            clock[0] += 20   # a first search fetches the table: nuts_names._fetch waits up to 20 s
            return TABLE
        with mock.patch.object(eures, 'time', SimpleNamespace(monotonic=lambda: clock[0])), mock.patch.object(eures, 'regions', lambda words, client=None: {'Brussels': ['BE10']}), \
                mock.patch.object(nuts_names, 'names', slow), mock.patch.object(eures, 'out_of_time', lambda at, now=None: began.append(at) or False):
            eures.eures(SEARCH, get=lambda *a, **k: {'jvs': []})
        self.assertEqual(began[-1] - began[0], 20, 'the table is not page time either')

    def test_the_words_are_the_board_searches_then_the_role_words_each_once(self):
        self.assertEqual(eures._words({'jobs_board_search_queries': ['Lærer', 'teacher'], 'role_keywords': ['lærer', 'tutor']}), ['Lærer', 'teacher', 'tutor'])

    def _early_read(self, **future):
        """read() of a started read whose result() behaves as given; returns the future."""
        started = mock.Mock(**future)
        eures._early[aggregators.search_key(SEARCH)] = started
        return started

    def test_a_read_still_running_when_the_stage_ends_says_so_and_keeps_what_it_holds(self):
        self._early_read(**{'result.side_effect': TimeoutError(), 'done.return_value': False})
        eures.HELD[0] = [{'id': 'eures:a'}]
        with mock.patch('builtins.print') as printed:
            self.assertEqual(eures.read(SEARCH), [{'id': 'eures:a'}])
        self.assertTrue(eures.CUT[0])
        self.assertIn('still reading', printed.call_args[0][0])

    def test_a_read_that_ends_just_after_the_wait_gives_its_jobs(self):
        self._early_read(**{'result.side_effect': [TimeoutError(), [{'id': 'eures:a'}]], 'done.return_value': True})
        with mock.patch('builtins.print'):
            self.assertEqual(eures.read(SEARCH), [{'id': 'eures:a'}])

    def _cold_press(self, answer_at, get, wanted, words):
        """eures() on a 135 s press with the AI's region answers saved at `answer_at` and each page taking what `get(area, word, page, clock)` adds to the clock."""
        from src import time_budget
        clock = [1000.0]

        def ask(url, data=None, headers=None, timeout=None):
            body = json.loads(data)
            return get(body['locationCodes'][0], body['keywords'][0]['keyword'], body['page'], clock)

        def answers(places, client=None):
            clock[0] = 1000.0 + answer_at
            return wanted
        search = {'role_keywords': list(words), 'locations': {'top_tier': list(wanted), 'country_wide': [], 'abroad': []}}
        try:
            time_budget.start(135, now=1000.0)
            with mock.patch.object(eures, 'time', SimpleNamespace(monotonic=lambda: clock[0])), mock.patch.object(eures, 'regions', answers):
                return eures.eures(search, get=ask)
        finally:
            time_budget.DEADLINE = time_budget.STARTED = time_budget.BEGAN = time_budget.STAGE_END = None

    def test_a_cold_press_reaches_every_word_and_the_next_place(self):
        # Why (5 Nov 2026, #2918, code review): 3.7 s a cold page; a share of its own gave 5 pages: 7 words used them all on the first place, the next was never asked, though the stage takes the read at ~68 s.
        asked = []

        def get(area, word, page, clock):
            clock[0] += 3.7
            asked.append(area)
            return {'jvs': [jv(f'{area}{word}', 'Teacher', 'BG411' if area == 'bg41' else 'BG421')]}
        found = self._cold_press(20, get, {'Sofia': ['BG41'], 'Plovdiv': ['BG42']}, [f'word{n}' for n in range(7)])
        self.assertEqual((asked.count('bg41'), asked.count('bg42') > 0, len(found) > 7), (7, True, True))

    def test_a_cold_press_with_late_answers_finds_the_word_after_the_narrow_ones(self):
        # Why (5 Nov 2026, #2918, Copenhagen): 5 board searches with no rows came first; a page with no rows answers in ~0.5 s, a full cold one in 3.7 s.
        def get(area, word, page, clock):
            clock[0] += 3.7 if word == 'teacher' else 0.5
            return {'jvs': [jv('a', 'Teacher', 'BG411')] if word == 'teacher' else []}
        found = self._cold_press(56.5, get, {'Sofia': ['BG41']}, [f'narrow{n}' for n in range(5)] + ['teacher'])
        self.assertEqual([job['title'] for job in found], ['Teacher'], 'answers at 56.5 s (run c16) still leave 14.5 s of a 135 s press')

    def test_a_person_in_toulouse_gets_jobs_of_their_region_whatever_code_the_ai_remembers(self):
        # Why (5 Nov 2026, #2918, the owner's scenario): listed 0 near home; the same place got FRJ2 in 2 installs, FR61 in 2. The whole path: place, the AI's choice, the code, the portal, the job's area.
        table = {'FRJ2': 'Midi-Pyrénées', 'FRJ23': 'Haute-Garonne', 'FR10': 'Ile-de-France', 'FR101': 'Paris'}
        search = {'role_keywords': ['commercial'], 'locations': {'top_tier': ['toulouse'], 'country_wide': [], 'abroad': []}}
        portal = {'frj2': [jv('near', 'Commercial', 'FRJ23')], 'fr': [jv('far', 'Commercial', 'FR101')]}

        class Remembers(Client):
            def create(self, **kwargs):   # answers from memory unless the code it remembers is on the list it was given
                listed = kwargs['system'][0]['text']
                self.answers = {'toulouse': 'FRJ2' if 'FRJ2 Midi-Pyrénées' in listed else 'FR61'}
                return super().create(**kwargs)

        def get(url, data=None, headers=None, timeout=None):
            return {'jvs': portal.get(json.loads(data)['locationCodes'][0], [])}
        eures.STORE.write_text(json.dumps({'toulouse': 'FR61'}))   # an install that kept the code no region has
        with mock.patch.object(nuts_names, 'names', lambda fetch=None: table), mock.patch.object(geo, 'resolve', lambda words, client=None, ask=True, share=False: {geo.norm(w): {'kind': 'city', 'cc': 'FR'} for w in words}):
            found = eures.eures(search, get=get, client=Remembers({}))
        self.assertEqual([(j['id'], j['location']) for j in found], [('eures:near', 'Haute-Garonne, France')])

    def test_a_timeout_inside_the_read_is_a_failure_not_a_late_read(self):
        self._early_read(**{'result.side_effect': TimeoutError('the AI answer timed out'), 'done.return_value': True})
        with self.assertRaises(TimeoutError):
            eures.read(SEARCH)

    def test_the_stage_waits_out_a_last_page_asked_at_the_stop_time(self):
        started = self._early_read(**{'result.return_value': []})
        with mock.patch.object(eures, 'stop_at', lambda began: began), mock.patch('builtins.print'):
            eures.read(SEARCH)
        self.assertGreater(started.result.call_args.kwargs['timeout'], eures.LAST_PAGE, 'a read one page from its end is not dropped with all it read')

    def test_a_read_cut_short_by_its_clock_is_queued_not_marked_read_and_asks_nothing(self):
        import sqlite3
        asked = []
        db = sqlite3.connect(':memory:')

        def cut(search):
            with mock.patch.object(eures, 'out_of_time', lambda began, now=None: True):
                return eures.eures(search, get=lambda *a, **k: asked.append(1) or {'jvs': []}, client=Client({}))
        with mock.patch('builtins.print'), mock.patch('src.time_budget.later') as later:
            aggregators.scan(db, SEARCH, readers=[('EURES', cut)])
        self.assertEqual((asked, eures.CUT[0]), ([], True))
        self.assertIsNone(aggregators.read_lately(db, 'EURES', search=SEARCH), 'not marked read: the next search reads it')
        later.assert_called()

    def test_the_stage_takes_the_read_started_with_the_search_and_asks_nothing_itself(self):
        calls = []

        def get(url, data=None, headers=None, timeout=None):
            calls.append(1)
            return {'jvs': [jv('a', 'Carpenter', 'BE100')]}
        read = mock.Mock(return_value=[{'id': 'eures:a'}])
        with mock.patch.object(eures, 'eures', read), mock.patch('builtins.print'), mock.patch.dict('os.environ', {'JOBADABRA_EURES': '1'}):
            future = eures.start_early(SEARCH)
            future.result(5)
            taken = eures.read(SEARCH)
        self.assertEqual((taken, read.call_count, calls), ([{'id': 'eures:a'}], 1, []), 'one read, started early; the stage only takes it')
        self.assertEqual(eures._early, {}, 'taken once')

    def test_the_early_read_is_not_started_when_the_stage_would_not_take_it(self):
        from datetime import datetime, timezone
        from src.sources import feeds
        with mock.patch.dict('os.environ', {'JOBADABRA_EURES': '1', 'JOBADABRA_DISABLE': 'eures'}):
            self.assertIsNone(eures.start_early(SEARCH), 'switched off')
        with mock.patch.dict('os.environ', {'JOBADABRA_EURES': ''}):
            self.assertIsNone(eures.start_early(SEARCH), 'not an installed build: no early read either (desktop/lib/eures-on.js)')
        with mock.patch.object(eures, 'DATA', Path(self.tmp.name)), mock.patch.dict('os.environ', {'JOBADABRA_EURES': '1'}):
            with feeds.database(Path(self.tmp.name) / 'jobs.sqlite') as db:
                aggregators.mark_read(db, 'EURES', datetime.now(timezone.utc), SEARCH)
            self.assertIsNone(eures.start_early(SEARCH), 'read within the last SPACING_HOURS for this search')

    def test_the_early_read_is_not_started_in_the_fixture_mode(self):
        with mock.patch.dict('os.environ', {'JOBADABRA_FIXTURE_DIR': '/x'}):
            self.assertIsNone(eures.start_early(SEARCH))

    def test_the_search_starts_it_with_the_run(self):
        body = (Path(__file__).resolve().parents[3] / 'src' / 'daily_search.py').read_text()
        self.assertIn('eures.start_early(', body[body.index('board_web.early('):])


if __name__ == '__main__':
    unittest.main()
