"""Ledger scenarios for past press fixes that had no test of their own (tests/unit/press/ledger.py names each one; ledger.lock.json locks its source).
A scenario plays the fix's own case on the real code with fakes for the network, the AI and the clock, and says which fix it guards."""
import unittest
from unittest import mock

from src import time_budget
from src.sources import feeds  # noqa: F401 -- imported before the search config is patched (it reads the search at import)

# Geo's kept answers for the fixture places (src/geo.py shape): Toulouse, a town in its own department, Paris.
GEO = {'toulouse': {'lat': 43.6047, 'lon': 1.4442}, 'muret, haute-garonne, france': {'lat': 43.4617, 'lon': 1.3267},
       'paris, france': {'lat': 48.8566, 'lon': 2.3522}}


class BestPlaceDistanceTest(unittest.TestCase):
    """L14 · #2918 (owner, 5 Nov 2026: "One clear order first"): a place word cannot tell Toulouse's own department from Paris when both are in the
    person's places; geo's kept answers can, so the job nearest the best place is scored, read and sorted first."""

    def setUp(self):
        for patch in (mock.patch('src.paths.load_search_config', return_value={'locations': {'top_tier': ['Toulouse']}, 'role_keywords': ['nurse']}),
                      mock.patch('src.sources.feeds.place_of', return_value='best'),   # both are in your places
                      mock.patch('src.geo.load', return_value=GEO)):
            patch.start()
            self.addCleanup(patch.stop)

    def test_l14_the_job_nearest_your_best_place_comes_first(self):
        paris = {'id': 1, 'title': 'Nurse', 'location': 'Paris, France'}
        muret = {'id': 2, 'title': 'Nurse', 'location': 'Muret, Haute-Garonne, France'}
        unplaced = {'id': 3, 'title': 'Nurse', 'location': 'Somewhere new'}
        self.assertEqual([job['id'] for job in time_budget.best_first([paris, unplaced, muret])], [2, 1, 3],
                         'Muret (~20 km from Toulouse) before Paris (~590 km); a location geo never placed keeps its place after them')


if __name__ == '__main__':
    unittest.main()
