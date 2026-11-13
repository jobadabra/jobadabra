"""One count of "needs re-scoring": the dialog's number, the jobs the button queues, the jobs the run scores and the rows the list marks "Old score" are the
same jobs (13 Nov 2026, owner: "I get "Re-score 10" while the number was 2" and "I don't see at all any row saying that needs re scoring").
Played on the owner's store shape: 5 expired jobs keep a score from the previous scoring method (nothing lists, queues or scores an expired job), and
4 listed jobs have a score older than the Profile. Real store, real score queue, fake AI; the network is forbidden."""
import json
import os
import socket
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src import daily_helpers, desktop_strategy, store, time_budget
from src.ai import engine, score
from src.daily_args import build_parser
from src.daily_modes import rescore_mode
from src.stores import memory
from tests.unit.ai.test_score import fit
from tests.unit.ai.test_score_scope import EDITED, PROFILE, job_row


class Client:
    def __init__(self, answer=70):
        self.messages, self.titles, self.answer = self, [], answer

    def create(self, **params):
        self.titles.append(json.dumps(params['messages'][0]['content']))
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(fit(self.answer)))],
                               usage=SimpleNamespace(input_tokens=1, output_tokens=1, cache_read_input_tokens=0))


class StoreCase(unittest.TestCase):
    """The owner's-store harness (no tests of its own): a real store of 9 jobs, the Re-score run, a fake AI; other test files build on it."""
    answer = 70   # what the fake AI scores every job

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.stores = memory.open_store()
        self.stores.texts.set('profile', EDITED)   # the Profile changed since every score below
        self.client = Client(self.answer)
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
            store.import_watch_report(db, {'jobs': [job_row(n) for n in range(1, 10)]})
            self.jobs = sorted(store.digest_jobs(db, only_new=False), key=lambda job: int(job['title'].split()[-1]))
            for job in self.jobs:
                score.save(db, job, 'm', fit(80), score.scoring_profile(PROFILE))
            for job in self.jobs[4:]:   # jobs 5-9 went off the market: their old "Previous method" score stays in the store, as on the owner's
                db.execute("UPDATE jobs SET state='expired' WHERE id=?", (job['id'],))
                db.execute("UPDATE scores SET input_hash='', data_json=? WHERE job_id=?",
                           (json.dumps({**fit(80), 'method': score.PREVIOUS_METHOD}), job['id']))
            db.commit()

    def rows(self):
        return {'jobs': [{'id': None, 'url': job['url'], 'fit': 80, 'stage': ''} for job in self.jobs[:4]]}   # the Jobs list holds the listed (open) jobs only

    def run_mode(self):
        args = build_parser('test').parse_args(['--mode', 'rescore', '--score-max', '60', '--db', str(self.db_path)])
        return rescore_mode(args, self.stores)


class OneCountTests(StoreCase):
    def test_the_count_the_button_the_run_and_the_rows_are_the_same_jobs(self):
        with store.connect(self.db_path) as db:
            counted = desktop_strategy.outdated(db, {}, EDITED)['count']
            marked = sum(row['stale'] for row in desktop_strategy.mark_outdated(self.rows(), db, EDITED)['jobs'])
            queued = desktop_strategy.rescore_outdated(db, {}, EDITED)
        self.assertEqual((counted, queued, marked), (4, 4, 4), 'the dialog said the expired jobs too: nothing could ever re-score them')
        self.run_mode()
        self.assertEqual(len(self.client.titles), counted, 'the run scores exactly the jobs it was asked for')

    def test_after_the_run_nothing_is_left_to_re_score(self):
        with store.connect(self.db_path) as db:
            desktop_strategy.rescore_outdated(db, {}, EDITED)
        self.run_mode()
        with store.connect(self.db_path) as db:
            self.assertEqual(desktop_strategy.outdated(db, {}, EDITED)['count'], 0, 'Re-score must reach 0, not leave the expired jobs counted for ever')


if __name__ == '__main__':
    unittest.main()
