"""Strategy's one "scored using previous search settings" notice (owner, 18 Oct 2026): every reason a score is outdated (an older scoring method,
other places for an active job) counted once per job, and one Re-score that queues each job once. Nothing is queued without that action."""
import json
import sqlite3
import unittest
from unittest import mock

from src import desktop_strategy
from src.ai import locations, score


def db_with(scores):
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    db.executescript(score.SCORES_TABLE)
    db.executemany('INSERT INTO scores VALUES (?, 1, ?, ?, ?, ?)', [(job_id, 'hash', 'm', '2026-10-01', json.dumps(data)) for job_id, data in scores.items()])
    db.commit()
    return db


NOW = {'locations': {'top_tier': ['zurich']}}
OLD = locations.fingerprint({'locations': {'top_tier': ['berlin']}})
SCORES = {1: {'method': score.PREVIOUS_METHOD, 'locations': OLD},   # both reasons: counted once
          2: {'method': score.CURRENT_METHOD, 'locations': OLD},    # other places, active
          3: {'method': score.PREVIOUS_METHOD},                     # older method only
          4: {'method': score.CURRENT_METHOD, 'locations': OLD},    # other places, but applied (not active): left as it is
          5: {'method': score.CURRENT_METHOD, 'locations': locations.fingerprint(NOW)}}


class OutdatedTests(unittest.TestCase):
    def setUp(self):
        patches = [mock.patch.object(locations, 'current', return_value=NOW), mock.patch.object(desktop_strategy, '_active_ids', return_value={1, 2, 3, 5})]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def test_each_job_counts_once_whatever_its_reasons(self):
        summary = desktop_strategy.outdated(db_with(SCORES), {})
        self.assertEqual(summary, {'count': 3, 'method': 2, 'places': 2, 'changed': 0})

    def test_nothing_outdated_says_zero(self):
        self.assertEqual(desktop_strategy.outdated(db_with({5: SCORES[5]}), {}), {'count': 0, 'method': 0, 'places': 0, 'changed': 0})

    def test_reading_the_count_queues_nothing(self):
        db = db_with(SCORES)
        desktop_strategy.outdated(db, {})
        self.assertEqual({row['input_hash'] for row in db.execute('SELECT input_hash FROM scores')}, {'hash'})

    def test_re_score_queues_each_outdated_job_once_and_nothing_else(self):
        db = db_with(SCORES)
        self.assertEqual(desktop_strategy.rescore_outdated(db, {}), 3)
        queued = {row['job_id'] for row in db.execute("SELECT job_id FROM scores WHERE input_hash=''")}
        self.assertEqual(queued, {1, 2, 3})


class ChangedSinceTheScoreTests(unittest.TestCase):
    """3 Nov 2026 (owner, via the coordinator): a job already in the list is re-scored only by Re-score, never by Find jobs, so a posting or Profile that
    changed since its score is an old score too: counted once with the other reasons, by the same function on Jobs and on Strategy."""
    PROFILE = '# Goals\n- SRE in Zurich\n# Skills\n- Kubernetes, Terraform, Python, incident response, observability\n'

    def setUp(self):
        for patch in (mock.patch.object(locations, 'current', return_value=NOW), mock.patch.object(desktop_strategy, '_active_ids', return_value={1, 2, 3, 5}),
                      mock.patch.object(desktop_strategy.digest, 'eligible_jobs', return_value=([{'id': 5, 'title': 'SRE', 'description': 'Kubernetes.'}], []))):
            patch.start()
            self.addCleanup(patch.stop)

    def test_a_scored_job_that_differs_from_its_score_counts_as_changed(self):
        self.assertEqual(desktop_strategy.outdated(db_with({5: SCORES[5]}), {}, self.PROFILE), {'count': 1, 'method': 0, 'places': 0, 'changed': 1})

    def test_without_a_profile_nothing_is_changed(self):
        self.assertEqual(desktop_strategy.outdated(db_with({5: SCORES[5]}), {}, None)['changed'], 0)

    def test_re_score_asks_again_for_every_old_job_the_changed_ones_too(self):
        db = db_with({**SCORES})
        self.assertEqual(desktop_strategy.rescore_outdated(db, {}, self.PROFILE), 4, 'jobs 1, 2, 3 and the changed 5')
        self.assertEqual({row['job_id'] for row in db.execute("SELECT job_id FROM scores WHERE input_hash=''")}, {1, 2, 3, 5},
                         'a changed low score is asked again too: no profile-only shortcut leaves the count where it was')

    def test_a_changed_job_with_an_application_is_not_counted(self):
        with mock.patch.object(desktop_strategy, '_active_ids', return_value={1, 2, 3}):   # job 5 has an application: Re-score skips it, so it is no old score
            self.assertEqual(desktop_strategy.outdated(db_with({5: SCORES[5]}), {'https://x/5': 'Applied'}, self.PROFILE)['changed'], 0)


