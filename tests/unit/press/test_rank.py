"""One test per ranking weight of the Find jobs pipeline (plan 5/6, docs/superpowers/plans/2026-11-07-the-press.md): on a small fixture, the call site that used to
sort by that key gives the order it gave before the key moved into src/press/rank.py (the expected lists were written against the old code, then the move was made),
and the rank.py entry point gives the same list. A pure move: no order here may change in 5/6; changing one is a later, measured behaviour PR (owner, 7 Nov 2026)."""
import json
import pathlib
import sqlite3
import tempfile
import threading
import time  # clock: relative, only the monotonic clock of a hang guard
import unittest
from types import SimpleNamespace
from unittest import mock

from src import employer_index, first_jobs, source_rank, time_budget
from src.ai import enrich, score, slots, title_queue, title_triage
from src.press import rank
import re

from src.sources import feed_order, feeds, read_budget

SEARCH = {'role_keywords': ['software engineer'], 'title_exclude_keywords': []}


class SourcesTest(unittest.TestCase):
    def test_seen_hiring_there_feeds_with_places_in_yours_come_before_feeds_without_place_information(self):
        """employer_index.relevant: a feed naming a place of yours before a feed that names none (#3551); a feed naming only other places is out."""
        index = [{'company': 'Unplaced1'}, {'company': 'Zh', 'places': ['Zurich']}, {'company': 'Elsewhere', 'places': ['Oslo']}, {'company': 'Unplaced2'},
                 {'company': 'Zh2', 'places': ['Zurich', 'Oslo']}]
        where = lambda job: job['location'] == 'Zurich'  # noqa: E731
        self.assertEqual([f['company'] for f in employer_index.relevant(index, where)], ['Zh', 'Zh2', 'Unplaced1', 'Unplaced2'])

    def test_fast_to_read_one_request_kinds_come_first_each_group_in_the_lists_order(self):
        """first_jobs.pick: greenhouse/lever... answer in one request, so they are read first; the others keep the list's order after them."""
        feeds = [{'company': 'W1', 'ats': 'workday'}, {'company': 'G1', 'ats': 'greenhouse'}, {'company': 'C1', 'ats': 'careers'}, {'company': 'L1', 'ats': 'lever'},
                 {'company': 'V1', 'ats': 'visit'}, {'company': 'A1', 'ats': 'ashby'}]
        self.assertEqual([f['company'] for f in first_jobs.pick(feeds, 15)], ['G1', 'L1', 'A1', 'W1', 'C1'], 'a visit is not in the slice')
        self.assertEqual([f['company'] for f in first_jobs.pick(feeds, 3)], ['G1', 'L1', 'A1'])

    def test_left_last_time_the_sites_the_last_read_did_not_reach_follow_the_best(self):
        """read_budget.left_first: the first READ_FLOOR as given, then the sites the last timed read left (in the order it left them), then the rest."""
        floor = read_budget.READ_FLOOR
        sites = [{'slug': f's{n}'} for n in range(floor + 8)]
        key = lambda s: f"lever:{s['slug']}"  # noqa: E731
        left = [f's{floor + 6}', f's{floor + 2}', 'gone']
        with mock.patch.object(read_budget, '_left', return_value=[f'lever:{slug}' for slug in left]):
            order = [s['slug'] for s in read_budget.left_first(sites, key)]
        self.assertEqual(order[:floor], [f's{n}' for n in range(floor)])
        self.assertEqual(order[floor:], [f's{floor + 6}', f's{floor + 2}', f's{floor}', f's{floor + 1}', f's{floor + 3}', f's{floor + 4}', f's{floor + 5}', f's{floor + 7}'])

    def test_yield_history_proven_sources_best_per_minute_first_then_70_plus_then_per_run(self):
        """source_rank.ranked_sources + order: jobs per minute, then 70+ fits, then jobs per run, then the name; the proven keep that place in a run's candidates."""
        P = lambda source, local, per_min, fit70=0, installs=1: {'kind': 'employer', 'source': source, 'installs': installs, 'local': local,  # noqa: E731
                                                                  'fit70': fit70, 'seconds': 1.0, 'per_run': local / installs, 'per_min': per_min}
        cell = {'proven': [P('lever:slow', 9, 1.0), P('lever:fast', 2, 5.0), P('lever:tie-b', 4, 3.0, fit70=1), P('lever:tie-a', 4, 3.0, fit70=1), P('lever:tie-more', 6, 3.0, fit70=2)],
                'dead': ['employer:lever:dead']}
        with tempfile.TemporaryDirectory() as tmp:
            cache = pathlib.Path(tmp) / 'employer_index.json'
            cache.write_text(json.dumps({'feeds': [], 'ranking': {'aviation|de': cell}}))
            ranked = source_rank.ranked_sources({}, ['de'], kinds=['aviation'], cache=cache)
            self.assertEqual([s['source'] for s in ranked], ['lever:fast', 'lever:tie-more', 'lever:tie-a', 'lever:tie-b', 'lever:slow', 'lever:dead'])
            candidates = [{'ats': 'lever', 'slug': slug} for slug in ('slow', 'new1', 'tie-b', 'dead', 'fast', 'new2', 'tie-a', 'tie-more', 'new3')]
            ordered, skipped = source_rank.order(candidates, {}, ['de'], kinds=['aviation'], cache=cache)
        self.assertEqual([c['slug'] for c in ordered], ['fast', 'tie-more', 'tie-a', 'tie-b', 'new1', 'slow', 'new2', 'new3'])
        self.assertEqual([c['slug'] for c in skipped], ['dead'])

    def test_feed_quality_the_employers_that_worked_best_for_people_like_you_come_first(self):
        """employer_index.for_you: interviews x3, applications, matches per install, weighted by how specific the shared label is; the best first."""
        pool = lambda interview, applied, matched=0, installs=3: {'interview': interview, 'applied': applied, 'matched': matched, 'installs': installs}  # noqa: E731
        index = [{'company': 'Low', 'pool': pool(0, 1), 'fits': {'countries': ['ch']}},
                 {'company': 'Top', 'pool': pool(2, 1), 'fits': {'families': ['health']}},
                 {'company': 'Mid', 'pool': pool(1, 2), 'fits': {'roles': ['nurse']}},
                 {'company': 'Nothing', 'pool': pool(0, 0), 'fits': {'families': ['health']}},
                 {'company': 'Other', 'pool': pool(5, 5), 'fits': {'families': ['law']}}]
        me = {'families': ['health'], 'roles': ['nurse'], 'countries': ['ch']}
        self.assertEqual([item['company'] for item in employer_index.for_you(index, me)], ['Top', 'Mid', 'Low'])


