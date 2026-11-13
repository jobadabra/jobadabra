"""A career change scores low, and says why (owner, 13 Nov 2026: "We should be realistic. When a person tries to do a career change, for sure all
the scoring will drop" · "The person needs to understand why the scoring is so low"). The ring is the scorer's own overall score; the fit to the
search no longer replaces it. A job that is a role of the search on a career change stays listed and in the digest, under the bar, with the
career-change line first (src/ai/score_search.py). Fake model; the AI's two yeses on the title and first lines stand in as mocks."""
import unittest
from unittest import mock

from src import digest
from src.ai import score, score_search
from tests.unit.ai import test_score_career_change as career   # the module, so its own tests are not loaded twice
from tests.unit.ai.test_digest_counts import app_total, header

GAP, FakeModel = career.GAP, career.FakeModel


class RealisticRing(unittest.TestCase):
    scored = career.CareerChange.scored

    def setUp(self):
        career.CareerChange.setUp(self)   # the pilot search, a software CV, 13 First Officer jobs
        self.role_answer = 'yes'
        for patch in (mock.patch('src.sources.feeds.judged_title', return_value=True),
                      mock.patch('src.ai.decide.one', side_effect=lambda *args: self.role_answer)):
            patch.start()
            self.addCleanup(patch.stop)

    def test_the_ring_is_the_overall_score_and_the_13_pilot_jobs_stay_listed_with_the_why(self):
        """Fails on the old code: the search fit 85 replaced the overall 25, so the ring said 85 on 13 jobs the CV does not fit."""
        fits = self.scored(FakeModel(search_fit=85, cv_fit=25))
        one = next(iter(fits.values()))
        self.assertEqual((one['score'], one['tier']), (25, 'C'), "the scorer's own overall, realistic for a career change")
        self.assertEqual(one['reason'], f'Career change: {GAP}', 'the one line every place shows says why it is low')
        self.assertEqual(one['gaps'][0], GAP)
        self.assertTrue(one['search']['searched'], 'a role of the search, on a career change: the flag the digest reads')
        self.assertEqual(header(self.db, hide_unscored=True)[1], 13, 'low but listed in the digest')
        self.assertEqual(app_total(self.db), 13, 'and in the Jobs list')
        self.assertIn(f'25/100 · Career change: {GAP}', digest.build_digest(self.db, seed=1, hide_unscored=True)[0][0])

    def test_a_job_that_is_not_a_role_of_the_search_is_dropped_under_the_bar(self):
        """The accounting "Pilotage" job and the flight-controls engineer: the title check said yes, the first lines say no."""
        self.role_answer = 'no'
        fits = self.scored(FakeModel(search_fit=85, cv_fit=25))
        self.assertFalse(next(iter(fits.values()))['search']['searched'])
        self.assertEqual(header(self.db, hide_unscored=True)[1], 0)

    def test_the_fit_to_the_search_never_raises_the_ring_whatever_the_credential_flag_says(self):
        for needs in (True, False, None):
            with self.subTest(needs_credential=needs):
                part = {'fit': 85, 'career_change': True, 'cv_gap': GAP, 'needs_credential': needs}
                data = score_search.apply({'score': 20, 'tier': 'C', 'reason': 'Unrelated role', 'gaps': [], 'search': part}, {'title': 'Captain'})
                self.assertEqual((data['score'], data['tier']), (20, 'C'))

    def test_the_same_field_keeps_its_reason_and_is_not_flagged(self):
        fits = self.scored(FakeModel(career_change=False, search_fit=90, cv_fit=60))
        one = next(iter(fits.values()))
        self.assertEqual((one['score'], one['reason']), (60, 'Unrelated role: Pilot vs software developer'))
        self.assertFalse(one['search']['searched'])

    def test_the_score_is_stamped_with_the_new_rules_version(self):
        self.scored(FakeModel())
        self.assertEqual({row['scorer_version'] for row in self.db.execute('SELECT scorer_version FROM scores')}, {score.SCORER_VERSION})
        self.assertGreaterEqual(score.SCORER_VERSION, 4, 'the career-change ring changed what a score means: older ones are old scores')


if __name__ == '__main__':
    unittest.main()
