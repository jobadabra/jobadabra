"""ats.slug_ok: a slug's shape per job system. One loop over every feed type, so a new type must say what its slugs look like."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src.sources import ats, describe  # noqa: E402

GOOD = {'oracle': 'acme.us2.CX_1', 'workday': 'acme.wd3.Careers', 'successfactors': 'careers.acme.com', 'phenom': 'careers.acme.com',
        'eightfold': 'jobs.acme.com', 'umantis': 'recruitingapp-1234', 'greenhouse': 'acme', 'jobsch': '27602-manor-ag'}
BAD = {'oracle': 'acme.us2', 'workday': 'acme.Careers', 'successfactors': 'localhost', 'phenom': 'evil.com/x', 'eightfold': 'a b.com',
       'umantis': 'acme', 'greenhouse': 'a/b'}
NOT_SHARED = {'amazon', 'netflix', 'visit', 'careers'}


class SlugShapeTests(unittest.TestCase):
    def test_every_feed_type_says_which_slugs_it_accepts(self):
        for system in ats.FETCHERS:
            with self.subTest(system=system):
                if system in NOT_SHARED:
                    self.assertFalse(ats.slug_ok(system, 'acme'))
                    continue
                self.assertTrue(ats.slug_ok(system, GOOD.get(system, 'acme-co')))
                self.assertFalse(ats.slug_ok(system, BAD.get(system, 'a b/c')))

    def test_nothing_empty_and_no_unknown_system_passes_for_a_shared_board(self):
        for system in ats.FETCHERS:
            self.assertFalse(ats.slug_ok(system, ''))
            self.assertFalse(ats.slug_ok(system, None))

    def test_a_workday_cluster_of_any_length_is_one_board(self):
        for cluster in ('wd3', 'wd12', 'wd103', 'wd502'):
            slug = f'acme.{cluster}.Careers'
            self.assertEqual(ats.detect(f'https://acme.{cluster}.myworkdayjobs.com/en-US/Careers/job/Designer_R1'), ('workday', slug))
            self.assertTrue(ats.slug_ok('workday', slug))
            self.assertTrue(describe.WORKDAY.match(f'https://acme.{cluster}.myworkdayjobs.com/en-US/Careers/job/Designer_R1'))


class CompanyInSlugTest(unittest.TestCase):
    """A job link with no company named: the employer its board's slug spells, and nothing when it spells none (`Acme.Wd502.Careers` is no one's name)."""
    LINKS = {'greenhouse': ('https://boards.greenhouse.io/acme-corp/jobs/1', 'Acme Corp'), 'lever': ('https://jobs.lever.co/acme-corp/1', 'Acme Corp'),
             'ashby': ('https://jobs.ashbyhq.com/acme-corp/1', 'Acme Corp'), 'smartrecruiters': ('https://jobs.smartrecruiters.com/acme-corp/1', 'Acme Corp'),
             'workable': ('https://apply.workable.com/acme-corp/j/1', 'Acme Corp'), 'recruitee': ('https://acme-corp.recruitee.com/o/1', 'Acme Corp'),
             'personio': ('https://acme-corp.jobs.personio.de/job/1', 'Acme Corp'), 'teamtailor': ('https://acme-corp.teamtailor.com/jobs/1', 'Acme Corp'),
             'join': ('https://join.com/companies/acme-corp/1', 'Acme Corp'),
             'workday': ('https://acme-corp.wd502.myworkdayjobs.com/en-US/Careers/job/Zurich/Designer_R1', 'Acme Corp'),
             'oracle': ('https://efet.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1', ''),   # a code, not a name
             'umantis': ('https://recruitingapp-1234.umantis.com/Vacancies/1/Description/2', '')}

    def test_every_system_a_job_link_reaches_says_its_name_or_none(self):
        self.assertEqual(set(self.LINKS), {name for name, _ in ats.URL_PATTERNS}, 'a new system says what its slug spells')
        for system, (url, company) in self.LINKS.items():
            found = ats.detect(url)
            self.assertEqual(found[0], system, url)
            self.assertEqual(ats.company_in_slug(found), company, url)

    def test_no_link_found_is_no_name(self):
        self.assertEqual(ats.company_in_slug(None), '')


if __name__ == '__main__':
    unittest.main()