class JobsTest(unittest.TestCase):
    JOBS = [{'id': 1, 'location': 'Paris', 'close': 1}, {'id': 2, 'location': 'Muret', 'close': 1}, {'id': 3, 'location': 'Toulouse', 'close': 1},
            {'id': 4, 'location': 'Nowhere', 'close': 1}, {'id': 5, 'location': 'Toulouse', 'close': 9}, {'id': 6, 'location': 'Lyon', 'close': 5}]
    KM = {'Toulouse': 0.0, 'Muret': 20.0, 'Lyon': 400.0, 'Paris': 600.0}

    def best_first(self, jobs, verdicts=None):
        """time_budget.best_first on the fixture: best places 'toulouse', geo's km from fixed numbers, closeness from the job."""
        from src.sources import feeds
        near = lambda tops: (lambda location: self.KM.get(location, float('inf')))  # noqa: E731
        verdict = lambda job: (verdicts or {}).get(job['id'])  # noqa: E731
        with mock.patch('src.paths.load_search_config', return_value={'locations': {'top_tier': ['toulouse']}}), \
                mock.patch.object(time_budget, 'near_best', near), mock.patch('src.job_rank.ranker', lambda search: (lambda job: job['close'])), \
                mock.patch.object(feeds, 'place_of', verdict):
            return [job['id'] for job in time_budget.best_first(jobs)]

    def test_in_your_places_a_job_in_a_best_place_comes_before_every_other(self):
        """Claude's place answer when it placed the location, else the best places' words (verdict 'best' wins over the words)."""
        self.assertEqual(self.best_first(self.JOBS)[:2], [5, 3], 'both in Toulouse; the one closest to the search first')
        self.assertEqual(self.best_first(self.JOBS, {1: 'best', 3: 'elsewhere'}), [5, 1, 3, 2, 6, 4], "Claude's verdict decides where it exists: Paris is best, a Toulouse job it placed elsewhere is not")

    def test_km_to_best_place_after_the_best_places_the_nearest_comes_first_and_an_unplaced_location_last(self):
        self.assertEqual(self.best_first(self.JOBS), [5, 3, 2, 6, 1, 4])

    def test_role_closeness_the_job_closest_to_the_search_comes_first_among_equals(self):
        jobs = [{'id': 1, 'location': 'Toulouse', 'close': 1}, {'id': 2, 'location': 'Toulouse', 'close': 7}, {'id': 3, 'location': 'Toulouse', 'close': 7}]
        self.assertEqual(self.best_first(jobs), [2, 3, 1], 'closest first; the order kept between equals')

    def test_fresh_and_waiting_for_score_newest_first_then_best_places_then_new_before_rescored(self):
        """score.pending_jobs: every new job is group (0, 0); newest first, then best_first (patched to a no-op here), then the group (stable)."""
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        jobs = [{'id': f'j{n}', 'title': f'Job {n}', 'company': 'Acme', 'description': 'd', 'first_seen_at': at}
                for n, at in enumerate(['2026-11-01', '2026-11-05', '2026-11-03', '2026-11-05', ''])]
        with mock.patch('src.time_budget.best_first', lambda found: list(found)):
            ordered = score.pending_jobs(db, jobs, 'Profile', 10)
        self.assertEqual([job['id'] for job in ordered], ['j1', 'j3', 'j2', 'j0', 'j4'], 'newest first; equal days keep the order given')

    def test_fresh_the_enrichment_queue_is_newest_first_then_best_places(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        jobs = [{'id': f'j{n}', 'title': f'Job {n}', 'description': 'd', 'first_seen_at': at} for n, at in enumerate(['2026-11-01', '2026-11-05', '2026-11-03'])]
        with mock.patch('src.store.digest_jobs', return_value=jobs), mock.patch('src.time_budget.best_first', lambda found: list(found)):
            self.assertEqual([job['id'] for job in enrich.pending_jobs(db, 10)], ['j1', 'j2', 'j0'])


class TitlesTest(unittest.TestCase):
    def setUp(self):
        self.patches = [mock.patch.object(title_triage, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 't.json')]
        for patch in self.patches:
            patch.start()
        self.addCleanup(lambda: [patch.stop() for patch in self.patches])

    def asked(self, titles, mine, near):
        asked = []

        def create(**kwargs):
            listed = kwargs['messages'][0]['content'].split('The titles:\n', 1)[1].split('\n')
            asked.extend(line.split('. ', 1)[1] for line in listed)
            return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'fit': [1]}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))
        client = SimpleNamespace(messages=SimpleNamespace(create=create))
        title_triage.decide(titles, SEARCH, client, local=mine, nearness=lambda title: near[title])
        return asked

    def test_titles_your_places_first_then_the_nearest_the_callers_order_within_equal_nearness(self):
        near = {'far a': (1, 50.0), 'near b': (1, 2.0), 'mine far c': (0, 9.0), 'mine near d': (0, 1.0), 'near e': (1, 2.0)}
        titles = ['Far A', 'Near B', 'Mine far C', 'Mine near D', 'Near E']
        self.assertEqual(self.asked(titles, ['Mine far C', 'Mine near D'], near), ['mine near d', 'mine far c', 'near b', 'near e', 'far a'])

    def test_km_to_best_place_a_titles_key_is_its_nearest_job_and_a_batchs_its_nearest_title(self):
        """feed_order.nearness: (0 in one of your places else 1, km to the best place) of the title's nearest job; rank(titles) is the nearest title's."""
        asked = [{'title': 'Nurse', 'location': 'Lyon'}, {'title': 'Nurse', 'location': 'Paris'}, {'title': 'Cook', 'location': 'Muret'}, {'title': 'Pilot', 'location': 'Oslo'}]
        km = {'Lyon': 400.0, 'Paris': 600.0, 'Muret': 20.0}
        with mock.patch.object(time_budget, 'near_best', lambda tops: (lambda location: km.get(location, float('inf')))):
            near = feed_order.nearness(asked, {'locations': {'top_tier': ['toulouse']}}, lambda job: job['location'] in ('Lyon', 'Muret'))
            keys = {title: near(title) for title in ('nurse', 'cook', 'pilot', 'unknown')}
            self.assertEqual(keys, {'nurse': (0, 400.0), 'cook': (0, 20.0), 'pilot': (1, float('inf')), 'unknown': (1, float('inf'))})
            self.assertEqual(near.rank(['nurse', 'pilot']), (0, 400.0))
            self.assertEqual(near.rank(['pilot', 'unknown']), (1, float('inf')))

    def test_reader_turn_the_nearest_batch_is_asked_first_and_equal_batches_by_their_place_in_their_list(self):
        order = []
        batches = [((1, 5.0), ['b0']), ((0, 3.0), ['b1']), ((0, 3.0), ['b2']), ((0, 1.0), ['b3']), ((1, 5.0), ['b4'])]
        title_queue.serve(batches, lambda titles: order.append(titles[0]), lambda titles, result: None, 1)
        self.assertEqual(order, ['b3', 'b1', 'b2', 'b0', 'b4'])

    def test_reader_turn_a_free_slot_goes_to_the_first_level_then_the_nearest_then_the_earliest(self):
        """slots.Slots: FIRST before NORMAL before LATER; inside a level the lower rank (nearest) first; then arrival."""
        pool = slots.Slots(1)
        got, threads = [], []

        def wait(name, level, near):
            with slots.priority(level), slots.ranked(near), pool:
                got.append(name)
        with pool:   # the one slot is busy while the others queue
            for name, level, near in [('normal-far', slots.NORMAL, (1, 9.0)), ('later', slots.LATER, ()), ('normal-near', slots.NORMAL, (0, 1.0)),
                                      ('first-far', slots.FIRST, (1, 9.0)), ('normal-near-2', slots.NORMAL, (0, 1.0))]:
                thread = threading.Thread(target=wait, args=(name, level, near), daemon=True)
                thread.start()
                threads.append(thread)
                deadline = time.monotonic() + 10   # a hang guard, not the clock the test depends on
                while pool.waiting() < len(threads) and time.monotonic() < deadline:
                    time.sleep(0.001)
        for thread in threads:
            thread.join(10)
        self.assertEqual(got, ['first-far', 'normal-near', 'normal-near-2', 'normal-far', 'later'])


