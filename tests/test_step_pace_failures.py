"""A step's pace counts the time of calls that worked, not the time failed calls took (#3058, 3 Nov 2026: a tester's Find jobs said "scores 3 of 303
jobs (about 10.8 s each)" against a 3 s default while their key answered 401: score.py and enrich.py divided the whole batch's seconds, failed calls
included, by the successes). Both steps are played here with a fake clock: a success takes 2 s, a failure 10 s."""
import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src import store, time_budget
from src.ai import enrich, score
from tests.test_enrich import full, seed
from tests.test_score import fit

OK, BAD = 2.0, 10.0   # seconds a call that worked / failed takes on the fake clock
DEFAULT = time_budget.PACE   # the pace before this computer measured one


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class SlowClient:
    """Every call advances the clock; a title containing 'bad' fails (a 401 that retries before it gives up)."""
    def __init__(self, clock, answer):
        self.clock, self.answer, self.messages = clock, answer, self

    def create(self, **params):
        text = json.dumps(params['messages'][0]['content'])
        if 'bad' in text:
            self.clock.now += BAD
            raise RuntimeError('Error code: 401 - invalid x-api-key')
        self.clock.now += OK
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(self.answer))],
                               usage=SimpleNamespace(input_tokens=10, output_tokens=5, cache_read_input_tokens=0))


class PaceIgnoresFailedCallsTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        for patch in (mock.patch('src.paths.DATA', self.tmp), mock.patch.object(time, 'monotonic', self.clock)):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(time_budget.start, 0)
        time_budget.start(180, now=self.clock.now)   # a timed search: only these measure a pace

    def pace(self, step):
        return json.loads((self.tmp / 'step_pace.json').read_text())[step]

    def test_scoring_paces_the_calls_that_worked(self):
        with store.connect(self.tmp / 'jobs.sqlite') as db:
            store.import_watch_report(db, {'jobs': [{'company': 'Example', 'id': str(i), 'title': title, 'location': 'Zurich', 'url': f'https://x.test/{i}',
                                                     'description': 'Kubernetes.'} for i, title in enumerate(['SRE ok 1', 'SRE bad', 'SRE ok 2'])]})
            from src.daily_helpers import to_score
            stats = {}
            score.run(db, to_score(db, frozenset()), 'Profile v1', 'm', 50, client=SlowClient(self.clock, fit(70)), workers=1, stats=stats)
        self.assertEqual((stats['done'], stats['failed']), (2, 1))
        # 14 s of wall time, 4 of them in calls that worked: 2 s a score, smoothed with the default (3 s) to 2.5; the old division gave 7 s, 5.0
        self.assertEqual(self.pace('score'), round(0.5 * DEFAULT['score'] + 0.5 * OK, 2))

    def test_reading_paces_the_calls_that_worked(self):
        with store.connect(self.tmp / 'jobs.sqlite') as db:
            seed(db, [{'title': 'SRE ok 1'}, {'title': 'SRE bad'}, {'title': 'SRE ok 2'}])
            stats = {}
            enrich.run(db, 'claude-haiku-4-5', 50, client=SlowClient(self.clock, full()), workers=1, stats=stats)
        self.assertEqual((stats['done'], stats['failed']), (2, 1))
        self.assertEqual(self.pace('enrich'), round(0.5 * DEFAULT['enrich'] + 0.5 * OK, 2))

    def test_a_batch_where_every_call_failed_measures_nothing(self):
        time_budget.record('score', 30.0, 0, lost=1.0)
        self.assertFalse((self.tmp / 'step_pace.json').exists())

    def test_the_lost_share_is_taken_off_the_batch_seconds(self):
        time_budget.record('score', 14.0, 2, lost=10 / 14)
        self.assertEqual(self.pace('score'), round(0.5 * DEFAULT['score'] + 0.5 * 2.0, 2))


if __name__ == '__main__':
    unittest.main()
