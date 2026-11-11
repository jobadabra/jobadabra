"""The title step's own examples for titles that are no job of theirs (#3793; night 42927975750, 11 Nov 2026), inside the owner's 7 Oct 2026 decision ("Only the location should be strict")."""
import unittest

from src.ai import title_triage


class NotAJobOfTheirsTest(unittest.TestCase):
    """The night listed a carpenter in Brussels an "Open sollicitatie / Unsolicited application" and a software engineer in Amsterdam two
    pre-sales "Solutions Engineer" jobs: the title step said yes to all three. Its prompt now names both as left out, as data (examples), never a
    word list in code; a bare generic title ("Technicien") stays a "when unsure, include it" case (sa, 11 Nov 2026)."""

    def test_an_unsolicited_application_is_no_job_of_its_own(self):
        self.assertIn('an open or unsolicited application', title_triage.SYSTEM)
        for example in ('Candidature spontanée', 'Initiativbewerbung'):
            self.assertIn(example, title_triage.SYSTEM, 'examples in more than one language: the step reads any language')

    def test_selling_a_product_is_not_building_it(self):
        self.assertIn('"Solutions Engineer"', title_triage.SYSTEM)
        self.assertIn('pre-sales', title_triage.SYSTEM)

    def test_the_lenient_rule_still_holds(self):
        self.assertIn('When unsure, include it: a later step scores each job.', title_triage.SYSTEM)
        self.assertIn('a close neighbour of their work at a similar level', title_triage.SYSTEM)


if __name__ == '__main__':
    unittest.main()