class LocationsTest(unittest.TestCase):
    def test_in_your_places_the_locations_your_place_words_name_are_placed_first_then_the_most_jobs(self):
        """feeds.triage_places: the order the locations are asked to the place step (7 Oct 2026: "Genève, Switzerland" with 6 jobs waited behind 1,400 others)."""
        jobs = [{'location': place, 'title': 'Nurse', 'close': 1} for place in ['Dallas'] * 3 + ['Warsaw'] * 2 + ['Geneve, Switzerland'] + ['Lausanne'] * 1 + ['Boston']]
        asked = []
        with mock.patch.object(feeds, 'PLACE', re.compile(r'geneve|lausanne', re.I)), mock.patch.object(feeds, 'wanted_title', lambda title: True), \
                mock.patch('src.features.disabled', return_value=False), mock.patch('src.ai.engine.ready', return_value=True), \
                mock.patch('src.job_rank.ranker', lambda: (lambda job: job['close'])), \
                mock.patch('src.ai.place_triage.decide', side_effect=lambda ordered, search: asked.append(list(ordered)) or {}), mock.patch('src.ai.place_triage.vague', return_value={}):
            feeds.triage_places(jobs)
        self.assertEqual(asked[0][:4], ['geneve, switzerland', 'lausanne', 'dallas', 'warsaw'], 'your places first (most jobs first inside them), then the most jobs')


