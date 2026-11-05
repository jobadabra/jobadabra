"""The central scout verifies its feeds in slices: the longest-unread first, the rest carried over, so a run always ends in time. No network."""
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from src import geo, role_kinds, scout, scout_carry, scout_kind_counts, store as job_store


def job(title='Engineer'):
    return [{'id': '1', 'title': title, 'location': 'Zurich', 'url': 'u', 'date_posted': '2099-01-01', 'description': '', 'remote': False, 'salary': ''}]


class CarryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = job_store.connect(Path(self.tmp.name) / 'j.sqlite').__enter__()
        self.db.executescript(scout.TABLES)
        self.starter = [{'company': f'Co {i}', 'ats': 'lever', 'slug': f'co{i}'} for i in range(60)]   # fictional

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_run_cut_short_carries_the_feeds_it_read_last_time_and_reads_the_unread_ones_first(self):
        feeds, _ = scout.build_index(self.db, self.starter, lambda s, slug: job(), today='2026-10-20', carry=True)
        self.assertEqual(len(feeds), 60)   # first run: all read and kept
        calls = []
        def slow(system, slug):
            calls.append(slug)
            time.sleep(0.05)
            return job()
        self.starter.append({'company': 'New Co', 'ats': 'lever', 'slug': 'newco'})
        feeds, _ = scout.build_index(self.db, self.starter, slow, today='2026-10-21', workers=1, carry=True, deadline=time.monotonic() + 0.2)
        self.assertEqual(calls[0], 'newco')   # never-read first
        self.assertLess(len(calls), 61)       # cut short
        self.assertEqual(len(feeds), 60 + 1 - (0 if 'newco' in calls else 1))   # the others carried over, none lost
        self.assertTrue(any(f['checked'] == '2026-10-20' for f in feeds))   # a carried entry keeps its real read date

    def test_a_feed_not_read_for_a_week_is_not_carried(self):
        scout.build_index(self.db, self.starter[:3], lambda s, slug: job(), today='2026-10-01', carry=True)
        feeds, _ = scout.build_index(self.db, self.starter[:3], lambda s, slug: job(), today='2026-10-20', carry=True, deadline=time.monotonic() - 1)
        self.assertEqual(feeds, [])

    def test_without_carry_nothing_is_kept(self):
        scout.build_index(self.db, self.starter[:3], lambda s, slug: job(), today='2026-10-20')
        self.assertEqual(self.db.execute("SELECT name FROM sqlite_master WHERE name = 'feed_entries'").fetchall(), [])


class KeptMixTest(unittest.TestCase):
    """A feed re-read with no AI answer keeps the mix it had (31 Oct 2026: the index went from 47 counted feeds to 0 between two runs with 0 calls)."""
    MIX, COUNTS = {'software': 1.0}, {'ch': {'software': 1}}

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.db = job_store.connect(Path(tmp.name) / 'j.sqlite').__enter__()
        self.db.executescript(scout.TABLES)
        self.starter = [{'company': f'Co {i}', 'ats': 'lever', 'slug': f'co{i}'} for i in range(47)]   # fictional

    def read(self, today, titles=True, places=True, fetch=lambda s, slug: job()):
        """One run: `titles`/`places` False is a run whose AI answered none of them."""
        with mock.patch.object(role_kinds, 'judged', lambda texts, topic='role-kind': {t: 'software' for t in texts} if titles else {}), \
                mock.patch.object(geo, 'resolve', lambda strings, **_: {'zurich': {'kind': 'city', 'cc': 'CH'}} if places else {}), \
                mock.patch('src.ai.engine.ready', lambda *a, **k: False):
            return scout.build_index(self.db, self.starter, fetch, today=today, carry=True)[0]

    def test_a_run_with_no_calls_keeps_every_feeds_mix(self):
        self.assertEqual(sum(1 for f in self.read('2026-10-30') if f.get('kind_counts')), 47)
        feeds = self.read('2026-10-31', titles=False, places=False)
        self.assertEqual(sum(1 for f in feeds if f.get('kind_counts') == self.COUNTS and f.get('kinds') == self.MIX), 47)
        self.assertEqual({f['checked'] for f in feeds}, {'2026-10-31'})   # read today: only the judgment is old
        feeds = self.read('2026-11-01', titles=False, places=False)
        self.assertEqual(sum(1 for f in feeds if f.get('kinds') == self.MIX), 47, 'and the run after it')

    def test_a_fresh_judgment_replaces_the_kept_one(self):
        self.read('2026-10-30')
        with mock.patch.object(scout_kind_counts, 'of_jobs', lambda jobs: ({'sales': 1.0}, {'de': {'sales': 1}})):
            feeds = self.read('2026-10-31')
        self.assertEqual((feeds[0]['kinds'], feeds[0]['kind_counts']), ({'sales': 1.0}, {'de': {'sales': 1}}))

    def test_titles_judged_with_places_not_keeps_only_the_counts(self):
        self.read('2026-10-30')
        with mock.patch.object(scout_kind_counts, 'of_jobs', lambda jobs: ({'sales': 1.0}, None)):
            feed = self.read('2026-10-31')[0]
        self.assertEqual((feed['kinds'], feed['kind_counts']), ({'sales': 1.0}, self.COUNTS))

    def test_a_feed_never_judged_still_has_no_mix(self):
        feeds = self.read('2026-10-30', titles=False, places=False)   # the 26 Oct rule: no mix, not read
        self.assertFalse(any('kinds' in f or 'kind_counts' in f for f in feeds))

    def test_a_feed_with_no_jobs_now_keeps_no_mix(self):
        self.read('2026-10-30')
        feeds = self.read('2026-10-31', titles=False, places=False, fetch=lambda s, slug: [])
        self.assertFalse(any('kinds' in f or 'kind_counts' in f for f in feeds))

    def test_a_kept_entry_that_is_not_a_mix_is_dropped(self):
        scout_carry.keep(self.db, [{'ats': 'lever', 'slug': 'co0', 'kinds': {'made-up': 2}, 'kind_counts': {'xx': {'software': 1}}}], '2026-10-30')
        feed = next(f for f in self.read('2026-10-31', titles=False, places=False) if f['slug'] == 'co0')
        self.assertNotIn('kinds', feed)
        self.assertNotIn('kind_counts', feed)

    def test_a_lost_cache_keeps_the_mix_the_published_index_had(self):
        published = {'feeds': [{'ats': 'lever', 'slug': 'co0', 'checked': '2026-10-30', 'kinds': self.MIX, 'kind_counts': self.COUNTS}]}
        scout_carry.seed(self.db, 'https://index.example/api/index', 'key', get=lambda request: published)
        feed = next(f for f in self.read('2026-10-31', titles=False, places=False) if f['slug'] == 'co0')
        self.assertEqual((feed['kinds'], feed['kind_counts']), (self.MIX, self.COUNTS))


class BoundedWaitTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = job_store.connect(Path(self.tmp.name) / 'j.sqlite').__enter__()
        self.db.executescript(scout.TABLES)
        self.starter = [{'company': f'Co {i}', 'ats': 'lever', 'slug': f'co{i}'} for i in range(3)]

    def test_a_fetch_stuck_past_the_deadline_is_not_waited_for_and_its_feed_is_carried(self):
        scout.build_index(self.db, self.starter, lambda s, slug: job(), today='2026-10-20', carry=True)
        from src import scout_index
        scout_index.FETCH_GRACE_S = 0.2
        self.addCleanup(setattr, scout_index, 'FETCH_GRACE_S', 20)
        def stuck(system, slug):
            time.sleep(5)   # a fetch asleep behind a slow site
            return job()
        began = time.monotonic()
        feeds, _ = scout.build_index(self.db, self.starter, stuck, today='2026-10-21', workers=3, carry=True, deadline=time.monotonic() + 0.1)
        self.assertLess(time.monotonic() - began, 2)
        self.assertEqual(len(feeds), 3)   # all three carried from the first run


class SeedTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = job_store.connect(Path(self.tmp.name) / 'j.sqlite').__enter__()
        self.db.executescript(scout.TABLES)
        self.published = {'feeds': [{'company': f'Co {i}', 'ats': 'lever', 'slug': f'co{i}', 'tier': 'Standard', 'quality': 1, 'jobs': 1, 'relevant': 1,
                                     'checked': '2026-10-22', 'fresh': {}} for i in range(5)]}   # fictional

    def test_a_first_slice_run_keeps_every_feed_of_the_published_index_it_has_not_read(self):
        # 24 Oct 2026: the first slice run had nothing to carry and left 1250 feeds out of the published index
        self.assertEqual(scout_carry.seed(self.db, 'https://x/api/index', 'k', get=lambda request: self.published), 5)
        starter = [{'company': f'Co {i}', 'ats': 'lever', 'slug': f'co{i}'} for i in range(5)]
        feeds, _ = scout.build_index(self.db, starter, lambda s, slug: job(), today='2026-10-24', carry=True, deadline=time.monotonic() - 1)
        self.assertEqual(sorted(f['slug'] for f in feeds), [f'co{i}' for i in range(5)])
        self.assertEqual({f['checked'] for f in feeds}, {'2026-10-22'})   # dated by their real read

    def test_a_download_that_fails_adds_nothing_and_is_not_fatal(self):
        def down(request):
            raise OSError('offline')
        self.assertEqual(scout_carry.seed(self.db, 'https://x/api/index', 'k', get=down), 0)

    def test_an_entry_this_scout_stored_itself_is_not_replaced(self):
        scout.build_index(self.db, [{'company': 'Co 0', 'ats': 'lever', 'slug': 'co0'}], lambda s, slug: job(), today='2026-10-23', carry=True)
        scout_carry.seed(self.db, 'https://x/api/index', 'k', get=lambda request: self.published)
        self.assertEqual(self.db.execute("SELECT verified_at FROM feed_entries WHERE slug = 'co0'").fetchone()[0], '2026-10-23')
