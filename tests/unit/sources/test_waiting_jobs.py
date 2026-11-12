"""A job a search read and had no time to judge waits, and the queue after the search judges and lists it (src/sources/waiting_jobs.py).
Why (owner, 12 Nov 2026, asked via AskUserQuestion: "Yes, build it (Recommended)"; 30 first searches: 1,068 of 2,019 board jobs came back after the AI's stop and were dropped).
Offline: the place-call tests' own fake model (tests/unit/ai/test_titles_with_places.py), temp stores, example names only."""
import pathlib
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from src import geo
from src.ai import batch_scope, engine, place_triage, title_queue, title_triage
from src.sources import aggregators, feeds, places_later, waiting_jobs
from tests.unit.ai.test_titles_with_places import Model

SEARCH = {'role_keywords': ['known role'], 'preferences': {'locations': {'best': ['Known town']}}}
NOW = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)


def board():
    """A board's page for the city: one job naming it, two in the next town."""
    return [{'title': title, 'location': town, 'url': f'https://board.example.test/job/{n}', 'company': 'Example SARL', 'id': str(n), 'date_posted': '',
             'description': '', 'remote': False, 'salary': ''}
            for n, (title, town) in enumerate([('Known role 0', 'Known town'), ('Late role 0', 'Late town'), ('Late role 1', 'Late town')])]


