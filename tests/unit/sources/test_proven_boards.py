"""Proven job boards first (spec docs/superpowers/specs/2026-10-18-search-learns-sources.md PR 6; owner, 18 Oct 2026: boards ranked by
"relevant jobs per role", the top 2 read in the first-jobs slice). A board's history over runs is the source_yield table (one copy):
3 runs with no job in your places drop it. What a board gave goes to the pool with the board fact; the index serves it per role family ×
country and installs read the best boards first. No AI call and no live site here."""
import json
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from src import contribute, first_jobs, source_yield, store
from src.ai import board_ideas
from src.sources import aggregators, board_employers, board_yield, feeds, found_boards, visits_jobpages
from src.sources import careers  # noqa: E402

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


POOL_FACTS = visits_jobpages.pool_facts
SEARCH = {'role_keywords': ['controller'], 'locations': {'top_tier': ['Amsterdam'], 'country_wide': [], 'abroad': []}}
START = datetime(2026, 10, 18, 10, 0, tzinfo=timezone.utc)


def board(n, **extra):
    return {'name': f'Board {n}', 'host': f'b{n}.example', 'search_url': f'https://b{n}.example/?q={{role}}', 'countries': ['Netherlands'],
            'kinds': ['finance_admin'], 'source_kind': 'general', **extra}


def job(title, place, n=0, host='b1.example'):
    return {'company': 'Acme', 'id': f'{title}{place}{n}', 'title': title, 'location': place, 'url': f'https://{host}/job/{title}{place}{n}',
            'date_posted': '', 'description': '', 'remote': False, 'salary': ''}


def relevant(jobs):
    return [j for j in jobs if j['title'] == 'Controller' and j['location'] == 'Amsterdam']


