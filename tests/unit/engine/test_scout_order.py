"""The central scout reads the feeds that still have no mix first (src/scout_carry.py `order`). No network. Own file: test_scout_carry.py is a proof file of the press ledger (L26), so a new case lives here."""
import tempfile
import unittest
from pathlib import Path

from src import scout, scout_carry, store as job_store

OLD = '2026-01-01'   # a read from before role_kinds.SINCE


class OrderByNeedTest(unittest.TestCase):
    """Why (sk 1/4): the AI's calls a run are few, so the feeds that still have no mix are read first, not the ones read longest ago."""
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.db = job_store.connect(Path(tmp.name) / 'j.sqlite').__enter__()
        self.db.executescript(scout.TABLES)

    def keep(self, slug, day, jobs=3, **mix):
        scout_carry.keep(self.db, [{'ats': 'lever', 'slug': slug, 'checked': day, 'fresh': {'jobs': jobs}, **mix}], day)

    def order(self, *slugs):
        return [item[0][1] for item in scout_carry.order(self.db, [(('lever', slug), {}) for slug in slugs], '2026-11-09')]

    def test_feeds_with_jobs_and_no_mix_come_before_older_feeds_that_have_one(self):
        self.keep('old-mixed', '2026-11-01', kinds={'software': 1.0})
        self.keep('empty', '2026-11-02', jobs=0)
        self.keep('mid-nomix', '2026-11-05')
        self.keep('new-nomix', '2026-11-08')
        self.assertEqual(self.order('old-mixed', 'empty', 'mid-nomix', 'new-nomix', 'never'),
                         ['never', 'mid-nomix', 'new-nomix', 'old-mixed', 'empty'])   # never read, then no mix by age, then the rest by age

    def test_a_feed_with_no_mix_read_today_waits_so_the_others_are_not_starved(self):
        self.keep('read-today', '2026-11-09')
        self.keep('older-mixed', '2026-11-03', kinds={'software': 1.0})
        self.keep('yesterday', '2026-11-08')
        self.assertEqual(self.order('read-today', 'older-mixed', 'yesterday'), ['yesterday', 'older-mixed', 'read-today'])

    def test_a_mix_from_before_the_kinds_grew_is_no_mix(self):
        self.keep('stale', OLD, kinds={'software': 1.0})
        self.keep('fresh', '2026-11-01', kinds={'software': 1.0})
        self.assertEqual(self.order('fresh', 'stale'), ['stale', 'fresh'])

    def test_counts_alone_are_a_mix(self):
        self.keep('counted', '2026-11-01', kind_counts={'ch': {'software': 1}})
        self.keep('plain', '2026-11-02')
        self.assertEqual(self.order('counted', 'plain'), ['plain', 'counted'])



if __name__ == "__main__":
    unittest.main()
