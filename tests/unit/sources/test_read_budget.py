"""The employer read inside the search's time (src/sources/read_budget.py; owner, 26 Oct 2026, of a pilot search that read 1,123 employers for
5 minutes: "it shouldn't just go brute force and check all the employers" / "Stop at 3 minutes and tell you what's left for the next run"),
and the board web search started with the run, before the first jobs (src/sources/board_web.py early; the 26 Oct pilot check started it at
265 s). Fake sites and fake AI only.
Design (E2b, 8 Nov 2026; the slow tail test failed again on unchanged code after #3346 fixed its thread start order): what these tests prove is the
READ BUDGET RULE: no new site starts once READ_SECONDS of the read are used, the best READ_FLOOR sites are read whatever the clock says, the sites go to
the reader best first, and the sites not reached are kept for the next run. That rule is a function of the order sites are handed out and the clock, so
its one source of truth here is a scripted clock: `Clock` advances only when a fetch says how long it takes, and `Inline` runs each fetch in the caller's
thread. No real sleep, no thread start order, no machine load enters a result; the same 1,123 sites give the same 62 reads on every run. What
real threads add (a site still open at the cut is left for the next run, answers that land late) is asserted in test_read_cut.py and
test_three_minutes_resume.py, not here."""
import io
import sqlite3
import tempfile
import unittest
from concurrent.futures import Future
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src import time_budget
from src.sources import feed_scan, feeds, read_budget

TABLE = 'CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))'
FAST_S, SLOW_S, READ_S = 0.01, 0.3, 1.0   # a fast site, a slow one, and the read's time in this file (scripted seconds, never waited)


def job(i):
    return {'id': str(i), 'title': 'First Officer A320', 'location': 'Vienna, Austria', 'url': f'https://x.test/{i}', 'date_posted': '',
            'description': 'd', 'remote': False, 'salary': ''}


def sites(n=1123):
    return [{'company': f'Co{i}', 'ats': 'lever', 'slug': f's{i}'} for i in range(n)]


class Clock:
    """The scripted clock: `monotonic` is where it stands, a fetch moves it with `spend`; nothing else does."""
    def __init__(self):
        self.now = 1000.0

    def monotonic(self):
        return self.now

    def spend(self, seconds):
        self.now += seconds


class Inline:
    """Stands in for the thread pool: runs each fetch at once in the caller's thread, so the read is a script, not a race."""
    handed = []   # the order the code hands sites to the pool: what it guarantees (set by Base.scan)

    def __init__(self, *args, **kwargs):
        pass

    def submit(self, fn, *args, **kwargs):
        Inline.handed.append(int(args[0]['slug'][1:]))
        future = Future()
        try:
            future.set_result(fn(*args, **kwargs))
        except BaseException as error:  # noqa: BLE001 — what the pool would have held for the caller
            future.set_exception(error)
        return future

    def shutdown(self, wait=True, cancel_futures=False):
        pass


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.clock = Clock()
        scripted = SimpleNamespace(monotonic=self.clock.monotonic, time=lambda: 0.0)   # wall time 0: no SEARCH_AT, the run starts now
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(read_budget, 'READ_SECONDS', READ_S),
                      mock.patch.object(read_budget, 'time', scripted), mock.patch.object(time_budget, 'time', scripted),
                      mock.patch.object(feed_scan, 'time', scripted), mock.patch.object(feed_scan, 'ThreadPoolExecutor', Inline)):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(time_budget.start, 0)

    def scan(self, sources, slow_from=60):
        read, db = [], sqlite3.connect(':memory:')
        self.handed = Inline.handed = []
        db.execute(TABLE)
        clock = self.clock

        def fetcher(source):   # the first sites answer fast, the long tail slowly (the pilot run's 1,123 sites)
            n = int(source['slug'][1:])
            read.append(n)
            clock.spend(FAST_S if n < slow_from else SLOW_S)
            return [job(n)]
        out = io.StringIO()
        began = clock.now
        with redirect_stdout(out):
            report = feeds.scan(sources, db, fetcher=fetcher, details={})
        return report, read, clock.now - began, out.getvalue()


