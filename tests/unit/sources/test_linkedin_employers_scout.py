"""LinkedIn's employers reach this Mac's Scout even on a day the shared list covers the person (owner, 14 Nov 2026, asked via AskUserQuestion: "Both"): a fictional
Zurich SRE's Scout checked 0 of the 19 LinkedIn employers noted for it ("the shared list already has 68 employers ... no new names today"). No network."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import scout, scout_candidates, scout_core, scout_run
from src import store as job_store
from src.sources import board_employers
from tests.unit.sources.test_scout import SEEDS

JOBS = [{'company': 'Adcubum AG', 'title': 'Senior Cloud & DevOps Engineer'}, {'company': 'Julius Baer', 'title': 'Kubernetes Platform Engineer'}]


class LinkedInEmployers(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        patch = mock.patch('src.paths.DATA', self.dir)
        patch.start()
        self.addCleanup(patch.stop)

    def test_linkedins_employers_have_their_own_origin_and_a_board_s_keep_theirs(self):
        board_employers.note(JOBS, 'LinkedIn')
        board_employers.note([{'company': 'Example Hotels'}], 'Job boards found')
        origins = {c['name']: c['origin'] for c in board_employers.candidates()}
        self.assertEqual(origins, {'Adcubum AG': board_employers.LINKEDIN_ORIGIN, 'Julius Baer': board_employers.LINKEDIN_ORIGIN, 'Example Hotels': 'Board employer'})

    def test_a_linkedin_employer_is_checked_on_a_covered_day_and_a_board_employer_still_is_not(self):
        self.assertTrue(scout_candidates.counts_when_covered({'status': 'pending', 'origin': board_employers.LINKEDIN_ORIGIN}))
        self.assertFalse(scout_candidates.counts_when_covered({'status': 'pending', 'origin': 'Board employer'}))

    def test_a_covered_day_still_queues_linkedins_employers(self):
        board_employers.note(JOBS, 'LinkedIn')
        with job_store.connect(self.dir / 'jobs.sqlite') as db:
            scout_core.ensure_tables(db)
            added, _ = scout_run.harvest_names(scout, db, SEEDS, None, None, (), 0, None, lambda: False, have=68)
            names = {row['name']: row['origin'] for row in db.execute('SELECT name, origin FROM scout_candidates')}
        self.assertEqual((added, names), (2, {'Adcubum AG': board_employers.LINKEDIN_ORIGIN, 'Julius Baer': board_employers.LINKEDIN_ORIGIN}))

    def test_a_press_that_sees_a_feed_clears_the_linkedin_flag(self):
        board_employers.note(JOBS, 'LinkedIn')
        board_employers.note([], 'LinkedIn', resolved=['Adcubum AG'])
        origins = {c['name']: c['origin'] for c in board_employers.candidates()}
        self.assertEqual(origins, {'Adcubum AG': board_employers.BOARD_ORIGIN, 'Julius Baer': board_employers.LINKEDIN_ORIGIN})

    def test_a_waiting_board_name_seen_later_on_linkedin_takes_the_linkedin_origin(self):
        board_employers.note([{'company': 'Julius Baer'}], 'Job boards found')
        with job_store.connect(self.dir / 'jobs.sqlite') as db:
            scout_core.ensure_tables(db)
            scout.harvest(db, SEEDS, [scout_candidates.board_employer_candidates])
            board_employers.note([{'company': 'Julius Baer'}], 'LinkedIn')
            scout_run.harvest_names(scout, db, SEEDS, None, None, (), 0, None, lambda: False, have=68)
            [row] = db.execute('SELECT origin, priority FROM scout_candidates').fetchall()
        self.assertEqual((row['origin'], row['priority']), (board_employers.LINKEDIN_ORIGIN, board_employers.LINKEDIN_PRIORITY))


if __name__ == '__main__':
    unittest.main()
