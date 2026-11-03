"""The fake Notion IDs tests/suite_ids.py sets for the whole suite: one per database and page, and Windows temp folders that ignore cleanup errors."""
import sys
import tempfile
import unittest

from suite_ids import IDS

class NotionIdTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == 'win32', 'Windows only')
    def test_windows_ignores_temp_folder_cleanup_errors(self):
        with tempfile.TemporaryDirectory() as folder:
            pass
        self.assertTrue(tempfile.TemporaryDirectory()._ignore_cleanup_errors)


    def test_every_database_and_page_has_its_own_id(self):
        from src.notion import client, ledger
        self.assertEqual(len(set(IDS.values())), len(IDS))
        self.assertNotEqual(client.PROFILE_PAGE_ID, ledger.EVENTS_DATABASE_ID)
