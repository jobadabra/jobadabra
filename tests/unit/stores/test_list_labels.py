import tempfile
import unittest
from pathlib import Path

from src import desktop, store


class ListLabelTests(unittest.TestCase):
    def test_old_cached_title_is_decoded_without_rediscovery(self):
        with tempfile.TemporaryDirectory() as directory:
            db = store.connect(Path(directory) / 'cache.sqlite')
            self.addCleanup(db.close)
            job_id, _ = store.upsert_job(db, {
                'title': 'Platform Engineer', 'company': 'Juniper Labs',
                'url': 'https://example.test/opening/42', 'location': 'Zurich',
            }, 'Juniper Labs', source_kind='employer feed')
            db.execute('UPDATE jobs SET title=? WHERE id=?',
                       ('Research &amp; Tooling &#8211; Engineer', job_id))
            db.commit()
            for options in ({}, {'notion_jobs': []}):
                with self.subTest(options=options):
                    rows = desktop.jobs(db, **options)['jobs']
                    self.assertEqual(len(rows), 1)
                    self.assertEqual(rows[0]['title'], 'Research & Tooling – Engineer')

    def test_remote_titles_are_decoded_at_the_list_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            db = store.connect(Path(directory) / 'cache.sqlite')
            self.addCleanup(db.close)
            for title, expected in (
                ('Design &amp;amp; Systems', 'Design & Systems'),
                ('Tools &#38; Infrastructure', 'Tools & Infrastructure'),
                ('Operations &not Support', 'Operations &not Support'),
                ('', ''),
            ):
                with self.subTest(title=title):
                    item = {'url': 'https://example.test/opening/73',
                            'title': title, 'company': 'Juniper Labs'}
                    rows = desktop.jobs(db, notion_jobs=[item])['jobs']
                    self.assertEqual(len(rows), 1)
                    self.assertEqual(rows[0]['title'], expected)