class JobsJudgedAfterTheSearch(unittest.TestCase):
    def setUp(self):
        tmp = pathlib.Path(tempfile.mkdtemp())
        self.model = Model()
        self.model.gate.set()
        for patch in (mock.patch.object(place_triage, 'STORE', tmp / 'p.json'), mock.patch.object(title_triage, 'STORE', tmp / 't.json'),
                      mock.patch.object(geo, 'STORE', tmp / 'g.json'), mock.patch.object(places_later, 'STORE', tmp / 'later.json'),
                      mock.patch.object(engine, 'ready', return_value=True), mock.patch.object(engine, 'client', lambda **kw: self.model),
                      mock.patch.object(engine, 'PARALLEL', 4), mock.patch.object(feeds, '_SEARCH', SEARCH),
                      mock.patch.object(feeds, 'wanted_location', lambda job: job['location'] == 'Known town' or feeds.place_of(job) in ('best', 'in')),
                      mock.patch.object(feeds, 'in_my_place', lambda job: job['location'] == 'Known town'),
                      mock.patch.object(geo, 'verdicts', lambda *args, **kw: {}),   # no map: the model places, as for a town seen for the first time
                      mock.patch.object(aggregators.board_employers, 'fill_missing'), mock.patch.object(aggregators.board_employers, 'note'),
                      mock.patch('builtins.print')):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(lambda: setattr(feeds, 'PLACED', None) or setattr(feeds, 'TRIAGED', None) or setattr(feeds, 'READ', None))
        feeds.PLACED = feeds.TRIAGED = feeds.READ = None
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.execute('CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))')

    def late_search(self, name=None):
        """A search whose reader came back after the AI's stop: the title sort ran this run and had no time for these."""
        feeds.PLACED = feeds.TRIAGED = feeds.READ = None   # a new search: only what the stores kept
        with mock.patch.object(feeds, 'triage', lambda jobs: feeds._triaged().__setitem__(feeds.ASKED, True)), \
                title_queue.hub(), batch_scope.concurrent(), batch_scope.reader('job boards'):
            return aggregators.kept(self.db, name or aggregators.boards_ahead.NAME, board(), NOW)

    def test_a_board_read_too_late_to_judge_waits_and_the_queue_lists_its_jobs(self):
        self.assertEqual(self.late_search(), [], 'positive control: the search lists none of them, no title was judged in time')
        self.assertEqual(self.model.asked('titles') + self.model.asked('place asked'), [], 'and the search asked the model nothing')
        self.assertEqual(waiting_jobs.count(self.db, SEARCH), 3, 'all three wait: none is dropped')
        said = []
        checked, items = waiting_jobs.judge(self.db, SEARCH, NOW, out=said.append)
        self.assertEqual(len(self.model.asked('titles')), 3, 'the queue asked the three titles')
        self.assertTrue(self.model.asked('place asked'), 'and where the next town is')
        self.assertEqual((checked, sorted(item['location'] for item in items)), (3, ['Known town', 'Late town', 'Late town']))
        self.assertEqual({item['source'] for item in items}, {aggregators.boards_ahead.NAME}, 'listed under the reader that found them')
        self.assertEqual(waiting_jobs.count(self.db, SEARCH), 0, 'listed: off the waiting list')
        self.assertIn('3 listed', said[0])

    def test_a_reader_of_the_whole_world_keeps_only_the_jobs_in_the_persons_places(self):
        """A free job API lists the whole world: its unplaced towns are not kept waiting (hundreds of titles asked for nobody)."""
        self.late_search('Example jobs API')
        self.assertEqual([job['location'] for _, job in waiting_jobs.held(self.db, SEARCH)], ['Known town'])

    def test_without_an_ai_the_role_words_never_list_a_waiting_job(self):
        """#3924's first CI (tests/unit/sources/test_titles_ai_first.py): the queue kept by feeds.wanted_title, whose answer with no AI is the role words."""
        self.late_search()
        with mock.patch.object(feeds, 'placing', return_value=False), mock.patch.object(feeds, 'TITLES', feeds.keyword_regex(['known role'])):
            feeds._triaged().pop(feeds.ASKED, None)
            checked, items = waiting_jobs.judge(self.db, SEARCH, NOW, out=lambda line: None)
        self.assertEqual((checked, items), (3, []), 'a role word in the title, in the person\'s town, no AI answer: still waiting, not listed')

    def test_a_title_the_ai_refuses_leaves_the_list_and_is_not_listed(self):
        self.late_search()
        refuse = lambda titles, search, **kw: {title_triage._norm(title): title.startswith('Known') for title in titles}
        with mock.patch.object(title_triage, 'decide', refuse):
            _, items = waiting_jobs.judge(self.db, SEARCH, NOW)
        self.assertEqual([item['title'] for item in items], ['Known role 0'])
        self.assertEqual(waiting_jobs.count(self.db, SEARCH), 0, 'an answer of no is an answer: nothing waits')

    def test_a_job_the_ai_never_answers_for_waits_three_queues_then_is_dropped(self):
        self.late_search()
        with mock.patch.object(title_triage, 'decide', lambda titles, search, **kw: {}):   # no AI, a spent limit, the queue's own clock
            for left in (3, 3, 0):
                self.assertEqual(waiting_jobs.judge(self.db, SEARCH, NOW)[1], [], 'never listed on a guess')
                self.assertEqual(waiting_jobs.count(self.db, SEARCH), left)

    def test_a_job_that_names_no_town_is_listed_only_once_its_posting_says_where_it_is(self):
        """Tallinn proof, 12 Nov 2026: 8 jobs located only "Estonia" were listed by the queue and their postings then put none in the person's places."""
        self.late_search()
        with mock.patch.object(feeds, 'place_of', lambda job: 'vague' if job['location'] == 'Late town' else None), mock.patch.object(place_triage, 'read', return_value={}) as read:
            _, items = waiting_jobs.judge(self.db, SEARCH, NOW)
        self.assertEqual([item['location'] for item in items], ['Known town'], 'the two that name no town are not listed on a guess')
        self.assertEqual(read.call_count, 0, 'no posting text: nothing to read, they wait')
        self.assertEqual(waiting_jobs.count(self.db, SEARCH), 2)

    def test_a_changed_search_and_an_old_row_start_a_new_list(self):
        self.late_search()
        other = {**SEARCH, 'role_keywords': ['another role']}
        waiting_jobs.keep(self.db, aggregators.boards_ahead.NAME, board()[:1], NOW + timedelta(days=1), search=other)
        self.assertEqual((waiting_jobs.count(self.db, SEARCH), waiting_jobs.count(self.db, other)), (0, 1), "the old search's jobs were judged for other words")
        waiting_jobs.keep(self.db, aggregators.boards_ahead.NAME, board()[1:2], NOW + timedelta(days=waiting_jobs.DAYS + 2), search=other)
        self.assertEqual([job['title'] for _, job in waiting_jobs.held(self.db, other)], ['Late role 0'], 'a row older than DAYS is dropped unasked')


if __name__ == '__main__':
    unittest.main()
