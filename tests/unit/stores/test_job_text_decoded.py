"""A job's title, employer and place are text, never HTML: a source that sends "&amp;" must show "&" (src/store.py upsert_job, the one write every source goes through).
Why (4 Nov 2026, a Windows tester on 0.9.6): "Audit Pharmaceutical &amp; Life Sciences" in the Jobs list, from a EURES job."""
import tempfile
import unittest
from pathlib import Path

from src import store


def read(db, job_id):
    return dict(db.execute("SELECT jobs.title, jobs.location, companies.name AS company FROM jobs JOIN companies ON companies.id=jobs.company_id WHERE jobs.id=?", (job_id,)).fetchone())


class JobTextDecoded(unittest.TestCase):
    def setUp(self):
        self.db = store.connect(Path(tempfile.mkdtemp()) / 'jobs.sqlite')

    def test_escaped_title_employer_and_place_are_stored_as_text(self):
        job = {'url': 'https://jobs.example/1', 'title': 'Senior Associate - Audit Pharmaceutical &amp; Life Sciences', 'company': 'Smith &amp; Sons', 'location': 'Vaud &amp; Geneva'}
        job_id, _ = store.upsert_job(self.db, job, 'EURES')
        self.assertEqual(read(self.db, job_id), {'title': 'Senior Associate - Audit Pharmaceutical & Life Sciences', 'company': 'Smith & Sons', 'location': 'Vaud & Geneva'})

    def test_a_row_stored_escaped_by_an_older_version_is_repaired_when_seen_again(self):
        job = {'url': 'https://jobs.example/2', 'title': 'Plain title', 'company': 'Acme', 'location': 'Zurich'}
        job_id, _ = store.upsert_job(self.db, job, 'EURES')
        self.db.execute("UPDATE jobs SET title='R&amp;D Lead' WHERE id=?", (job_id,))
        store.upsert_job(self.db, {**job, 'title': 'R&amp;D Lead'}, 'EURES')
        self.assertEqual(read(self.db, job_id)['title'], 'R&D Lead')

    def test_a_title_that_is_text_keeps_its_words_even_with_a_bare_entity_name(self):
        job_id, _ = store.upsert_job(self.db, {'url': 'https://jobs.example/4', 'title': 'Q&A Lead &copy', 'company': 'Smith &not Sons', 'location': 'R&amp;amp;D Park'}, 'EURES')
        self.assertEqual(read(self.db, job_id), {'title': 'Q&A Lead &copy', 'company': 'Smith &not Sons', 'location': 'R&D Park'})

    def test_a_company_report_still_finds_the_employer_named_with_an_entity(self):
        report = {'companies': [{'company': 'Smith &amp; Sons', 'website': 'https://smith.example', 'career_pages': ['https://smith.example/jobs'],
                                 'jobs': [{'url': 'https://smith.example/jobs/1', 'title': 'Cook'}]}]}
        store.import_company_report(self.db, report)
        row = self.db.execute("SELECT name, website FROM companies WHERE name LIKE 'Smith%'").fetchall()
        self.assertEqual([tuple(r) for r in row], [('Smith & Sons', 'https://smith.example')])

    def test_a_title_that_is_already_text_is_untouched(self):
        job_id, _ = store.upsert_job(self.db, {'url': 'https://jobs.example/3', 'title': 'Finance & Controlling <Lead>', 'company': 'Acme'}, 'EURES')
        self.assertEqual(read(self.db, job_id)['title'], 'Finance & Controlling <Lead>')


if __name__ == '__main__':
    unittest.main()