class Fixture(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.data = Path(tmp.name)
        for patch in (mock.patch('src.paths.DATA', self.data), mock.patch('src.places.load', return_value={}),
                      mock.patch.object(visits_jobpages, 'pool_facts', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)
        found_boards._early.clear()
        self.db = store.connect(self.data / 'jobs.sqlite')
        self.addCleanup(self.db.close)
        self.fetched = []

    def search_run(self, run, jobs_by_host, boards=None):
        """One search: the found boards read, then the run's yield measured (what daily_search does)."""
        now = START + timedelta(hours=run)
        def fake(b, search, fetch, route=None, **kwargs):
            self.fetched.append(b['host'])
            found = jobs_by_host.get(b['host'], [])
            return found, 'ok' if found else 'empty', None
        with mock.patch.object(found_boards, 'read_board', fake):
            found_boards.read(SEARCH, boards or [board(1)], now=now, is_relevant=relevant)
        stamp = now.isoformat(timespec='seconds')
        source_yield.run(self.db, stamp, read=found_boards.read_since(stamp))


class HistoryTests(Fixture):
    def test_a_board_with_nothing_in_your_places_three_runs_running_is_dropped(self):
        banner = {'b1.example': [job('Wij zoeken jou', 'Utrecht', 1), job('Alle vacatures', 'Utrecht', 2)]}   # listed, none relevant
        for run in range(3):
            self.search_run(run, banner)
        self.assertEqual(board_yield.dead(self.db), {'b1.example'})
        self.fetched.clear()
        self.search_run(3, banner)
        self.assertEqual(self.fetched, [], 'not read again')

    def test_one_run_with_a_job_in_your_places_keeps_it_for_three_more(self):
        good = {'b1.example': [job('Controller', 'Amsterdam')]}
        for run, jobs in enumerate([{}, {}, good, {}, {}]):
            self.search_run(run, jobs)
        self.assertEqual(board_yield.dead(self.db), set(), 'the last 3 runs hold one with a relevant job')

    def test_a_board_whose_jobs_link_to_other_sites_keeps_its_reads_count(self):
        elsewhere = {'b1.example': [job('Controller', 'Amsterdam', host='careers.acme.example')]}
        for run in range(4):
            self.search_run(run, elsewhere)
        self.assertEqual(board_yield.dead(self.db), set())

    def test_the_boards_file_keeps_this_read_only(self):
        self.search_run(0, {'b1.example': [job('Wij zoeken jou', 'Utrecht')]})
        entry = board_ideas.load()['boards']['b1.example']
        self.assertEqual((entry['jobs'], entry['relevant'], entry['state']), (1, 0, 'ok'))
        self.assertNotIn('misses', entry, 'the history lives in source_yield, one copy')


class ShareTests(Fixture):
    def setUp(self):
        super().setUp()
        for patch in (mock.patch.object(feeds, 'wanted_location', lambda j: j['location'] in ('Amsterdam', 'Remote')),
                      mock.patch.object(feeds, 'in_my_place', lambda j: j['location'] == 'Amsterdam')):
            patch.start()
            self.addCleanup(patch.stop)

    def test_a_board_fact_carries_what_the_board_gave_this_search(self):
        self.search_run(0, {'b1.example': [job('Controller', 'Amsterdam', 1), job('Controller', 'Remote', 2)]}, boards=[board(1), board(2)])
        self.db.execute("INSERT INTO companies (id, name, updated_at) VALUES (1, 'Acme', ?)", (START.isoformat(),))
        self.db.execute("INSERT INTO sources (id, name, kind) VALUES (1, 'Job boards found', 'job board')")
        for n, place in ((1, 'Amsterdam'), (2, 'Remote')):   # the two jobs the board listed, saved
            self.db.execute('INSERT INTO jobs (id, canonical_key, source_id, company_id, title, url, location, first_seen_at, last_seen_at, state) '
                            "VALUES (?, ?, 1, 1, 'Controller', ?, ?, ?, ?, 'open')", (n, f'k{n}', f'https://b1.example/job/Controller{place}{n}', place, START.isoformat(), START.isoformat()))
        source_yield.run(self.db, (START + timedelta(hours=1)).isoformat(timespec='seconds'))
        facts = {fact['host']: fact for fact in contribute.site_facts(db=self.db) if fact['kind'] == 'board'}
        self.assertEqual(facts['b1.example']['board'], {'countries': ['nl']})
        self.assertEqual(facts['b1.example']['yield'], {'in_places': 1, 'fit70': 0}, 'the remote job is in your places for you but is not shared as local')
        self.assertNotIn('b2.example', facts, 'a board that listed nothing is not a fact')
        self.assertNotIn('yield', contribute.site_facts()[0], 'no job cache, no counts')


class RankTests(Fixture):
    def served(self, cells_by_host):
        return {'board': {f'b{n}.example': {'url': f'https://b{n}.example/?q={{role}}', 'countries': ['nl'], 'relevant': cells}
                          for n, cells in cells_by_host.items()}}

    def cell(self, family, installs, in_places, fit70=0, country='nl'):
        return {'family': family, 'country': country, 'installs': installs, 'in_places': in_places, 'fit70': fit70}

    def test_boards_are_ranked_by_jobs_in_places_per_install_for_your_role_families(self):
        facts = self.served({1: [self.cell('accounting_finance', 3, 6, fit70=1)], 2: [self.cell('accounting_finance', 4, 40, fit70=2), self.cell('software_dev', 9, 900)],
                             3: [], 4: [self.cell('software_dev', 5, 500)], 5: [self.cell('accounting_finance', 3, 9, country='de')]})
        with mock.patch.object(visits_jobpages, 'pool_facts', return_value=facts), \
                mock.patch.object(board_ideas, '_families', return_value={'accounting_finance'}), \
                mock.patch('src.places.countries', return_value=['Netherlands']):
            ranked = board_ideas.ranked(board_ideas.served(['Netherlands']), SEARCH)
            proven = board_ideas.proven(SEARCH)
        self.assertEqual([(b['host'], b['rank']) for b in ranked][:2], [('b2.example', 10.0), ('b1.example', 2.0)])
        self.assertEqual({b['host'] for b in ranked[2:]}, {'b3.example', 'b4.example', 'b5.example'}, 'another family or country gives no rank')
        self.assertEqual([b['host'] for b in proven], ['b2.example', 'b1.example'], 'no Scout count anywhere (a thin table): the top 2, ranked boards with a fit job only, as before')

    def test_jobs_in_places_without_a_fit_job_rank_a_board_but_do_not_prove_it(self):
        """12 Nov 2026 (vb): Madrid's electrician and Seville's car mechanic were "proven" an IT board by one install's list (installs 1,
        40 jobs in places, fit70 0), so the proposal for Spain was never asked. A cell with a fit job proves it, as before (no Scout count: 13 Nov 2026, eo)."""
        facts = self.served({1: [self.cell('electrical_mechanical', 1, 40)], 2: [self.cell('electrical_mechanical', 1, 5, fit70=1)]})
        with mock.patch.object(visits_jobpages, 'pool_facts', return_value=facts), \
                mock.patch.object(board_ideas, '_families', return_value={'electrical_mechanical'}), \
                mock.patch('src.places.countries', return_value=['Netherlands']):
            ranked = board_ideas.ranked(board_ideas.served(['Netherlands']), SEARCH)
            proven = board_ideas.proven(SEARCH)
            only_jobs = {'board': {'b1.example': facts['board']['b1.example']}}
            with mock.patch.object(visits_jobpages, 'pool_facts', return_value=only_jobs):
                self.assertEqual(board_ideas.proven(SEARCH), [], 'no fit evidence: the proposal is asked')
        self.assertEqual([b['host'] for b in ranked], ['b1.example', 'b2.example'], 'jobs in places still rank it first')
        self.assertEqual([b['host'] for b in proven], ['b2.example'])

    def test_without_data_for_anyone_the_order_is_unchanged_and_no_family_is_asked(self):
        with mock.patch.object(visits_jobpages, 'pool_facts', return_value=self.served({1: [], 2: []})), \
                mock.patch.object(board_ideas, '_families', side_effect=AssertionError('no labels needed')):
            self.assertEqual([b['host'] for b in board_ideas.ranked(board_ideas.served(['Netherlands']), SEARCH)], ['b1.example', 'b2.example'])

    def test_a_ranked_board_claude_also_proposed_keeps_its_rank(self):
        merged = board_ideas._merge([board(2), board(7)], [{**board(2), 'rank': 4.0}, board(1)])
        self.assertEqual([(b['host'], b.get('rank')) for b in merged], [('b2.example', 4.0), ('b7.example', None), ('b1.example', None)],
                         'a shared board with no record for this field comes after the proposals (11 Nov 2026, #3835)')

    def test_a_shared_board_with_no_record_for_the_field_is_read_after_the_proposals(self):
        """11 Nov 2026, #3835: a pilots' board the pool serves for the country was the first board read for a carpenter."""
        merged = board_ideas._merge([board(7), board(8)], [{**board(1), 'rank': 0}, {**board(2), 'rank': 0, 'rank_fit70': 0}, {**board(3), 'rank': 2.5}])
        self.assertEqual([b['host'] for b in merged], ['b3.example', 'b7.example', 'b8.example', 'b1.example', 'b2.example'])

    def test_a_board_is_proven_by_the_scouts_count_of_right_jobs_and_read_in_that_order(self):
        """13 Nov 2026 (bp, owner: "Why ? Let's fix it."), Madrid electrician c04: an airline board (178 jobs, ONE aircraft electrician) was `measured` for electricians
        and the first board read in 5 of 5 searches, with 0 right jobs; Jobeka (19 right) was never read first. The 12 Nov test that proved a board by the Scout's
        mark alone (`measured`, no fit count) asserted the opposite: it is replaced by this one. Its read of another field, in a browser, or fewer than PROVEN_RIGHT jobs proves nothing,
        not even with a fit job in an install's list: the Scout's number is the board's state while it has one."""
        scout = lambda family, right, **more: {**self.cell(family, 1, right), 'right': right, **more, **({'measured': True} if right >= board_ideas.PROVEN_RIGHT else {})}
        facts = self.served({1: [{**scout('electrical_mechanical', 1), 'installs': 2, 'fit70': 4}],   # the airline board: one electrician among 178 jobs, and an install's fit job
                             2: [scout('electrical_mechanical', 19, day='2026-11-13')],   # Jobeka
                             3: [scout('software_dev', 40)],                      # another field
                             4: [scout('electrical_mechanical', 16)],             # Trabajo.org
                             5: [scout('electrical_mechanical', 30)],             # a board read only in a browser
                             6: [self.cell('electrical_mechanical', 1, 178)]})    # old index: the Scout's whole list, no count, no fit job
        facts['board']['b5.example']['browser'] = True
        with mock.patch.object(visits_jobpages, 'pool_facts', return_value=facts), mock.patch.object(board_ideas, '_families', return_value={'electrical_mechanical'}), \
                mock.patch('src.places.countries', return_value=['Netherlands']):
            proven = board_ideas.proven(SEARCH, limit=6)
            ranked = board_ideas.ranked(board_ideas.served(['Netherlands']), SEARCH)
        self.assertEqual([(b['host'], b['right']) for b in proven], [('b2.example', 19), ('b4.example', 16)],
                         'most right jobs first; one electrician (even with a fit job), another field, a browser board and an uncounted list prove nothing')
        self.assertEqual([b['host'] for b in ranked][:4], ['b5.example', 'b2.example', 'b4.example', 'b1.example'], 'the count orders before jobs in places (b6 has 178 and no count)')
        self.assertNotIn('right', next(b for b in ranked if b['host'] == 'b6.example'), 'not measured: no number, never 0')

    def test_two_cells_under_the_scouts_threshold_do_not_add_up_to_a_proof(self):
        """13 Nov 2026 (Gitar on #4045): the Scout's 3 is per (country, family); a person with two families counted 2 each on a board is not "proven" 4. The sum only orders."""
        two = lambda family, right: {**self.cell(family, 1, right), 'right': right}
        facts = self.served({1: [two('electrical_mechanical', 2), two('construction_trades', 2)], 2: [two('electrical_mechanical', 3)]})
        with mock.patch.object(visits_jobpages, 'pool_facts', return_value=facts), mock.patch.object(board_ideas, '_families', return_value={'electrical_mechanical', 'construction_trades'}), \
                mock.patch('src.places.countries', return_value=['Netherlands']):
            ranked = board_ideas.ranked(board_ideas.served(['Netherlands']), SEARCH)
            self.assertEqual([b['host'] for b in board_ideas.proven(SEARCH, limit=6)], ['b2.example'])
        self.assertEqual([(b['host'], b['right']) for b in ranked], [('b1.example', 4), ('b2.example', 3)], 'the sum orders')

    def test_a_shared_board_the_scout_counted_goes_before_the_proposals_even_without_a_rank(self):
        """13 Nov 2026 (Gitar on #4045): a Scout count is a record for the field, whatever `rank` says."""
        merged = board_ideas._merge([board(7)], [{**board(1), 'rank': 0, 'right': 19, 'right_best': 19}, {**board(2), 'rank': 0}])
        self.assertEqual([b['host'] for b in merged], ['b1.example', 'b7.example', 'b2.example'])

    def test_a_counted_board_comes_first_and_an_uncounted_one_with_a_fit_job_keeps_its_place_after_it(self):
        """13 Nov 2026 (eo): most pairs have no Scout count yet. A board with no number is proven as before (a fit job of an install), never dropped for the want of one;
        boards the Scout counted read first, six in all (first_jobs.SLICE_BOARDS)."""
        facts = self.served({1: [self.cell('electrical_mechanical', 2, 20, fit70=2)], 2: [{**self.cell('electrical_mechanical', 1, 19), 'right': 19, 'measured': True}]})
        with mock.patch.object(visits_jobpages, 'pool_facts', return_value=facts), mock.patch.object(board_ideas, '_families', return_value={'electrical_mechanical'}), \
                mock.patch('src.places.countries', return_value=['Netherlands']):
            self.assertEqual([b['host'] for b in board_ideas.proven(SEARCH, limit=6)], ['b2.example', 'b1.example'])

    def test_a_count_from_a_boards_own_list_never_outranks_one_from_its_search_and_a_counted_zero_goes_last(self):
        """13 Nov 2026 (bp + eo; Gitar on #4063), c04 Madrid electrician: airlinejobs.com was counted 53 right from its own list (about 5 a search page), Jobeka 19 from its search. The searched
        count orders first; a list count next; a board nobody measured (an install's fit job) before one counted 0. A cell with no `listed` field orders as today."""
        scout = lambda right, **more: {**self.cell('electrical_mechanical', 1, right), 'right': right, **more}
        facts = self.served({1: [scout(53, listed=True)], 2: [scout(19)], 3: [scout(0)], 4: [self.cell('electrical_mechanical', 2, 20, fit70=2)], 5: [scout(16)]})
        with mock.patch.object(visits_jobpages, 'pool_facts', return_value=facts), mock.patch.object(board_ideas, '_families', return_value={'electrical_mechanical'}), \
                mock.patch('src.places.countries', return_value=['Netherlands']):
            ranked = board_ideas.ranked(board_ideas.served(['Netherlands']), SEARCH)
            proven = board_ideas.proven(SEARCH, limit=6)
        self.assertEqual([b['host'] for b in ranked], ['b2.example', 'b5.example', 'b1.example', 'b4.example', 'b3.example'])
        self.assertEqual([b['host'] for b in proven], ['b2.example', 'b5.example', 'b4.example'],
                         'a counted 0 is not proven, nor is a count of a board\'s whole list (53 of 178: it orders, never proves; Gitar on #4106); the uncounted board keeps its fit-job proof')
        facts = self.served({1: [scout(53)], 2: [scout(19)]})   # the field absent (an old index): the larger count first, as before
        with mock.patch.object(visits_jobpages, 'pool_facts', return_value=facts), mock.patch.object(board_ideas, '_families', return_value={'electrical_mechanical'}), \
                mock.patch('src.places.countries', return_value=['Netherlands']):
            self.assertEqual([b['host'] for b in board_ideas.ranked(board_ideas.served(['Netherlands']), SEARCH)], ['b1.example', 'b2.example'])

    def test_a_counted_zero_is_no_record_for_the_field_in_the_merge(self):
        merged = board_ideas._merge([board(7)], [{**board(1), 'rank': 0, 'right': 0, 'right_best': 0}, {**board(2), 'rank': 0, 'right': 5, 'right_best': 5}])
        self.assertEqual([b['host'] for b in merged], ['b2.example', 'b7.example', 'b1.example'])

    def test_the_merge_puts_ahead_of_the_proposals_only_the_boards_proven_would_read_first(self):
        """13 Nov 2026 (Gitar on #4106): the merge put a board counted 1-2 right jobs, or only from its list, ahead of the per-search proposals while proven() needs PROVEN_RIGHT
        from the board's own search; both gates now read the same `right_best`, so a board proven() would not read first never goes before the proposals."""
        scout = lambda right, **more: {**self.cell('electrical_mechanical', 1, right), 'right': right, **more}
        facts = self.served({1: [scout(2)], 2: [scout(53, listed=True)], 3: [scout(board_ideas.PROVEN_RIGHT)]})
        with mock.patch.object(visits_jobpages, 'pool_facts', return_value=facts), mock.patch.object(board_ideas, '_families', return_value={'electrical_mechanical'}), \
                mock.patch('src.places.countries', return_value=['Netherlands']):
            ranked = board_ideas.ranked(board_ideas.served(['Netherlands']), SEARCH)
            proven = board_ideas.proven(SEARCH, limit=6)
        merged = board_ideas._merge([board(7)], [{**b, 'rank': 0} for b in ranked])
        self.assertEqual([b['host'] for b in proven], ['b3.example'], 'only the searched count at the threshold proves a board')
        self.assertEqual([b['host'] for b in merged][:2], ['b3.example', 'b7.example'], 'the proven board, then the proposals; a count of 2 and a list-only 53 wait behind them')

    def test_the_listed_mark_survives_the_index_read_only_as_true(self):
        index = {'sites': [{'host': 'b1.example', 'kind': 'board', 'url': 'https://b1.example/?q={role}', 'recipe': {'countries': ['nl']},
                            'relevant': [{**self.cell('nursing_care', 1, 14), 'right': 14, 'listed': True}, {**self.cell('software_dev', 1, 9), 'right': 9, 'listed': 'yes'}]}]}
        cache = self.data / 'employer_index.json'
        cache.write_text(json.dumps(index))
        with mock.patch('src.employer_index.CACHE', cache):
            cells = POOL_FACTS()['board']['b1.example']['relevant']
        self.assertEqual(cells, [{**self.cell('nursing_care', 1, 14), 'right': 14, 'listed': True}, {**self.cell('software_dev', 1, 9), 'right': 9}])

    def test_the_scouts_mark_on_a_cell_survives_the_index_read_only_as_true(self):
        index = {'sites': [{'host': 'b1.example', 'kind': 'board', 'url': 'https://b1.example/?q={role}', 'recipe': {'countries': ['nl']},
                            'relevant': [{**self.cell('nursing_care', 1, 14), 'measured': True, 'right': 14, 'day': '2026-11-13'},
                                         {**self.cell('software_dev', 1, 9), 'measured': 'yes', 'right': '9', 'day': 'yesterday'}]}]}
        cache = self.data / 'employer_index.json'
        cache.write_text(json.dumps(index))
        with mock.patch('src.employer_index.CACHE', cache):
            cells = POOL_FACTS()['board']['b1.example']['relevant']
        self.assertEqual(cells, [{**self.cell('nursing_care', 1, 14), 'measured': True, 'right': 14, 'day': '2026-11-13'}, self.cell('software_dev', 1, 9)],
                         'the number only as a whole number and its day only as a date; anything else is dropped')

    def test_the_index_cells_are_read_in_their_fixed_shape_only(self):
        index = {'sites': [{'host': 'b1.example', 'kind': 'board', 'url': 'https://b1.example/?q={role}', 'recipe': {'countries': ['nl']},
                            'relevant': [self.cell('accounting_finance', 3, 6), {'family': 'x', 'country': 'nl', 'installs': 'many'}, 'junk']}]}
        cache = self.data / 'employer_index.json'
        cache.write_text(json.dumps(index))
        with mock.patch('src.employer_index.CACHE', cache):
            facts = POOL_FACTS()   # the real reader, not the fixture's stand-in
        self.assertEqual(facts['board']['b1.example']['relevant'], [self.cell('accounting_finance', 3, 6)])


class FirstSliceTests(Fixture):
    def test_the_top_two_boards_are_read_in_the_first_slice_and_no_page_is_fetched_twice(self):
        """The full read asks those boards every query and their next pages (18 Oct 2026: a slice's 2-query read used to stand for the whole
        board, so its other queries and pages were never read); the pages the slice fetched are served from it, not asked again."""
        jobs = {'b1.example': [job('Controller', 'Amsterdam', 1)], 'b2.example': [job('Controller', 'Amsterdam', 2, host='b2.example')]}
        asked = []
        def fake(b, search, fetch, route=None, early=False, **kwargs):
            self.fetched.append((b['host'], early))
            fetch(f"https://{b['host']}/search")
            return jobs.get(b['host'], []), 'ok', None
        imported, said = [], []
        with feeds.database(self.data / 'jobs.sqlite') as feed_db, \
                mock.patch.object(board_ideas, 'proven', return_value=[board(1), board(2)]), \
                mock.patch.object(found_boards.careers, 'get_text', lambda url: asked.append(url) or '<html></html>'), \
                mock.patch.object(found_boards, 'read_board', fake), mock.patch.object(found_boards, '_dead', return_value=set()), \
                mock.patch.object(feeds, 'wanted_title', lambda title: title == 'Controller'), \
                mock.patch.object(feeds, 'wanted_location', lambda j: j['location'] == 'Amsterdam'), \
                mock.patch.object(board_employers, 'fill_missing'), mock.patch.object(board_employers, 'note'):
            found = first_jobs.board_jobs(said.append)   # a first run reads this list in the boards' lane since lanes 4a (src/sources/boards_first.py Beside)
            imported.extend(aggregators.kept(feed_db, 'Job boards found', found))   # and keeps each group as it lands (Beside._deliver)
            self.assertEqual(sorted(j['url'] for j in imported), ['https://b1.example/job/ControllerAmsterdam1', 'https://b2.example/job/ControllerAmsterdam2'])
            self.assertTrue(any('Board 1, Board 2' in line for line in said), said)
            full = found_boards.read(SEARCH, [board(1), board(2), board(3)])
        self.assertEqual(sorted(self.fetched), [('b1.example', False), ('b1.example', True), ('b2.example', False), ('b2.example', True), ('b3.example', False)],
                         'the full read reads every board in full')
        self.assertEqual(sorted(url for url in asked if not url.endswith(('.example/', '/robots.txt'))), ['https://b1.example/search', 'https://b2.example/search', 'https://b3.example/search'],
                         'the pages the slice fetched are not asked again')
        self.assertEqual(len(full), 2, 'and still returns the slice\'s jobs')

    def test_with_no_proven_board_the_slice_reads_the_boards_proposed_for_your_country(self):
        """18 Oct 2026: a driver's jobs all came from a board, read only after 140 employer sites (176 s); no install had shared one yet."""
        said, read = [], []
        proposed = [board(1), board(2), board(3)]
        data = {'boards': {'b1.example': {'state': 'browser'}}}   # refused us before: a visit, not a slice read
        with mock.patch.object(board_ideas, 'proven', return_value=[]), mock.patch.object(board_ideas, 'ideas', return_value=proposed), \
                mock.patch.object(board_ideas, 'load', return_value=data), \
                mock.patch.object(found_boards, 'read', lambda search, boards, early=False, **_: read.append((boards, early)) or []):
            first_jobs.board_jobs(said.append, SEARCH)
        self.assertEqual([([b['host'] for b in boards], early) for boards, early in read], [(['b2.example', 'b3.example'], True)])
        self.assertTrue(any('Board 2, Board 3' in line for line in said), said)

    def test_no_proven_and_no_proposed_board_reads_nothing_and_says_nothing(self):
        said = []
        with mock.patch.object(board_ideas, 'proven', return_value=[]), mock.patch.object(board_ideas, 'ideas', return_value=[]), \
                mock.patch.object(found_boards, 'read') as read:
            self.assertEqual(first_jobs.board_jobs(said.append, SEARCH), [])
        read.assert_not_called()
        self.assertEqual(said, [])

    def test_measured_boards_are_read_at_once_and_the_ais_boards_join_the_same_read_when_named(self):
        """Owner, 12 Nov 2026: "We should now from the start what boards/employers we should read first"; a France nurse's proven boards
        kept the AI's boards out of the first search (3 boards read instead of 6: 16 relevant jobs against 19)."""
        named, reading, order = threading.Event(), threading.Event(), []
        jobs = {f'b{n}.example': [job('Controller', 'Amsterdam', n, host=f'b{n}.example')] for n in (1, 2, 3)}

        def fake(b, search, fetch, route=None, early=False, **kwargs):
            order.append(b['host'])
            if b['host'] == 'b1.example':
                reading.set()
                self.assertTrue(named.wait(5), 'the measured board is still being read when the AI names its boards')
            return jobs[b['host']], 'ok', None

        def ideas(search):   # the AI answers only once the measured board is being read, and caches its answer as the real one does
            self.assertTrue(reading.wait(5), 'positive control: the measured board started before the AI answered')
            with board_ideas.STORE:
                data = board_ideas.load()
                data.setdefault('ideas', {})['k'] = [board(2)]
                board_ideas.save(data)
            named.set()
            return [board(1), board(2), board(3)]
        said = []
        with mock.patch.object(board_ideas, 'proven', return_value=[board(1)]), mock.patch.object(board_ideas, 'ideas', ideas), \
                mock.patch.object(found_boards, 'read_board', fake), mock.patch.object(found_boards, '_dead', return_value=set()), \
                mock.patch.object(board_employers, 'fill_missing'), mock.patch.object(board_employers, 'note'), mock.patch('builtins.print'):
            found = first_jobs.board_jobs(said.append, SEARCH)
        self.assertEqual(order[0], 'b1.example', 'the measured board is read first, before any AI answer')
        self.assertEqual(sorted(order), ['b1.example', 'b2.example', 'b3.example'], 'each board once: the measured one is not read again')
        self.assertEqual(sorted(j['url'] for j in found), sorted(j['url'] for group in jobs.values() for j in group), 'one read returns all three boards\' jobs')
        kept = board_ideas.load()
        self.assertEqual(sorted(kept['boards']), ['b1.example', 'b2.example', 'b3.example'], 'one board memory: every board\'s read is kept')
        self.assertEqual(kept['ideas'], {'k': [board(2)]}, 'the answer the AI cached while the read ran is not written over')

    def test_the_ais_boards_fill_only_the_places_the_measured_boards_left(self):
        order = []
        def fake(b, search, fetch, route=None, early=False, **kwargs):
            order.append(b['host'])
            return [], 'empty', None
        measured = [board(n) for n in range(1, first_jobs.SLICE_BOARDS)]   # one place left
        with mock.patch.object(board_ideas, 'proven', return_value=measured), mock.patch.object(found_boards, '_dead', return_value=set()), \
                mock.patch.object(board_ideas, 'ideas', return_value=[board(1), board(21), board(22)]), mock.patch.object(found_boards.board_check, 'kind', return_value=('', '')), \
                mock.patch.object(found_boards, 'read_board', fake), mock.patch.object(board_employers, 'note'), mock.patch('builtins.print'):
            first_jobs.board_jobs(lambda line: None, SEARCH)
        self.assertEqual(sorted(order), sorted([b['host'] for b in measured] + ['b21.example']))

    def test_a_full_slice_of_measured_boards_waits_for_no_ai_answer(self):
        measured = [board(n) for n in range(1, first_jobs.SLICE_BOARDS + 1)]
        with mock.patch.object(board_ideas, 'proven', return_value=measured), mock.patch.object(found_boards, 'read', return_value=[]) as read, \
                mock.patch.object(board_ideas, 'ideas', side_effect=AssertionError('no place is left for the AI\'s boards')):
            first_jobs.board_jobs(lambda line: None, SEARCH)
        self.assertIsNone(read.call_args.kwargs.get('later'))

    def test_the_search_slice_reads_proven_boards_without_an_ai_call(self):
        with mock.patch.object(visits_jobpages, 'pool_facts', return_value={}), \
                mock.patch('src.places.countries', return_value=['Netherlands']), \
                mock.patch.object(board_ideas, 'ideas', side_effect=AssertionError('the slice never asks the AI for boards')):
            self.assertEqual(board_ideas.proven(SEARCH), [])


if __name__ == '__main__':
    unittest.main()
