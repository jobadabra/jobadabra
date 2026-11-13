"""A score made before the current scoring rules is an old score (13 Nov 2026, owner, asked via AskUserQuestion: "Re-score scores made before a rule change
(Recommended)"): the pilot jobs scored 28 Oct to 4 Nov (70 to 85) were made before the licence cap of 7 Nov (#3357, #3361: a required licence the profile lacks
caps the fit at 49), and nothing marked them, because the rules' version (score.SCORER_VERSION) was never raised when the rules changed.
Played with a real store, the real score queue and a fake AI that answers the capped fit; the network is forbidden."""
from src import desktop_strategy, store
from src.ai import score
from tests.unit.ai.test_rescore_one_count import PROFILE, StoreCase, fit

RULES_BEFORE_THE_LICENCE_CAP = 2   # score.SCORER_VERSION from 24 Sep to 7 Nov 2026: the stamp every pilot score of the owner's carries


class ScoresFromOlderRulesTests(StoreCase):
    answer = 45   # the capped fit the AI gives a job that needs a licence the profile lacks

    def setUp(self):
        super().setUp()
        self.stores.texts.set('profile', PROFILE)   # the Profile did not change: the rules are the only reason
        with store.connect(self.db_path) as db:
            db.execute("UPDATE jobs SET state='open'")
            for job in self.jobs:   # every job listed, scored from this Profile, stamped with the rules of the owner's pilot scores
                score.save(db, job, 'm', fit(85), score.scoring_profile(PROFILE))
            db.execute('UPDATE scores SET scorer_version=?', (RULES_BEFORE_THE_LICENCE_CAP,))
            db.commit()

    def rows(self):
        return {'jobs': [{'id': None, 'url': job['url'], 'fit': 85, 'stage': ''} for job in self.jobs]}

    def test_a_score_from_the_rules_before_the_cap_is_counted_queued_marked_and_re_scored(self):
        total = len(self.jobs)
        with store.connect(self.db_path) as db:
            counted = desktop_strategy.outdated(db, {}, PROFILE)['count']
            marked = sum(row['stale'] for row in desktop_strategy.mark_outdated(self.rows(), db, PROFILE)['jobs'])
            queued = desktop_strategy.rescore_outdated(db, {}, PROFILE)
        self.assertEqual((counted, queued, marked), (total, total, total), 'the rules changed since these scores: each one is an old score')
        self.run_mode()
        self.assertEqual(len(self.client.titles), total, 'the run scored each of them again')
        with store.connect(self.db_path) as db:
            self.assertEqual({row['scorer_version'] for row in db.execute('SELECT scorer_version FROM scores')}, {score.SCORER_VERSION})
            self.assertEqual({data['score'] for data in score.load(db).values()}, {45}, 'the new score is the AI answer under today\'s rules, under 50')
            self.assertEqual(desktop_strategy.outdated(db, {}, PROFILE)['count'], 0, 'nothing left to re-score')

    def test_the_rules_version_moved_past_the_pilot_scores(self):
        self.assertGreater(score.SCORER_VERSION, RULES_BEFORE_THE_LICENCE_CAP)

    def test_a_score_from_today_s_rules_is_not_old(self):
        with store.connect(self.db_path) as db:
            db.execute('UPDATE scores SET scorer_version=?', (score.SCORER_VERSION,))
            db.commit()
            self.assertEqual(desktop_strategy.outdated(db, {}, PROFILE)['count'], 0)