class AreasTest(unittest.TestCase):
    def test_in_your_places_eures_asks_the_regions_in_the_persons_place_order_then_each_country_last(self):
        from src.sources import eures
        wanted = {'zurich': ['CH040'], 'geneva': ['CH013'], 'switzerland': ['CH'], 'lyon': ['FRK26']}
        areas = eures._areas(wanted, ['geneva', 'switzerland', 'zurich', 'lyon'])
        self.assertEqual([codes[0] for codes in areas], ['ch013', 'ch040', 'frk26', 'ch', 'fr'])


class EntryPointsTest(unittest.TestCase):
    """The same lists straight from rank.py: each weight on its own, through the entry point its call site uses."""

    def test_seen_hiring_there(self):
        feeds = [{'company': 'U1'}, {'company': 'P1', 'places': ['Zurich']}, {'company': 'U2'}, {'company': 'P2', 'places': ['Zurich']}]
        self.assertEqual([f['company'] for f in rank.sources(feeds, rank.seen_hiring_there)], ['P1', 'P2', 'U1', 'U2'])

    def test_fast_to_read(self):
        feeds = [{'company': 'W1', 'ats': 'workday'}, {'company': 'G1'}, {'company': 'C1', 'ats': 'careers'}, {'company': 'L1', 'ats': 'lever'}]
        self.assertEqual([f['company'] for f in rank.sources(feeds, rank.fast_to_read(first_jobs.FAST))], ['G1', 'L1', 'W1', 'C1'], 'no ats means greenhouse')

    def test_left_last_time(self):
        sites = [{'slug': 'a'}, {'slug': 'b'}, {'slug': 'c'}]
        left = {'x:c': 0, 'x:a': 1}
        self.assertEqual([s['slug'] for s in rank.sources(sites[:1] + sites[2:], rank.left_last_time(left, lambda s: f"x:{s['slug']}"))], ['c', 'a'])

    def test_yield_history(self):
        stat = lambda source, per_min, fit70=0, per_run=1.0: {'source': source, 'per_min': per_min, 'fit70': fit70, 'per_run': per_run}  # noqa: E731
        rows = [stat('slow', 1.0), stat('none', None), stat('fast', 5.0), stat('tie-b', 3.0, 1), stat('tie-a', 3.0, 1), stat('tie-more', 3.0, 2)]
        self.assertEqual([r['source'] for r in rank.sources(rows, rank.yield_history)], ['fast', 'tie-more', 'tie-a', 'tie-b', 'slow', 'none'])
        place = {('employer', 'x:b'): 0, ('employer', 'x:a'): 1}
        self.assertEqual([c['slug'] for c in rank.sources([{'slug': 'a'}, {'slug': 'b'}], rank.yield_place(place, lambda c: ('employer', f"x:{c['slug']}")))], ['b', 'a'])

    def test_feed_quality(self):
        self.assertEqual([item for _, item in rank.sources([(1.0, 'low'), (9.5, 'top'), (4.0, 'mid'), (4.0, 'mid2')], rank.feed_quality)], ['top', 'mid', 'mid2', 'low'])

    def test_in_your_places_km_to_best_place_and_role_closeness(self):
        km = {'Toulouse': 0.0, 'Muret': 20.0, 'Lyon': 400.0, 'Paris': 600.0}
        jobs = [dict(job) for job in JobsTest.JOBS]
        order = rank.jobs(jobs, rank.in_your_places(lambda job: job['location'] == 'Toulouse'),
                          rank.km_to_best_place(lambda job: km.get(job['location'], float('inf'))), rank.role_closeness(lambda job: job['close']))
        self.assertEqual([job['id'] for job in order], [5, 3, 2, 6, 1, 4])

    def test_fresh_and_waiting_for_score(self):
        jobs = [{'id': 'a', 'first_seen_at': '2026-11-01'}, {'id': 'b', 'first_seen_at': '2026-11-05'}, {'id': 'c', 'first_seen_at': ''}, {'id': 'd'}, {'id': 'e', 'first_seen_at': '2026-11-05'}]
        newest = rank.jobs(jobs, rank.fresh, reverse=True)
        self.assertEqual([job['id'] for job in newest], ['b', 'e', 'a', 'c', 'd'], 'newest first; equal days (and no day) keep the order given')
        group = {id(job): key for job, key in zip(jobs, [(1, 0), (0, 0), (2, -40), (0, 0), (2, -90)])}
        self.assertEqual([job['id'] for job in rank.jobs(newest, rank.waiting_for_score(group))], ['b', 'd', 'a', 'e', 'c'])

    def test_title_nearness_and_batch_nearest(self):
        km = {'Lyon': 400.0, 'Muret': 20.0}
        near = lambda location: km.get(location, float('inf'))  # noqa: E731
        mine = lambda job: job['location'] != 'Oslo'  # noqa: E731
        self.assertEqual(rank.title_nearness([{'location': 'Lyon'}, {'location': 'Muret'}, {'location': 'Oslo'}], mine, near), (0, 20.0))
        self.assertEqual(rank.title_nearness([{'location': 'Oslo'}], mine, near), (1, float('inf')))
        self.assertEqual(rank.title_nearness([], mine, near), (1, float('inf')))
        self.assertEqual(rank.batch_nearest([(1, 5.0), (0, 400.0), (0, 20.0)]), (0, 20.0))

    def test_areas(self):
        self.assertEqual(rank.areas(['CH013', 'CH040', 'FR', 'FRK26', 'CH']), ['CH013', 'CH040', 'FRK26', 'CH', 'FR'])

    def test_waiting_entries_and_slot_tickets_are_served_smallest_first(self):
        heap = []
        for entry in [rank.waiting_entry((1, 5.0), 0, 0, 'far'), rank.waiting_entry((0, 3.0), 2, 1, 'near-late'), rank.waiting_entry((0, 3.0), 1, 2, 'near-early'),
                      rank.waiting_entry((0, 1.0), 9, 3, 'nearest')]:
            rank.push(heap, entry)
        self.assertEqual([rank.pop(heap)[3] for _ in range(4)], ['nearest', 'near-early', 'near-late', 'far'])
        tickets = [rank.slot_ticket(slots.NORMAL, (0, 1.0), 4), rank.slot_ticket(slots.FIRST, (1, 9.0), 5), rank.slot_ticket(slots.NORMAL, (0, 1.0), 1), rank.slot_ticket(slots.LATER, (), 0)]
        rank.reorder(tickets)
        self.assertEqual([rank.pop(tickets)[2] for _ in range(4)], [5, 1, 4, 0])


if __name__ == '__main__':
    unittest.main()
