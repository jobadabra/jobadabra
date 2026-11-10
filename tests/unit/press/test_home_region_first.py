"""#3670 (High): a Find jobs run scores jobs outside the person's city while jobs in it wait. Plays run 42731674115, persona p9 (Electrician, Lyon): 144 EURES
jobs, 36 of them in commuting reach of Lyon (21 in Rhône); the run scored 7 (3 by the first-jobs slice, 4 by the scorer beside it) and none was in Rhône.
At 66 s, when its title batches were picked, and at 92 s, when its scores were, the map knew Lyon (eures.regions places the person's words at second 0)
but no EURES area: those were placed by AI calls answered at 81 s and 113 s. The order must hold with only what is known when the jobs are read.
Fixture: tests/fixtures/press/w2-lyon-p9-eures.json (public postings, no company or person)."""
import json
import unittest
from pathlib import Path
from unittest import mock

from src import time_budget
from src.sources import feeds  # noqa: F401 -- imported before the search config is patched (it reads the search at import)

FIXTURE = json.loads((Path(__file__).resolve().parents[2] / 'fixtures' / 'press' / 'w2-lyon-p9-eures.json').read_text())
SEARCH = {'locations': {'top_tier': ['Lyon']}, 'role_keywords': ['électricien']}
MAP_AT_66_S = {'lyon': {'kind': 'city', 'cc': 'FR', 'lat': 45.764, 'lon': 4.8357, 'r_km': 30}}   # the person's city only
SCORED = 7   # what the run scored


def jobs():
    return [{'id': n, 'title': title, 'location': location, 'right': right} for n, (title, location, right) in enumerate(FIXTURE['jobs'])]


class HomeRegionFirstTest(unittest.TestCase):

    def setUp(self):
        for patch in (mock.patch('src.paths.load_search_config', return_value=SEARCH),
                      mock.patch('src.sources.feeds.place_of', return_value=None),   # no place answer yet
                      mock.patch('src.geo.load', return_value=MAP_AT_66_S)):
            patch.start()
            self.addCleanup(patch.stop)

    def test_the_jobs_scored_first_are_in_the_persons_city(self):
        first = time_budget.best_first(jobs())[:SCORED]
        right = sum(job['right'] for job in first)
        self.assertGreaterEqual(right / SCORED, 0.7, f'{right} of the first {SCORED} in reach of Lyon: ' + ', '.join(job['location'] for job in first))

    def test_the_title_batches_asked_first_hold_the_persons_city(self):
        from src.sources import feed_order
        from src.ai.title_triage import _norm
        asked = jobs()
        near = feed_order.nearness(asked, SEARCH, lambda job: False)
        titles = sorted(dict.fromkeys(_norm(job['title']) for job in asked), key=near)
        right_titles = {_norm(job['title']) for job in asked if job['right']}
        first = titles[:5]
        self.assertTrue(all(title in right_titles for title in first), f'the 5 titles asked first: {first}')


if __name__ == '__main__':
    unittest.main()
