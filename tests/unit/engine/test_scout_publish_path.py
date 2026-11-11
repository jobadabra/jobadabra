"""The central scout's publish path end to end with every network piece replaced (seconds, no CI run): the checks, the board pass, the publish.
Why: 24 Oct 2026 the board pass was merged without ever running its path; CI showed it silently skipped (the checks used all the time) and a first fix
used a name before its import. This drives scout.main's --publish-index branch, so both would have failed here. Skill: check-central-scout-locally."""
import contextlib
import io
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from src import scout, scout_boards, scout_carry, scout_core, scout_overrun, trial
from src.ai import cost


class PublishPathTest(unittest.TestCase):
    def run_main(self, board_run, seed=lambda *a, **k: 0, flags=()):
        feed = {'company': 'Acme', 'ats': 'greenhouse', 'slug': 'acme', 'countries': ['ch'], 'jobs': 3}
        seen = self.seen = {}

        def build_index(db, sources, **kwargs):
            seen['check_deadline'] = kwargs['deadline']
            return [feed], []
        patches = [mock.patch.dict(os.environ, {'INDEX_PUBLISH_KEY': 'k', 'JOBADABRA_INDEX_URL': 'http://127.0.0.1:1/api/index',
                                             'JOB_STARTED_AT': str(int(time.time()) - 20 * 60)}),   # the job began 20 min ago: the publish deadline is near, as in a slow run
                   mock.patch.object(scout, 'employer_store', lambda: None), mock.patch.object(scout, 'synced_key', lambda stores: False), mock.patch.object(trial, 'pause_run', lambda *a, **k: False),
                   mock.patch.object(scout, 'run', lambda *a, **k: ({}, [])), mock.patch.object(scout, 'telegram_summary', lambda *a, **k: 'summary'),
                   mock.patch.object(scout, 'fetch_contributions', lambda *a, **k: ([], {})),
                   mock.patch.object(scout.employer_index, 'fresh_nofeed', lambda dead: {}),
                   mock.patch.object(scout, 'build_index', build_index), mock.patch.object(scout_carry, 'seed', seed),
                   mock.patch.object(scout, 'market_coverage', lambda *a, **k: []),
                   mock.patch.object(scout, 'central_stats', lambda *a, **k: {'market': []}),
                   mock.patch.object(scout, 'fetch_boards', lambda *a, **k: []), mock.patch.object(scout, 'board_stats', lambda *a, **k: []),
                   mock.patch.object(scout, 'publish_index', lambda feeds, *a, **k: seen.setdefault('board_facts', k.get('board_facts')) or len(feeds)),
                   mock.patch.object(scout, 'publish_summary', lambda *a, **k: 'summary'), mock.patch.object(scout, 'dead_ends', lambda *a, **k: []),
                   mock.patch.object(scout, 'run_record', lambda *a, **k: {}),
                   mock.patch.object(scout_boards, 'run', board_run),
                   mock.patch.object(scout_overrun, 'arm', lambda *a, **k: None)]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(setattr, scout_core, 'CENTRAL', scout_core.CENTRAL)
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(sys, 'argv', ['scout', '--batch', '1', '--publish-index', *flags, '--db', str(Path(tmp) / 'jobs.sqlite')]):
            scout.main()
        return seen

    def test_an_empty_cache_and_an_unread_index_publish_nothing(self):
        """#2915: the real seed on an empty store, its index out of reach (127.0.0.1:1): no feed is checked and nothing goes up."""
        with self.assertRaises(SystemExit) as stopped, contextlib.redirect_stdout(io.StringIO()):
            self.run_main(lambda db, **kwargs: self.fail('the board pass ran'), seed=scout_carry.seed)
        self.assertTrue(stopped.exception.code, 'the job must end red, so the owner is told')
        self.assertEqual(self.seen, {}, 'neither the checks nor the publish ran')

    def test_the_calls_by_topic_are_in_the_log_even_when_a_stuck_check_ends_the_process(self):
        """Why (#2915): a stuck check leaves through os._exit, which skips atexit; decide's own line never reached a central run's log."""
        out, at_the_leave = io.StringIO(), []
        leave = mock.patch.object(scout_overrun, 'leave_if_stuck', lambda: at_the_leave.append(out.getvalue()))
        with mock.patch.dict(cost.TOPICS, {'geo': 3}, clear=True), leave, contextlib.redirect_stdout(out):
            self.run_main(lambda db, **kwargs: [])
        self.assertEqual(len(at_the_leave), 1, 'the run reached the leave')
        self.assertIn('AI calls by topic: geo 3', at_the_leave[0])

    def test_the_run_reaches_the_publish_and_gives_the_board_pass_its_time(self):
        calls = []
        seen = self.run_main(lambda db, **kwargs: calls.append(kwargs) or [])
        self.assertEqual(len(calls), 1, 'the board pass ran once')
        self.assertLessEqual(seen['check_deadline'], calls[0]['until'] - scout_boards.RESERVE_S + 1,
                             'the feed checks end RESERVE_S before the pass must have started')

    def test_a_trial_run_does_everything_but_upload_the_index(self):
        """Why (sk, 11 Nov 2026): a by-hand trial of an unmerged branch (lab central-scout.yml engine_ref) reads the live index and must never write it. Guard: data."""
        calls, out = [], io.StringIO()
        with contextlib.redirect_stdout(out):
            trial_seen = self.run_main(lambda db, **kwargs: calls.append(kwargs) or [], flags=['--no-upload'])
        self.assertEqual(len(calls), 1, 'the board pass ran as in a real run')
        self.assertIn('check_deadline', trial_seen, 'the feeds were checked as in a real run')
        self.assertNotIn('board_facts', trial_seen, 'publish_index was never called')
        self.assertIn('nothing was uploaded', out.getvalue())

    def test_without_the_flag_the_index_is_published(self):
        self.assertIn('board_facts', self.run_main(lambda db, **kwargs: []))


if __name__ == '__main__':
    unittest.main()
