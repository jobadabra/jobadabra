"""Jobs shown per source (owner, 18 Oct 2026: "start displaying jobs to the user as quickly as possible"): a search imports each source's
sure jobs as soon as that source is read, not all of them at the end of the whole search. Code: src/sources/feed_scan.py, src/jobs_so_far.py,
src/sources/aggregators.py."""
import re
import sqlite3
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src import jobs_so_far, store  # noqa: E402
from src.sources import aggregators, careers, feeds  # noqa: E402

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER



def job(i, title='Site Reliability Engineer', where='Zurich, Switzerland'):
    return {'id': str(i), 'title': title, 'location': where, 'url': f'https://x.test/{i}', 'date_posted': '', 'description': 'd',
            'remote': False, 'salary': ''}


def feed_db():
    db = sqlite3.connect(':memory:')
    db.execute('CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))')
    return db


def by_words(title):
    return bool(re.search('Reliability', title))


class FeedScanShowsEachSiteTest(unittest.TestCase):
    def setUp(self):
        words = mock.patch.object(feeds, 'TITLES', re.compile('Reliability'))
        never = mock.patch.object(feeds, 'EXCLUDED_TITLES', re.compile(r'(?!x)x'))
        title = mock.patch.object(feeds, 'wanted_title', lambda t: by_words(t) or t == 'Platform Lead')   # 'Platform Lead': only the AI says yes
        early = mock.patch.object(feeds, 'sure_title', by_words)   # while a site is read the AI has not judged 'Platform Lead' yet: the words show what they name
        place = mock.patch.object(feeds, 'wanted_location', lambda j: 'Zurich' in j['location'])
        for patch in (words, never, title, early, place, mock.patch.object(feeds, 'triage', lambda jobs: None),
                      mock.patch.object(feeds, 'triage_places', lambda jobs: None)):
            patch.start()
            self.addCleanup(patch.stop)

    def test_a_fast_site_is_shown_while_a_slow_one_is_still_read(self):
        """The driver's crawl, 17 Oct 2026: 133 of 134 sites were read by 61 s, the last one held every job until 156 s."""
        shown, slow_may_end = [], threading.Event()

        def fetcher(source):
            if source['slug'] == 'slow':
                self.assertTrue(slow_may_end.wait(5), 'the fast site was never shown while the slow one was read')
                return [job(2)]
            return [job(1), job(3, title='Platform Lead'), job(4, where='Berlin')]

        def on_jobs(jobs):
            shown.append([j['id'] for j in jobs])
            slow_may_end.set()
        sources = [{'company': 'Slow', 'ats': 'lever', 'slug': 'slow'}, {'company': 'Fast', 'ats': 'lever', 'slug': 'fast'}]
        report = feeds.scan(sources, feed_db(), fetcher=fetcher, details={}, on_jobs=on_jobs)
        self.assertEqual(shown[0], ['1'], 'the sure job of the fast site first; the AI-sorted title and the job elsewhere wait')
        self.assertEqual(sorted(j['id'] for j in report['jobs']), ['1', '2', '3'], 'the full report keeps every match once')
        self.assertEqual({j['status'] for j in report['jobs']}, {'new'}, 'a job shown early is still new, never "seen" by its own search')

    def test_without_a_listener_nothing_changes(self):
        report = feeds.scan([{'company': 'Co', 'ats': 'lever', 'slug': 's'}], feed_db(), fetcher=lambda source: [job(1)], details={})
        self.assertEqual([j['id'] for j in report['jobs']], ['1'])


class AggregatorsShowEachReaderTest(unittest.TestCase):
    def test_each_reader_hands_its_jobs_over_when_it_is_read(self):
        order = []
        posting = lambda i: {**job(i), 'company': 'Co'}
        readers = [('First board', lambda search: order.append('read first') or [posting(1)]),
                   ('Second board', lambda search: order.append('read second') or [posting(2)])]
        with mock.patch.object(feeds, 'wanted_title', lambda t: True), mock.patch.object(feeds, 'wanted_location', lambda j: True), \
                mock.patch.object(aggregators.board_employers, 'fill_missing', lambda jobs: None), \
                mock.patch.object(aggregators.board_employers, 'note', lambda jobs, name: None):
            aggregators.scan(feed_db(), {}, readers=readers, on_jobs=lambda jobs: order.append(f"shown {jobs[0]['id']}"))
        self.assertEqual(order, ['read first', 'shown 1', 'read second', 'shown 2'])