class ReadInTime(Base):
    def test_a_1123_site_list_with_a_slow_tail_ends_in_its_time_best_first_and_keeps_the_rest(self):
        time_budget.start(180)
        report, read, took, log = self.scan(sites())
        # 60 fast sites end at 0.6 s; the slow ones start at 0.6 and 0.9 s and the third would start at 1.2 s, past READ_S: 62 reads, every run
        self.assertEqual(len(read), 62, 'no new site started once the read\'s time was used: not 1,123 sites')
        self.assertLessEqual(took, READ_S + SLOW_S, 'the last site started before the cut and ended within one slow read')
        self.assertGreaterEqual(len(read), read_budget.READ_FLOOR, 'the best READ_FLOOR whatever the clock')
        self.assertEqual(sorted(read), list(range(len(read))), 'read in the order given (best first), no site skipped ahead')
        self.assertEqual(len(report['sources']), len(read), 'the report holds the sites read')
        self.assertIn(f'the other {1123 - len(read)} are read first next time', log)
        kept = read_budget._left()
        self.assertEqual(kept[0], f'lever:s{len(read)}')
        self.assertEqual(len(kept), 1123 - len(read))

    def test_the_best_floor_sites_are_read_even_when_the_read_time_is_already_used(self):
        time_budget.start(180)
        with mock.patch.object(read_budget, 'READ_SECONDS', 0.05):   # used up by the first slow site
            _, read, _, _ = self.scan(sites(), slow_from=0)
        self.assertEqual(len(read), read_budget.READ_FLOOR, 'the floor and no more')

    def test_the_next_run_reads_the_best_then_what_was_left_then_the_rest(self):
        key = lambda s: f"lever:{s['slug']}"
        read_budget.keep_left(sites()[500:510], key, 500, 1123)
        order = [s['slug'] for s in read_budget.left_first(sites(), key)]
        floor = read_budget.READ_FLOOR
        self.assertEqual(order[:floor], [f's{i}' for i in range(floor)], 'the best first, always')
        self.assertEqual(order[floor:floor + 10], [f's{i}' for i in range(500, 510)], 'then what the last run did not reach')
        self.assertEqual(len(order), 1123)

    def test_a_read_that_ends_in_time_forgets_the_list(self):
        key = lambda s: f"lever:{s['slug']}"
        read_budget.keep_left(sites()[5:9], key, 5, 9)
        time_budget.start(180)
        _, read, _, _ = self.scan(sites(30))
        self.assertEqual(len(read), 30)
        self.assertEqual(read_budget._left(), [])

    def test_without_a_budget_every_site_is_read(self):
        time_budget.start(0)
        _, read, _, log = self.scan(sites(70), slow_from=70)
        self.assertEqual(len(read), 70)
        self.assertNotIn('next time', log)


class RankedFirst(Base):
    def test_a_timed_read_follows_the_shared_ranking_and_leaves_its_dead_out(self):
        from src import source_rank
        given = sites(50)
        best = [given[i] for i in (7, 3, 9)]
        dead = [given[0], given[1]]

        def order(candidates, search, countries):
            rest = [c for c in candidates if c not in best and c not in dead]
            return best + rest, dead
        time_budget.start(180)
        with mock.patch.object(source_rank, 'order', side_effect=order) as ranked, mock.patch('src.paths.load_search_config', return_value={'role_keywords': ['pilot']}), \
                mock.patch('src.places.countries', return_value=['Austria']), mock.patch('src.places.load', return_value={}):
            _, read, _, log = self.scan(given, slow_from=50)
        # Why (E2b, 8 Nov 2026; was #3342): asserts the order the code hands sites to the pool, which `Inline` records on submit: the pool is scripted, so no thread
        # start order (the OS's, not the ranking's) can enter the result.
        self.assertEqual(self.handed[:3], [7, 3, 9], 'the proven best are handed to the pool first, in the ranking\'s order')
        self.assertLessEqual({7, 3, 9}, set(read), 'and all three were read')
        self.assertNotIn(0, read)
        self.assertNotIn(1, read)
        self.assertIn('2 left out', log)
        ranked.assert_called_once()

    def test_an_untimed_read_never_asks_the_ranking(self):
        from src import source_rank
        time_budget.start(0)
        with mock.patch.object(source_rank, 'order') as ranked:
            self.scan(sites(5), slow_from=5)
        ranked.assert_not_called()


class WebSearchWithTheRun(unittest.TestCase):
    def test_the_full_read_takes_the_search_started_with_the_run_and_keeps_what_it_found(self):
        from src.ai import board_ideas
        from src.sources import board_web
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        asked = ('k1', ['Austria'], ['first officer'], [], ['Vienna'])
        board = {'name': 'Crew Board', 'host': 'crew.example', 'search_url': 'https://crew.example/?q={role}', 'countries': ['Austria'],
                 'kinds': ['any'], 'source_kind': 'sector'}
        calls = []

        def search(config, known, now=None, fetch=None, data=None):
            calls.append(1)
            data.setdefault('web', {})['k1'] = '2026-10-26T10:00:00+00:00'
            data.setdefault('ideas', {})['k1'] = [{**board, 'origin': 'web'}]
            return [board]
        with mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(board_ideas, 'asked_for', return_value=asked), \
                mock.patch.object(board_web, 'search', side_effect=search):
            board_web.early({'role_keywords': ['first officer']})
            data = board_ideas.load()
            started = board_web.start({'role_keywords': ['first officer']}, data)
            found = board_web.finish(started, [], data=data)
        self.assertEqual(len(calls), 1, 'one search: the full read took the one started with the run')
        self.assertEqual([b['host'] for b in found], ['crew.example'])
        self.assertEqual(data['web']['k1'], '2026-10-26T10:00:00+00:00', 'its time is kept, so it rests')
        self.assertEqual([b['host'] for b in data['ideas']['k1']], ['crew.example'])


if __name__ == '__main__':
    unittest.main()
