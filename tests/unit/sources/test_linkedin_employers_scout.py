"""The Scout checks the employers of this Mac's saved jobs still on LinkedIn's address, even on a day the shared list covers the person (owner, 14 Nov 2026,
asked via AskUserQuestion: "Both", then "Scout reads the store (Recommended)"). A fictional Zurich SRE's Scout had checked 0 of its LinkedIn employers
("the shared list already has 68 employers ... no new names today"). The saved jobs are the one owner: no flag file. No network."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import scout, scout_candidates, scout_core, scout_run
from src import store as job_store
from src.sources import board_employers
from tests.unit.sources.test_scout import SEEDS


def saved(db, company, job_id, url=None, state='open'):
    """One saved job of `company`, on LinkedIn's address unless `url` is given."""
    url = url or f'https://www.linkedin.com/jobs/view/{job_id}/'
    job_store.upsert_job(db, {'id': str(job_id), 'title': f'Platform Engineer {job_id}', 'company': company, 'location': 'Zurich, Switzerland', 'url': url}, 'LinkedIn')
    if state != 'open':
        db.execute('UPDATE jobs SET state = ? WHERE url = ?', (state, url))
    db.commit()


class LinkedInEmployers(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        patch = mock.patch('src.paths.DATA', self.dir)
        patch.start()
        self.addCleanup(patch.stop)
        self.db = job_store.connect(self.dir / 'jobs.sqlite')
        self.addCleanup(self.db.close)
        scout_core.ensure_tables(self.db)

    def names(self, index=()):
        return [(c['name'], c['origin']) for c in scout_candidates.linkedin_employer_candidates(self.db, list(index))]

    def test_employers_of_saved_jobs_still_on_linkedin_are_candidates_once_most_jobs_first(self):
        saved(self.db, 'Julius Baer', 1)
        saved(self.db, 'Adcubum AG', 2)
        saved(self.db, 'Adcubum AG', 3)
        self.assertEqual(self.names(), [('Adcubum AG', scout_candidates.LINKEDIN_ORIGIN), ('Julius Baer', scout_candidates.LINKEDIN_ORIGIN)])

    def test_a_job_moved_to_the_employers_site_a_closed_job_or_a_known_feed_is_no_candidate(self):
        saved(self.db, 'Canonical', 4, url='https://job-boards.greenhouse.io/canonical/jobs/5517891')
        saved(self.db, 'Gone AG', 5, state='closed')
        saved(self.db, 'Lyceum', 6)
        saved(self.db, 'Rivia', 7)
        self.db.execute("INSERT INTO feed_sources (ats, slug, company, tier, added_at) VALUES ('ashby', 'rivia', 'Rivia', 'Standard', '2026-11-14T10:00:00+00:00')")
        self.assertEqual(self.names(index=[{'company': 'Lyceum', 'ats': 'greenhouse', 'slug': 'lyceum'}]), [])

    def test_a_covered_day_queues_them_and_a_waiting_board_name_takes_the_linkedin_origin(self):
        board_employers.note([{'company': 'Julius Baer'}], 'Job boards found')
        scout.harvest(self.db, SEEDS, [scout_candidates.board_employer_candidates])
        saved(self.db, 'Julius Baer', 8)
        saved(self.db, 'Adcubum AG', 9)
        with mock.patch('src.employer_index._read', return_value=None):
            added, _ = scout_run.harvest_names(scout, self.db, SEEDS, None, None, (), 0, None, lambda: False, have=68)
        rows = {row['name']: (row['origin'], row['priority']) for row in self.db.execute('SELECT name, origin, priority FROM scout_candidates')}
        self.assertEqual((added, rows), (1, {'Adcubum AG': (scout_candidates.LINKEDIN_ORIGIN, scout_candidates.LINKEDIN_PRIORITY),
                                             'Julius Baer': (scout_candidates.LINKEDIN_ORIGIN, scout_candidates.LINKEDIN_PRIORITY)}))

    def test_a_linkedin_employer_is_checked_on_a_covered_day_and_a_board_employer_still_is_not(self):
        self.assertTrue(scout_candidates.counts_when_covered({'status': 'pending', 'origin': scout_candidates.LINKEDIN_ORIGIN}))
        self.assertFalse(scout_candidates.counts_when_covered({'status': 'pending', 'origin': board_employers.BOARD_ORIGIN}))


if __name__ == '__main__':
    unittest.main()