class SoFarTest(unittest.TestCase):
    def test_jobs_imported_early_keep_their_new_status_at_the_end(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        db = store.connect(Path(folder.name) / 'jobs.sqlite')
        self.addCleanup(db.close)
        lines = []
        so_far = jobs_so_far.SoFar(db, say=lines.append)
        first = [{**job(1), 'company': 'Co'}, {**job(2), 'company': 'Co'}]
        so_far.add(first, 'employer sites')
        self.assertEqual(lines, ['Jobs so far: 2 new from employer sites'])
        report = {'jobs': [*first, {**job(3), 'company': 'Co'}]}
        self.assertEqual(so_far.statuses(report, store.import_watch_report(db, report)), ['new', 'new', 'new'])

    def test_many_sources_read_close_together_are_said_as_a_running_sum(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        db = store.connect(Path(folder.name) / 'jobs.sqlite')
        self.addCleanup(db.close)
        lines, now = [], [0.0]
        so_far = jobs_so_far.SoFar(db, say=lines.append, every=5, clock=lambda: now[0])
        for n in range(1, 41):   # 40 employer sites, one new job each, 0.1 s apart
            now[0] = n * 0.1
            so_far.add([{**job(n), 'company': f'Co{n}'}], 'employer sites')
        self.assertEqual(lines, ['Jobs so far: 1 new from employer sites'])
        now[0] = 6.0
        so_far.add([{**job(41), 'company': 'Co41'}], 'job boards')
        self.assertEqual(lines[1:], ['Jobs so far: 39 new from employer sites', 'Jobs so far: 1 new from job boards'])
        so_far.add([{**job(42), 'company': 'Co42'}], 'job boards')
        self.assertEqual(len(lines), 3)
        so_far.statuses({'jobs': []}, [])
        self.assertEqual(lines[3:], ['Jobs so far: 1 new from job boards'])

    def test_the_free_job_apis_jobs_are_said_as_from_free_job_apis_not_job_boards(self):
        """Why (#3893, wj, 12 Nov 2026, Gitar): Jobicy, Himalayas and Arbeitnow jobs were said as "from job boards"; both hand-overs (the scan and the late keep) name their own kind."""
        from src import daily_search
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        db = store.connect(Path(folder.name) / 'jobs.sqlite')
        self.addCleanup(db.close)
        lines = []
        so_far = jobs_so_far.SoFar(db, say=lines.append)
        heard = []
        with mock.patch.object(daily_search, 'load_search_config', return_value={}), mock.patch.object(aggregators, 'scan', side_effect=lambda *a, on_jobs=None, **k: heard.append(on_jobs) or {'jobs': []}), \
                mock.patch.object(aggregators, 'keep_late', side_effect=lambda db_, search, lane, on_jobs, until: heard.append(on_jobs) or []), \
                mock.patch.object(daily_search.feeds, 'database', return_value=mock.MagicMock()):
            daily_search.keep_late_apis(object(), so_far)
        self.assertEqual(len(heard), 1)
        heard[0]([{**job(7), 'company': 'Jobicy Co'}])
        so_far.flush()
        self.assertEqual(lines, ['Jobs so far: 1 new from free job APIs'])

    def test_the_jobs_list_reads_again_on_that_line(self):
        page = (Path(__file__).resolve().parents[3] / 'desktop' / 'renderer' / 'pages' / 'jobs.js').read_text()
        pattern = re.search(r'export const LIST_CHANGED = /(.+)/;', page).group(1)
        self.assertTrue(re.search(pattern.replace('\\/', '/'), 'Jobs so far: 2 new from employer sites'))
        self.assertFalse(re.search(pattern.replace('\\/', '/'), 'Jobs so far: 0 new from employer sites'))

    def test_a_line_held_back_inside_the_window_is_said_when_the_window_ends_with_no_later_add(self):
        """13 Nov 2026, c04 pair run 43517140431: board jobs imported at 60 s, 3 s after the employer sites' line, were said at no time before the run's end at 175 s: the
        employer stage had ended, so no add came to flush them, and the Jobs list reads itself again only on this line."""
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        db = store.connect(Path(folder.name) / 'jobs.sqlite')
        self.addCleanup(db.close)
        lines, now, timers = [], [0.0], []

        class Timer:
            def __init__(self, delay, fn):
                self.delay, self.fn, self.cancelled = delay, fn, False
                timers.append(self)

            def cancel(self):
                self.cancelled = True
        so_far = jobs_so_far.SoFar(db, say=lines.append, every=5, clock=lambda: now[0], later=Timer)
        so_far.add([{**job(1), 'company': 'Co1'}], 'employer sites')
        now[0] = 3.0
        so_far.add([{**job(2), 'company': 'Co2'}], 'job boards')
        so_far.add([{**job(3), 'company': 'Co3'}], 'job boards')
        self.assertEqual(lines, ['Jobs so far: 1 new from employer sites'], 'inside the window: held back')
        self.assertEqual([timer.delay for timer in timers], [2.0], 'one timer for the window end, not one per add')
        now[0] = 5.0
        timers[0].fn()   # the window ends and nothing else adds
        self.assertEqual(lines[1:], ['Jobs so far: 2 new from job boards'])
        so_far.statuses({'jobs': []}, [])
        self.assertEqual(len(lines), 2, 'said once: nothing is left for the end')

    def test_the_end_of_the_run_cancels_the_timer_it_no_longer_needs(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        db = store.connect(Path(folder.name) / 'jobs.sqlite')
        self.addCleanup(db.close)
        lines, now, timers = [], [0.0], []
        timer = type('Timer', (), {'cancel': lambda self: timers.append('cancelled')})()
        so_far = jobs_so_far.SoFar(db, say=lines.append, every=5, clock=lambda: now[0], later=lambda delay, fn: timer)
        so_far.add([{**job(1), 'company': 'Co1'}], 'employer sites')
        now[0] = 1.0
        so_far.add([{**job(2), 'company': 'Co2'}], 'job boards')
        so_far.statuses({'jobs': []}, [])
        self.assertEqual((lines[1:], timers), (['Jobs so far: 1 new from job boards'], ['cancelled']))


if __name__ == '__main__':
    unittest.main()
