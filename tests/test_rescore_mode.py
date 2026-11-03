"""The Re-score run (mode rescore) gives a new score to the jobs that already have an old one and does nothing else: no crawl, no reading, no new job
(3 Nov 2026, owner via the coordinator: "if those jobs are already in the jobs list that the users sees, and we just need to rescore, then that should not
be handled by find jobs at all"). Played with a real store, the real score queue and a fake AI; the network is forbidden."""
import json
import os
import socket
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src import daily_helpers, store, time_budget
from src.ai import engine, score
from src.daily_args import build_parser
from src.daily_modes import rescore_mode
from src.stores import memory
from tests.test_score import fit
from tests.test_score_scope import EDITED, PROFILE, job_row


class Client:
    def __init__(self):
        self.messages, self.titles = self, []

    def create(self, **params):
        self.titles.append(json.dumps(params['messages'][0]['content']))
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(fit(70)))],
                               usage=SimpleNamespace(input_tokens=1, output_tokens=1, cache_read_input_tokens=0))


class RescoreModeTests(unittest.TestCase):
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
            store.import_watch_report(db, {'jobs': [job_row(n) for n in range(1, 5)]})
            self.jobs = list(store.digest_jobs(db, only_new=False))
            for job in self.jobs[:3]:   # jobs 1-3 are in the list with a score made from the first Profile; job 4 was found and never scored
                score.save(db, job, 'm', fit(80), score.scoring_profile(PROFILE))

    def run_mode(self, *extra):
        args = build_parser('test').parse_args(['--mode', 'rescore', '--score-max', '60', '--db', str(self.db_path), *extra])
        return rescore_mode(args, self.stores)

    def fits(self):
        with store.connect(self.db_path) as db:
            return {job['title']: (score.load(db).get(job['id']) or {}).get('score') for job in self.jobs}

    def test_the_mode_is_one_the_engine_accepts(self):
        self.assertIn('rescore', daily_helpers.MODES)

    def test_old_scores_are_replaced_and_a_never_scored_job_is_left_to_find_jobs(self):
        self.stores.texts.set('profile', EDITED)   # the Profile changed: jobs 1-3 are old scores
        self.assertEqual(self.run_mode(), 0)
        self.assertEqual(self.fits(), {'SRE 1': 70, 'SRE 2': 70, 'SRE 3': 70, 'SRE 4': None})
        self.assertEqual(len(self.client.titles), 3, 'one AI call per old score, none for the new job')

    def test_nothing_old_calls_no_ai(self):
        self.assertEqual(self.run_mode(), 0)
        self.assertEqual(self.client.titles, [])
        self.assertEqual(self.fits(), {'SRE 1': 80, 'SRE 2': 80, 'SRE 3': 80, 'SRE 4': None})

    def test_newly_read_facts_alone_are_not_re_scored(self):
        with store.connect(self.db_path) as db:   # the reading step ran after the scores on every search: facts exist, the Profile is unchanged
            from src.ai import enrich
            enrich.load(db)   # creates the table
            for job in self.jobs[:3]:
                enrich.save(db, job, 'claude-haiku-4-5', {'languages': [{'language': 'English', 'level': 'preferred'}]})
        self.assertEqual(self.run_mode(), 0)
        self.assertEqual(self.client.titles, [])

    def test_the_run_scores_at_most_score_max(self):
        self.stores.texts.set('profile', EDITED)
        self.run_mode()
        self.assertEqual(len(self.client.titles), 3)
        self.client.titles.clear()
        self.stores.texts.set('profile', EDITED + '- Terraform\n')
        self.assertEqual(self.run_cap(2), 2, 'the cap holds; the third stays old for the next Re-score')

    def run_cap(self, cap):
        args = build_parser('test').parse_args(['--mode', 'rescore', '--score-max', str(cap), '--db', str(self.db_path)])
        rescore_mode(args, self.stores)
        return len(self.client.titles)


if __name__ == '__main__':
    unittest.main()
