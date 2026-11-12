"""The central scout's candidate probe asks the AI on one allowance of its own (src/ai/decide.py probe_allowance), so the feed pass that counts the known employers keeps the
rest of the run's calls (sk 4/5, 11 Nov 2026): a run's probe spent about half the relay's calls on careers-page reads for a few new sources, and the cap was gone minutes into the feed pass that counts the known
employers (numbers: jobadabra-lab#87). Fake AI only."""
import json
import sqlite3
import threading
import unittest
from contextlib import contextmanager
from types import SimpleNamespace
from unittest import mock

from src import scout_core, scout_run
from src.ai import decide, page_reader

PAGE = '<html><body><h1>Karriere</h1><a href="/jobs/1">Site Reliability Engineer</a></body></html>'


class FakeClient:
    def __init__(self):
        self.calls = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        text = kwargs['messages'][0]['content']
        if text.startswith('Careers page'):
            answer = {'page': 'jobs', 'jobs': [{'name': 'Site Reliability Engineer', 'place': 'Zürich', 'link': '/jobs/1', 'employer': ''}]}
        else:
            answer = {str(i): 'job_title' for i in range(text.count('### Item'))}
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(answer))], usage=None)


def ask(client, key):
    return decide.decide('title-kind', {key: key}, ['job_title', 'not_a_job'], 'is it a job title', client=client, db=sqlite3.connect(':memory:'))


class ProbeAllowance(unittest.TestCase):
    def setUp(self):
        decide.reset_run()
        page_reader._reads.clear()
        self.addCleanup(decide.reset_run)
        for patch in (mock.patch('src.ai.meanings_pack.first', return_value=None), mock.patch('src.ai.meanings_pack.queue'),
                      mock.patch('src.ai.engine.ready', return_value=True), mock.patch.object(decide, 'MODEL', 'fake')):
            patch.start()
            self.addCleanup(patch.stop)

    def test_the_probe_stops_asking_when_its_pool_is_spent_and_the_run_s_cap_is_untouched(self):
        client = FakeClient()
        with decide.probe_allowance(2):
            for key in ('alpha', 'beta', 'gamma'):
                ask(client, key)
        self.assertEqual(len(client.calls), 2, 'the third ask waits for the next run: unknown, never guessed')
        self.assertEqual(decide._calls['n'], 0, 'the probe never spends the calls the feed pass counts on')
        ask(client, 'delta')
        self.assertEqual((len(client.calls), decide._calls['n']), (3, 1), 'outside the probe the run asks as before')

    def test_probe_spent_tells_how_many_of_the_pool_a_run_used(self):
        client = FakeClient()
        self.assertEqual(decide.probe_spent(), 0)
        with decide.probe_allowance(3):
            for key in ('alpha', 'beta', 'gamma', 'delta'):
                ask(client, key)
        self.assertEqual((decide.probe_spent(), len(client.calls)), (3, 3), 'the line the scout prints: 3 of the 3 calls used, the 4th waited')

    def test_the_page_reader_counts_a_probe_check_s_reads_on_the_same_allowance(self):
        client = FakeClient()
        with mock.patch.object(scout_core, 'CENTRAL', True), mock.patch.object(page_reader, 'wanted_text', lambda: page_reader.careers.ats.re.compile('reliability', 2)):
            db = sqlite3.connect(':memory:')
            db.execute('CREATE TABLE page_reads (url TEXT PRIMARY KEY, digest TEXT NOT NULL, jobs_json TEXT NOT NULL, read_at TEXT NOT NULL)')
            with decide.probe_allowance(2):
                ask(client, 'alpha')
                self.assertTrue(page_reader.read('https://acme.ch/karriere', PAGE, client, db))
                self.assertIsNone(page_reader.read('https://other.ch/karriere', PAGE + ' ', client, db), 'one ask and one read used the allowance of 2')
            self.assertEqual(len(client.calls), 2)
            self.assertEqual(page_reader._reads, {}, "the run's own reads are not spent by the probe")

    def test_one_thread_s_allowance_is_not_another_thread_s(self):
        client = FakeClient()
        asked = []
        with decide.probe_allowance(0):
            worker = threading.Thread(target=lambda: asked.append(ask(client, 'alpha')))
            worker.start()
            worker.join()
            ask(client, 'beta')
        self.assertEqual(len(client.calls), 1, 'the thread with no allowance asked; the probe thread (allowance 0) did not')

    def test_threads_drawing_one_pool_never_overshoot_it(self):
        client = FakeClient()

        def worker(index):
            with decide.probe_allowance(5):
                for n in range(10):
                    ask(client, f'key-{index}-{n}')
        workers = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
        for thread in workers:
            thread.start()
        for thread in workers:
            thread.join()
        self.assertEqual(len(client.calls), 5, 'the pool of 5 is shared by every probe thread, and spent exactly')

    def test_no_allowance_changes_nothing(self):
        client = FakeClient()
        with decide.probe_allowance(None):
            ask(client, 'alpha')
        self.assertEqual((len(client.calls), decide._calls['n'], decide.probe_take()), (1, 1, None))

    def test_only_the_central_scout_s_probe_checks_run_on_the_allowance(self):
        seen = []

        @contextmanager
        def record(n):
            seen.append(n)
            yield
        scout = SimpleNamespace(PROGRESS_LOCK=threading.Lock(), progress_line=lambda line: None)
        for central in (True, False):
            with mock.patch.object(scout_core, 'CENTRAL', central), mock.patch.object(decide, 'probe_allowance', record):
                check, _, _ = scout_run.make_checks(scout, lambda: 1, None, set(), None, None)
                check({'status': 'manual', 'name': 'x'})
        self.assertEqual(seen, [decide.CENTRAL_PROBE_CALLS, None])


if __name__ == '__main__':
    unittest.main()
