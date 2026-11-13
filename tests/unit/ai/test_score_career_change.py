"""A search in another field than the CV: the scorer is told the search and its answer carries the search part (owner, 26 Oct 2026: "Show them,
flag the gap"; src/ai/score_search.py); the ring stays the scorer's own score (13 Nov 2026; tests/unit/ai/test_score_realistic_ring.py). His pilot
search found 13 First Officer jobs, scored against a software CV. Universal: any career change. Fake model (it can judge the search only when the
request carries it)."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src import digest, store as job_store
from src.ai import score, score_search

SEARCH = {'target_roles': ['pilot first officer'], 'role_keywords': ['pilot first officer']}
CV = 'Software developer: Python, Kubernetes, 8 years building web services in Chisinau.'
GAP = 'No pilot licence or flight hours on the profile'


class FakeModel:
    """Scores like the real one: a pilot job against a software CV is 15; told the search (and asked for its part), it also rates the search."""
    def __init__(self, career_change=True, search_fit=88, cv_fit=15):
        self.career_change, self.search_fit, self.cv_fit, self.requests = career_change, search_fit, cv_fit, []
        self.messages = self

    def create(self, **params):
        self.requests.append(params)
        told = 'pilot first officer' in params['system'][0]['text']
        asked = 'search' in params['output_config']['format']['schema']['properties']
        data = {'score': self.cv_fit, 'tier': 'C', 'reason': 'Unrelated role: Pilot vs software developer',
                'components': {'role_fit': self.cv_fit, 'location': 80, 'compensation': None, 'growth': None, 'risk': 60},
                'basis': {'salary_stated': False, 'level_stated': True, 'one_job': True},
                'strengths': [], 'gaps': ['no flying experience'], 'confidence': 'high'}
        if told and asked:
            data['search'] = {'fit': self.search_fit, 'career_change': self.career_change, 'cv_gap': GAP if self.career_change else ''}
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(data))],
                               usage=SimpleNamespace(input_tokens=1, output_tokens=1, cache_read_input_tokens=0))


def seed(db, count=13):
    job_store.import_watch_report(db, {'jobs': [
        {'company': f'Example Air {i}', 'id': str(i), 'title': f'First Officer A320 {i}', 'location': 'Vienna, Austria',
         'url': f'https://crew.test/job/{i}', 'description': 'First Officer on the A320 fleet: valid EASA ATPL, type rating, 500 hours.'}
        for i in range(count)]})


class CareerChange(unittest.TestCase):
    def setUp(self):
        for patch in (mock.patch('src.paths.load_search_config', return_value=SEARCH), mock.patch('src.ai.locations.block_now', return_value=''),
                      mock.patch('src.ai.hints.load', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.db = job_store.connect(Path(tmp.name) / 'jobs.sqlite').__enter__()
        self.addCleanup(self.db.close)
        seed(self.db)

    def scored(self, model):
        candidates, _ = digest.eligible_jobs(self.db)
        score.run(self.db, candidates, CV, 'm', 20, client=model)
        return score.load(self.db)

    def test_the_scorer_is_told_the_search_and_its_part_is_kept(self):
        model = FakeModel()
        fits = self.scored(model)
        self.assertIn('pilot first officer', model.requests[0]['system'][0]['text'], 'the scorer is told the search')
        one = next(iter(fits.values()))
        self.assertEqual((one['search']['fit'], one['search']['career_change'], one['search']['cv_gap']), (88, True, GAP))

    def test_the_same_field_keeps_its_fit_to_the_cv(self):
        fits = self.scored(FakeModel(career_change=False, search_fit=90, cv_fit=60))
        self.assertEqual({data['score'] for data in fits.values()}, {60}, 'not a career change: the CV fit (place, pay, skills) stands')

    def test_an_answer_without_the_search_part_is_never_asked_again(self):
        data = score_search.apply({'score': 15, 'tier': 'C'})
        self.assertEqual(data['search'], {})
        self.assertEqual(data['score'], 15)


if __name__ == '__main__':
    unittest.main()