class CommandTests(unittest.TestCase):
    def test_the_window_s_re_score_reaches_this_command(self):
        from pathlib import Path
        source = (Path(__file__).resolve().parents[3] / 'src' / 'desktop.py').read_text()
        self.assertIn("sub.add_parser('rescore-outdated')", source)
        self.assertIn("'rescore-outdated': _rescore_outdated", source)
        handlers = (Path(__file__).resolve().parents[3] / 'src' / 'desktop_tracker.py').read_text()
        self.assertIn("rescore_outdated(db, stages, profile_for_scores(tracker, stores))", handlers)


class JobsListKeepsTheOldFitsTests(unittest.TestCase):
    """Owner, 2 Nov 2026: "I don't think we should clear all the scoring instantly ... there should be the old scored." The Jobs read keeps every fit
    and marks the ones from the previous strategy; its count is Strategy's, from the same ids."""
    def setUp(self):
        for patch in (mock.patch.object(locations, 'current', return_value=NOW), mock.patch.object(desktop_strategy, '_active_ids', return_value={1, 2, 3, 5})):
            patch.start()
            self.addCleanup(patch.stop)

    def rows(self):
        # The shape a store's Jobs read really has: a url and a stage, and NO job id (src/desktop_jobs.py builds the row from the store's item): the first version matched on id and marked nothing.
        return {'jobs': [{'id': None, 'url': f'https://x.test/{job_id}', 'fit': 80 + job_id, 'stage': 'Applied' if job_id == 4 else ''} for job_id in SCORES]}

    def db(self):
        db = db_with(SCORES)
        db.execute('CREATE TABLE jobs (id INTEGER PRIMARY KEY, url TEXT)')
        db.executemany('INSERT INTO jobs VALUES (?, ?)', [(job_id, f'https://x.test/{job_id}') for job_id in SCORES])
        return db

    def test_every_fit_stays_and_the_outdated_ones_are_marked(self):
        result = desktop_strategy.mark_outdated(self.rows(), self.db())
        self.assertEqual({row['url']: row['fit'] for row in result['jobs']}, {f'https://x.test/{job_id}': 80 + job_id for job_id in SCORES})
        self.assertEqual({row['url'] for row in result['jobs'] if row['stale']}, {f'https://x.test/{job_id}' for job_id in (1, 2, 3)})

    def test_the_count_is_strategy_s_count(self):
        db = self.db()
        result = desktop_strategy.mark_outdated(self.rows(), db)
        self.assertEqual(result['outdated'], desktop_strategy.outdated(db, {'https://x.test/4': 'Applied'}))

    def test_a_strategy_save_that_queues_a_re_score_keeps_the_fits_visible(self):
        db = self.db()
        desktop_strategy.rescore_outdated(db, {})   # blanks input_hash only
        result = desktop_strategy.mark_outdated(self.rows(), db)
        self.assertEqual(sum(row['stale'] for row in result['jobs']), 3, 'queued for a new score, still marked until the new score replaces it')
        self.assertEqual(len(score.load(db)), len(SCORES), 'no stored fit was removed')


if __name__ == '__main__':
    unittest.main()
