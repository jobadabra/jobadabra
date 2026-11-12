"""A job board's jobs one town from the person's city: the search notes the town and asks nothing; the queue after the search asks where it is; the next
search lists those jobs with no place call.
Why (sa, 12 Nov 2026, test person 9, area "lyon"): a board searched for Lyon listed 80 jobs, 24 naming Lyon and 56 in its neighbouring towns; over 20 searches
all 614 listed jobs named Lyon. Asked inside the search (3 tries), the question cost the boards their titles' time: src/sources/places_later.py says the numbers.
Offline: the place-call tests' own fake model (tests/unit/ai/test_titles_with_places.py), temp stores, example names only."""
import pathlib
import sqlite3
import tempfile
import unittest
from unittest import mock

from src import geo
from src.ai import batch_scope, engine, place_triage, title_queue, title_triage
from src.sources import aggregators, feeds, places_later
from tests.unit.ai.test_titles_with_places import Model

SEARCH = {'preferences': {'locations': {'best': ['Known town']}}}


def board():
    """A board's page for the city: one job naming it, two in the next town."""
    return [{'title': title, 'location': town, 'url': f'https://board.example.test/job/{n}', 'company': 'Example SARL', 'id': str(n), 'date_posted': '',
             'description': '', 'remote': False, 'salary': ''}
            for n, (title, town) in enumerate([('Known role 0', 'Known town'), ('Late role 0', 'Late town'), ('Late role 1', 'Late town')])]


class PlacesAskedAfterTheSearch(unittest.TestCase):
    def setUp(self):
        tmp = pathlib.Path(tempfile.mkdtemp())
        self.model = Model()
        self.model.gate.set()
        for patch in (mock.patch.object(place_triage, 'STORE', tmp / 'p.json'), mock.patch.object(title_triage, 'STORE', tmp / 't.json'),
                      mock.patch.object(geo, 'STORE', tmp / 'g.json'), mock.patch.object(places_later, 'STORE', tmp / 'later.json'),
                      mock.patch.object(engine, 'ready', return_value=True), mock.patch.object(engine, 'client', lambda **kw: self.model),
                      mock.patch.object(engine, 'PARALLEL', 4), mock.patch.object(feeds, '_SEARCH', SEARCH),
                      mock.patch.object(feeds, 'wanted_title', lambda title: True),
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

    def search(self, name=None):
        feeds.PLACED = feeds.TRIAGED = feeds.READ = None   # a new search: only what the stores kept
        with title_queue.hub(), batch_scope.concurrent(), batch_scope.reader('job boards'):
            return sorted(item['location'] for item in aggregators.kept(self.db, name or aggregators.boards_ahead.NAME, board()))

    def test_a_noted_town_is_asked_by_the_queue_and_the_next_search_lists_its_jobs(self):
        """The readers outside aggregators.kept (the web search, alerts, visits) note their towns; a board's own jobs wait whole in src/sources/waiting_jobs.py."""
        self.assertEqual(self.search(), ['Known town'], 'the search lists the city only')
        places_later.note(board())
        self.assertEqual(places_later.waiting(SEARCH), ['late town'], 'the town two of its jobs share waits; the known one does not')
        said = []
        self.assertEqual(places_later.ask(SEARCH, out=said.append), (1, 1))
        self.assertTrue(self.model.asked('place asked'), 'positive control: the queue asked the model where the town is')
        self.assertIn('1 are in your places', said[0])
        self.assertEqual(places_later.waiting(SEARCH), [], 'answered: off the list')
        asked = len(self.model.asked('place asked'))
        self.db.execute('DELETE FROM feed_jobs')
        self.assertEqual(self.search(), ['Known town', 'Late town', 'Late town'], "the next search lists the next town's jobs")
        self.assertEqual(len(self.model.asked('place asked')), asked, 'from the kept answer: no place call in that search')

    def test_a_title_the_ai_refused_and_a_place_already_decided_are_not_noted(self):
        with mock.patch.object(feeds, 'judged_title', lambda title: False if title == 'Late role 0' else None):
            places_later.note(board())
        self.assertEqual(places_later._load()[place_triage._key(SEARCH)], {'late town': 1}, 'one job in the town counts: the refused title does not, nor the city the words already hold')
        place_triage._keep(place_triage._key(SEARCH), {'late town': 'out'})
        feeds.PLACED = None
        places_later.STORE.unlink()
        places_later.note(board())
        self.assertEqual(places_later.waiting(SEARCH), [], 'a location the place store already answered is not asked again')

    def test_an_unanswered_location_stays_waiting(self):
        places_later.note(board())
        with mock.patch.object(place_triage, 'decide', lambda locations, search: {}):   # no AI, a spent limit, the queue's own clock
            self.assertEqual(places_later.ask(SEARCH), (0, 0))
        self.assertIn('late town', places_later.waiting(SEARCH))


if __name__ == '__main__':
    unittest.main()
