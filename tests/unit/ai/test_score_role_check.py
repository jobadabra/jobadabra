"""A career change stays listed under the digest's bar only when the posting is a role of the search: the AI's yes on the posting's title AND first
lines, not the title alone (src/ai/score_search.py _role_check, `searched`). His 04:21 digest (26 Oct 2026, Free AI, pilot search) showed 8 pilot jobs and
2 wrong ones the title-only check let through: "Spécialiste Support Pilotage et Comptabilité" (accounting: "pilotage" is managing) and "Flight Physics &
Flight Controls Engineer". Fake model and fake role check: the role check stands in for the AI."""
import unittest
from unittest import mock

from src import digest, store as job_store
from src.ai import score, score_search
from tests.unit.ai import test_score_career_change as career   # the module, so its own tests are not loaded twice
from tests.unit.ai.test_digest_counts import header

GAP, FakeModel = career.GAP, career.FakeModel
POSTINGS = [
    ('Spécialiste Support Pilotage et Comptabilité', 'Vous assurez le pilotage des clôtures comptables et le support aux cabinets '
     "d'expertise comptable : rapprochements bancaires, TVA, liasses fiscales."),
    ('Flight Physics & Flight Controls Engineer', 'You design flight control laws and simulate flight physics for our drone fleet; '
     'MSc in aerospace engineering, MATLAB/Simulink.'),
    ('First Officer A320', 'First Officer on the A320 fleet: valid EASA ATPL, type rating, 500 hours.'),
]
PILOT = 'First Officer A320'


def seed(db):
    job_store.import_watch_report(db, {'jobs': [
        {'company': f'Example {i}', 'id': str(i), 'title': title, 'location': 'Vienna, Austria', 'url': f'https://jobs.test/{i}',
         'description': text} for i, (title, text) in enumerate(POSTINGS)]})


class RoleCheck(unittest.TestCase):
    def setUp(self):
        career.CareerChange.setUp(self)   # the pilot search, a software CV, 13 pilot jobs: replaced by the three postings
        self.db.execute('DELETE FROM jobs')
        self.db.commit()
        seed(self.db)
        self.asked = []
        for patch in (mock.patch('src.sources.feeds.judged_title', return_value=True),   # the title-only check: yes to all three (his run)
                      mock.patch('src.ai.decide.one', side_effect=self.role_check),
                      mock.patch('src.ai.decide.decide', side_effect=self.role_checks)):
            patch.start()
            self.addCleanup(patch.stop)

    def role_check(self, topic, key, text, answers, instructions):
        self.asked.append((topic, key, text, answers))
        return 'yes' if f'Posting: {PILOT}\n' in text else 'no'   # what the AI answers, reading the first lines

    def role_checks(self, topic, items, answers, instructions):   # the same AI, asked for many postings in one batch
        return {key: self.role_check(topic, key, text, answers, instructions) for key, text in items.items()}

    def fits(self):
        return {job['title']: data for job in digest.eligible_jobs(self.db)[0] if (data := score.load(self.db).get(job['id']))}

    def test_only_the_pilot_job_is_lifted_and_the_two_wrong_ones_keep_their_fit(self):
        """The title check alone says yes to all three; the digest lists the pilot job only, whose ring stays the scorer's 20."""
        score.run(self.db, digest.eligible_jobs(self.db)[0], career.CV, 'm', 20, client=FakeModel(search_fit=60, cv_fit=20))
        fits = self.fits()
        self.assertEqual({title: data['score'] for title, data in fits.items()}, {POSTINGS[0][0]: 20, POSTINGS[1][0]: 20, PILOT: 20})
        self.assertEqual({title: data['search']['searched'] for title, data in fits.items()},
                         {POSTINGS[0][0]: False, POSTINGS[1][0]: False, PILOT: True})
        self.assertEqual(header(self.db, hide_unscored=True)[1], 1, 'the digest lists the pilot job only')
        text = next(text for _, _, text, _ in self.asked if PILOT in text)
        self.assertIn('Roles searched: pilot first officer', text)
        self.assertIn('valid EASA ATPL', text, "the posting's first lines go with its title")
        self.assertEqual({(topic, tuple(answers)) for topic, _, _, answers in self.asked}, {(score_search.ROLE_TOPIC, ('yes', 'no'))})

    def test_no_answer_from_the_role_check_lifts_nothing(self):
        with mock.patch('src.ai.decide.one', return_value=None):
            data = score_search.apply({'score': 20, 'tier': 'C', 'search': {'fit': 0, 'career_change': True, 'cv_gap': GAP}},
                                      {'title': PILOT, 'description': POSTINGS[2][1]})
        self.assertEqual(data['score'], 20)
        self.assertFalse(data['search']['searched'], 'no AI, a failed or busy call: not a yes')


if __name__ == '__main__':
    unittest.main()
