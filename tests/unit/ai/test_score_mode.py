"""The scoring queue (mode score) scores the jobs Find jobs found and had no time to score, best first, and does nothing else: no crawl, no new job, no
old score replaced (owner, 11 Nov 2026, asked via AskUserQuestion: "After the run, own queue (Recommended)"; "Keep 60, rest show 'Score' (Recommended)").
Played with a real store, the real score queue and a fake AI; the network is forbidden."""
import contextlib
import io
import json
import os
import socket
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import daily_helpers, store, time_budget
from src.ai import engine, score
from src.daily_args import build_parser
from src.daily_modes import score_mode
from src.notion.client import job_code
from src.stores import memory
from tests.unit.ai.test_rescore_mode import Client
from tests.unit.ai.test_score import fit
from tests.unit.ai.test_score_scope import PROFILE, job_row


class ScoreModeTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.stores = memory.open_store()
        self.stores.texts.set('profile', PROFILE)
        self.client = Client()
        self.addCleanup(time_budget.start, 0)
        time_budget.start(0)
        for patch in (mock.patch.dict(os.environ, {'JOBADABRA_DATA_DIR': str(self.root), 'JOBADABRA_CONFIG_DIR': str(self.root)}),
                      mock.patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')),
                      mock.patch.object(engine, 'client', return_value=self.client), mock.patch.object(engine, 'ready', return_value=True),
                      mock.patch.object(daily_helpers, 'REPORTS', self.root), mock.patch('src.paths.local_profile', return_value=None)):
            patch.start()
            self.addCleanup(patch.stop)
        self.db_path = self.root / 'jobs.sqlite'
        with store.connect(self.db_path) as db:
            store.import_watch_report(db, {'jobs': [job_row(n) for n in range(1, 8)]})
            self.jobs = sorted(store.digest_jobs(db, only_new=False), key=lambda job: job['title'])   # the store's order is not promised
            score.save(db, self.jobs[0], 'm', fit(80), score.scoring_profile(PROFILE))   # SRE 1 has its score; SRE 2-7 were found and never scored

    def run_mode(self, cap=60):
        args = build_parser('test').parse_args(['--mode', 'score', '--score-max', str(cap), '--db', str(self.db_path)])
        said = io.StringIO()
        with contextlib.redirect_stdout(said):
            code = score_mode(args, self.stores)
        return code, said.getvalue().splitlines()

    def fits(self):
        with store.connect(self.db_path) as db:
            return {job['title']: (score.load(db).get(job['id']) or {}).get('score') for job in self.jobs}

    def test_the_mode_is_one_the_engine_accepts(self):
        self.assertIn('score', daily_helpers.MODES)

    def test_found_jobs_get_their_score_and_a_scored_job_is_left_alone(self):
        code, _ = self.run_mode()
        self.assertEqual(code, 0)
        self.assertEqual(self.fits(), {'SRE 1': 80, **{f'SRE {n}': 70 for n in range(2, 8)}})
        self.assertEqual(len(self.client.titles), 6, 'one AI call per found job, none for the job that has a score')

    def test_the_ceiling_holds_and_the_rest_wait(self):
        _, lines = self.run_mode(cap=2)
        self.assertEqual(len(self.client.titles), 2)
        self.assertEqual(sum(1 for value in self.fits().values() if value is None), 4, 'the four past the ceiling stay listed, unscored')
        told = json.loads(next(line for line in lines if line.startswith('Score queue: '))[len('Score queue: '):])
        self.assertEqual((len(told['queue']), told['left']), (2, 4), 'the app is told who is in the queue and how many are past it')

    def test_the_app_is_told_the_queue_in_order_and_who_is_scored_now(self):
        _, lines = self.run_mode()
        told = json.loads(next(line for line in lines if line.startswith('Score queue: '))[len('Score queue: '):])
        codes = {job_code(job['url']) for job in self.jobs[1:]}
        self.assertEqual(set(told['queue']), codes)
        now = [code for line in lines if line.startswith('Scoring now: ') for code in line[len('Scoring now: '):].split(',')]
        self.assertEqual(now, told['queue'], 'every queued job is announced once, in the queue\'s own order, before its score is asked')

    def test_nothing_waiting_calls_no_ai(self):
        self.run_mode()
        self.client.titles.clear()
        code, lines = self.run_mode()
        self.assertEqual((code, self.client.titles), (0, []))
        self.assertEqual(json.loads(next(line for line in lines if line.startswith('Score queue: '))[len('Score queue: '):]), {'queue': [], 'left': 0})


if __name__ == '__main__':
    unittest.main()
