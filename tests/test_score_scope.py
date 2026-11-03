"""Find jobs scores only jobs that were never scored; a job already in the list is re-scored only by the Re-score action (3 Nov 2026, owner via the
coordinator: "we don't want to refresh current jobs ... that is not the priority. If the jobs in the backlog means jobs that are not currently displayed in
the jobs list, then all of it first" and "if those jobs are already in the jobs list that the users sees, and we just need to rescore, then that should not
be handled by find jobs at all"). Played here with a real store and the real queue: a never-scored job, a job whose posting text changed, one whose Profile
changed, one whose facts were read after its score, and one the person asked to redo."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from src import store
from src.ai import score, score_old
from tests.test_score import fit

PROFILE = '# Goals\n- SRE in Zurich, Kubernetes\n# Skills\n- Kubernetes, Terraform, Python, incident response, observability\n'
EDITED = PROFILE + '- Go\n'


def job_row(n, **extra):
    return {'company': 'Example', 'id': str(n), 'title': f'SRE {n}', 'location': 'Zurich', 'url': f'https://x.test/{n}', 'description': 'Kubernetes.', **extra}


class ScopeTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.db = store.connect(Path(tmp.name) / 'jobs.sqlite')
        self.addCleanup(self.db.close)
        store.import_watch_report(self.db, {'jobs': [job_row(n) for n in range(1, 7)]})
        self.jobs = {job['title']: job for job in store.digest_jobs(self.db, only_new=False)}
        self.new, self.text, self.profile, self.facts, self.asked, self.current = (self.jobs[f'SRE {n}'] for n in range(1, 7))
        for job in (self.text, self.profile, self.facts, self.asked, self.current):
            score.save(self.db, job, 'm', fit(80), score.scoring_profile(PROFILE))
        # job 2: its posting text changed after the score; job 4: facts were read after the score; job 5: the person asked for a new score
        self.text['description'] = 'Kubernetes and Go, a rewritten posting.'
        self.facts['ai'] = {'languages': ['English']}
        self.db.execute("UPDATE scores SET input_hash='' WHERE job_id=?", (self.asked['id'],))
        self.all = [self.new, self.text, self.profile, self.facts, self.asked, self.current]

    def ids(self, scope, profile=PROFILE):
        return {job['title'] for job in score.queue(self.db, self.all, profile, scope=scope)}

    def test_find_jobs_queue_holds_only_the_job_that_was_never_scored(self):
        self.assertEqual(self.ids('new'), {'SRE 1'})

    def test_a_profile_edit_text_change_and_asked_redo_are_not_find_jobs_to_score(self):
        self.assertEqual(self.ids('new', EDITED), {'SRE 1'}, 'the Profile was edited: every scored job differs, none is queued for Find jobs')

    def test_the_re_score_queue_holds_every_scored_job_that_needs_a_new_score_and_never_a_new_one(self):
        self.assertEqual(self.ids('old'), {'SRE 2', 'SRE 4', 'SRE 5'}, 'a changed text, newly read facts (the score hash includes them), an asked redo')
        self.assertEqual(self.ids('old', EDITED), {'SRE 2', 'SRE 3', 'SRE 4', 'SRE 5', 'SRE 6'}, 'a Profile edit makes every scored job old')

    def test_the_default_scope_is_both_for_older_callers(self):
        self.assertEqual(self.ids('all'), {'SRE 1', 'SRE 2', 'SRE 4', 'SRE 5'})

    def test_the_find_jobs_queue_changes_no_scored_row_and_asks_no_ai(self):
        before = [tuple(row) for row in self.db.execute('SELECT * FROM scores ORDER BY job_id')]
        from unittest import mock
        with mock.patch('src.sources.feeds.triage', side_effect=AssertionError('a title sort is an AI call')):
            self.ids('new', EDITED)
        self.assertEqual([tuple(row) for row in self.db.execute('SELECT * FROM scores ORDER BY job_id')], before)

    def test_running_the_find_jobs_scope_scores_the_new_job_and_leaves_the_others_with_their_scores(self):
        calls = []

        class Client:
            messages = SimpleNamespace()

            def __init__(self):
                self.messages = self

            def create(self, **params):
                calls.append(json.dumps(params['messages'][0]['content']))
                return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(fit(70)))],
                                       usage=SimpleNamespace(input_tokens=1, output_tokens=1, cache_read_input_tokens=0))

        stats = {}
        score.run(self.db, self.all, EDITED, 'm', 50, client=Client(), workers=1, stats=stats, scope='new')
        self.assertEqual((stats['done'], len(calls)), (1, 1), 'one AI call: the never-scored job')
        fits = score.load(self.db)
        self.assertEqual(fits[self.new['id']]['score'], 70)
        self.assertEqual([fits[job['id']]['score'] for job in (self.text, self.profile, self.facts, self.asked, self.current)], [80] * 5, 'shown jobs keep their scores')


class OldIdsTests(unittest.TestCase):
    """The Jobs list and Strategy's notice count the jobs a Re-score would update, without an AI call or a write."""
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.db = store.connect(Path(tmp.name) / 'jobs.sqlite')
        self.addCleanup(self.db.close)
        store.import_watch_report(self.db, {'jobs': [job_row(n) for n in range(1, 5)]})
        self.jobs = list(store.digest_jobs(self.db, only_new=False))
        for job in self.jobs[:3]:
            score.save(self.db, job, 'm', fit(80), score.scoring_profile(PROFILE))

    def test_a_profile_edit_makes_the_scored_jobs_old_and_a_never_scored_job_is_not_listed(self):
        self.assertEqual(score_old.old_ids(self.db, self.jobs, PROFILE), set())
        self.assertEqual(score_old.old_ids(self.db, self.jobs, EDITED), {job['id'] for job in self.jobs[:3]})

    def test_facts_read_after_the_score_do_not_make_it_old(self):
        for job in self.jobs:
            job['ai'] = {'languages': ['English']}   # the reading step ran after scoring, on every search
        self.assertEqual(score_old.old_ids(self.db, self.jobs, PROFILE), set())

    def test_a_form_only_profile_edit_makes_nothing_old(self):
        self.assertEqual(score_old.old_ids(self.db, self.jobs, PROFILE + '# Contact\n- Phone: 123\n'), set())

    def test_no_profile_says_nothing_is_old(self):
        self.assertEqual(score_old.old_ids(self.db, self.jobs, ''), set())

    def test_reading_writes_nothing(self):
        before = [tuple(row) for row in self.db.execute('SELECT * FROM scores')]
        score_old.old_ids(self.db, self.jobs, EDITED)
        self.assertEqual([tuple(row) for row in self.db.execute('SELECT * FROM scores')], before)


if __name__ == '__main__':
    unittest.main()
