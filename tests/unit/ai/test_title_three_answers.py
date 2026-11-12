"""The title sort answers in three groups: the person's own kind of work, a close neighbour of it, other work (owner, 12 Nov 2026: "Three answers, neighbours wait").
A neighbour is kept and scored like a fit title (True for every reader), is named in the search's NEAR list, is scored after the fit ones and is not in the
Jobs list before its score. Seen on one fictional data analyst: 75-90% of the listed jobs were other work, every one answered "fits" under "when unsure, include it"."""
import contextlib
import io
import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from src import time_budget
from src.ai import engine, title_triage
from src.press import rank

SEARCH = {'role_keywords': 'data analyst'}
TITLES = ['Data Analyst', 'Business Analyst', 'Investment Associate', 'Reporting Analyst', 'Analytics Engineer']


class Model:
    """Fit: a title with "analyst" but not "business"; near: "business" or "analytics"; the rest is other work."""
    def __init__(self, with_near=True):
        self.with_near = with_near
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        titles = [line.split('. ', 1)[1] for line in kwargs['messages'][0]['content'].split('The titles:\n', 1)[1].split('\n')]
        fit = [n for n, t in enumerate(titles, 1) if 'analyst' in t and 'business' not in t]
        near = [n for n, t in enumerate(titles, 1) if 'business' in t or 'analytics' in t]
        answer = {'fit': fit, 'near': near} if self.with_near else {'fit': fit}
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))

from src.sources import careers

_READER = careers.READER


def setUpModule():   # the guard in tests/unit/sources/test_found_boards_ai.py: no page read reaches a real model from this file
    careers.READER = None


def tearDownModule():
    careers.READER = _READER



class ThreeAnswersTest(unittest.TestCase):
    def setUp(self):
        self.data = pathlib.Path(tempfile.mkdtemp())
        (self.data / 'step_pace.json').write_text(json.dumps({'title_rounds': 1.0}))
        for patch in (mock.patch('src.paths.DATA', self.data), mock.patch.object(engine, 'PARALLEL', 4), mock.patch('time.monotonic', lambda: 10.0),
                      mock.patch.object(title_triage, 'STORE', self.data / 'title_triage.json')):
            patch.start()
            self.addCleanup(patch.stop)
        time_budget.start(180, now=0.0)
        self.addCleanup(lambda: setattr(time_budget, 'DEADLINE', None))

    def sort(self, model):
        with contextlib.redirect_stdout(io.StringIO()):
            return title_triage.decide(TITLES, SEARCH, client=model, local=True)

    def test_a_neighbour_is_kept_like_a_fit_title_and_named_apart(self):
        decided = self.sort(Model())
        self.assertEqual({t for t, fits in decided.items() if fits is True}, {'data analyst', 'reporting analyst', 'business analyst', 'analytics engineer'})
        self.assertIs(decided['investment associate'], False)
        self.assertEqual(title_triage.near(SEARCH), {'business analyst', 'analytics engineer'})
        self.assertEqual(set(title_triage.known(SEARCH)), set(decided), 'the NEAR list is no title of its own')

    def test_an_answer_without_the_near_group_names_no_neighbour(self):
        decided = self.sort(Model(with_near=False))
        self.assertIs(decided['data analyst'], True)
        self.assertIs(decided['business analyst'], False)
        self.assertEqual(title_triage.near(SEARCH), set())

    def test_the_neighbours_are_asked_again_under_another_instruction(self):
        self.sort(Model())
        with mock.patch.object(title_triage, 'PROMPT', 'another'):
            self.assertEqual(title_triage.near(SEARCH), set())

    def test_the_instruction_no_longer_says_include_when_unsure(self):
        self.assertNotIn('When unsure, include it', title_triage.SYSTEM)
        self.assertIn('`near`', title_triage.SYSTEM)
        self.assertEqual(sorted(title_triage.SCHEMA['properties']), ['fit', 'near'])

    def test_the_fit_ones_are_scored_before_their_neighbours(self):
        jobs = [{'title': 'Business Analyst'}, {'title': 'Data Analyst'}, {'title': 'Analytics Engineer'}, {'title': 'Reporting Analyst'}]
        near = {'business analyst', 'analytics engineer'}
        ordered = rank.jobs(jobs, rank.fit_before_neighbour(lambda job: job['title'].lower() in near))
        self.assertEqual([job['title'] for job in ordered], ['Data Analyst', 'Reporting Analyst', 'Business Analyst', 'Analytics Engineer'])


class ListTest(unittest.TestCase):
    def test_a_neighbour_is_not_in_the_jobs_list_before_its_score_and_is_once_scored(self):
        from src import desktop_jobs, store as job_store
        from src.ai import score
        from src import first_jobs
        report = {'jobs': [{'company': 'Example', 'id': str(i), 'title': title, 'location': 'Zurich', 'url': f'https://x.test/{i}', 'description': 'Dashboards and SQL.',
                            'status': 'new'} for i, title in enumerate(['Data Analyst', 'Business Analyst'])], 'sources': []}
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(pathlib.Path(tmp) / 'jobs.sqlite') as db, \
                mock.patch.object(desktop_jobs, '_neighbours', lambda: ({'business analyst'}, lambda title: ' '.join(str(title or '').lower().split()))):
            first_jobs.run(db, None, [{'company': 'Example', 'ats': 'greenhouse', 'slug': 'example'}], profile='Profile v1', hidden=frozenset(), sync=lambda: None,
                           say=lambda _: None, scan=lambda sources, feed_db, **kw: report, scorer=lambda *a, **kw: 0, model='m')
            listed = desktop_jobs.jobs(db, hide_unscored=False)
            self.assertEqual([job['title'] for job in listed['jobs']], ['Data Analyst'], 'the neighbour waits for its score')
            neighbour = next(job for job in __import__('src.digest', fromlist=['x']).eligible_jobs(db)[0] if job['title'] == 'Business Analyst')
            score.save(db, neighbour, 'm', {'score': 72, 'tier': 'B', 'reason': 'fits', 'components': {}, 'strengths': [], 'gaps': [], 'confidence': 'high'}, 'Profile v1')
            self.assertEqual(sorted(job['title'] for job in desktop_jobs.jobs(db, hide_unscored=False)['jobs']), ['Business Analyst', 'Data Analyst'])


if __name__ == '__main__':
    unittest.main()
