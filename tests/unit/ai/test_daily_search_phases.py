# Characterize search ordering, stored jobs, reports and delivery without network or AI.
import contextlib
import io
import json
import os
import re
from pathlib import Path
import socket
import tempfile
import unittest
from unittest import mock

from src import daily_helpers, daily_search, daily_search_scoring, store, time_budget
from src.ai import engine, score, slots
from src.daily_args import build_parser
from src.sources import aggregators, board_web, boards_ahead, boards_first, eures, feed_facts, feeds, found_boards
from src.stores import memory, sqlite as sqlite_store


JOB = {'id': 'one', 'url': 'https://example.test/jobs/one', 'title': 'SRE', 'company': 'Example',
       'location': 'Zurich', 'description': 'A fictional job.'}
SOURCE = {'company': 'Example', 'ats': 'lever', 'slug': 'example'}


class SearchCharacterization(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.calls, self.runs, self.score_calls, self.score_scopes, self.fail_scores = [], [], [], [], False
        self.jobs, self.sources = [dict(JOB)], [dict(SOURCE)]
        self.failed = self.expire = self.late_jobs = False
        self.stores = memory.open_store()
        self.stores.texts.set('profile', 'Fictional SRE in Zurich')
        # A file, as the app's: each store.connect is a connection of its own, bound to the thread that opened it (sqlite3's check_same_thread), so a
        # step that hands the search's connection to another thread fails here as it would on a person's Mac (ps E2a-1, 8 Nov 2026).
        self.connect = store.connect
        self.db = self.own_connection()
        self.addCleanup(time_budget.start, 0)
        time_budget.start(0)
        self.args = build_parser('test').parse_args(['--mode', 'run', '--score-max', '4', '--enrich-max', '4',
            '--seed', '7', '--db', ':memory:', '--company-report', str(self.root / 'missing.json')])
        self.matches_sync = self.stores.matches.sync
        self.import_report = store.import_watch_report
        self.enrich_error = self.score_error = None
        self.beside, self.real_next_batch = False, daily_search_scoring.next_batch
        patches = [
            mock.patch.dict(os.environ, {'JOBADABRA_DATA_DIR': str(self.root), 'JOBADABRA_CONFIG_DIR': str(self.root),
                                        'JOBADABRA_DISABLE': 'mail,notion,google_jobs,job_alerts'}),
            mock.patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')),
            mock.patch.object(engine, 'client', side_effect=AssertionError('AI forbidden')),
            mock.patch.object(engine, 'ready', return_value=True),
            mock.patch.object(daily_search, 'open_run', return_value=self.stores),
            mock.patch.object(daily_search, 'DATA', self.root), mock.patch.object(daily_search, 'REPORTS', self.root),
            mock.patch.object(daily_helpers, 'REPORTS', self.root),
            mock.patch.object(daily_search, 'load_search_config', return_value={}),
            mock.patch.object(daily_search, 'scoring_plan', side_effect=self.plan),
            mock.patch.object(daily_search_scoring, 'next_batch', side_effect=self.next_batch),
            mock.patch.object(daily_search, 'starter_sources', return_value=[]),
            mock.patch.object(daily_search, 'downloaded_index', return_value=[]),
            mock.patch.object(daily_search.employer_index, 'problem', ''),
            mock.patch.object(daily_search.scout, 'active_sources', side_effect=lambda *a: self.event('sources', self.sources)),
            mock.patch.object(board_web, 'early', side_effect=lambda *a: self.event('web')),
            mock.patch.object(eures, 'start_early', side_effect=lambda *a: self.event('eures')),
            mock.patch.object(boards_first, 'run', side_effect=lambda *a: self.event('boards first', [])),
            mock.patch.object(boards_first, 'Beside', side_effect=self.boards_beside),
            mock.patch.object(daily_search.first_jobs, 'propose_early', side_effect=lambda: self.event('proposal')),
            mock.patch.object(daily_search.first_jobs, 'run', side_effect=lambda *a, **k: self.event('slice')),
            mock.patch.object(boards_ahead, 'scan_beside', side_effect=self.gather),
            mock.patch.object(aggregators, 'scan', side_effect=lambda *a, **k: self.event('apis', {'jobs': [], 'sources': []})),
            mock.patch.object(daily_search.google_jobs, 'api_key', return_value=''),
            mock.patch.object(daily_search.coverage, 'save', side_effect=lambda *a: self.event('coverage')),
            mock.patch.object(daily_search.contribute, 'maybe_send', side_effect=lambda *a, **k: self.event('contribute')),
            mock.patch.object(feed_facts, 'keep_seen', side_effect=lambda *a: self.event('keep seen')),
            mock.patch.object(store, 'connect', side_effect=lambda *a: self.own_connection()),
            mock.patch.object(store, 'import_watch_report', side_effect=self.import_jobs),
            mock.patch.object(store, 'close_stale', side_effect=lambda *a, **k: self.event('stale', 0)),
            mock.patch.object(store, 'close_dropped', side_effect=lambda *a: self.event('dropped', 0)),
            mock.patch.object(feeds, 'place_open_jobs', side_effect=lambda *a: self.event('places')),
            mock.patch.object(store, 'close_elsewhere', side_effect=lambda *a, **k: self.event('elsewhere', 0)),
            mock.patch.object(store, 'prune_gone', side_effect=lambda *a: self.event('prune', 0)),
            mock.patch.object(daily_search.describe, 'backfill', side_effect=lambda *a: self.event('descriptions', 'Backfilled')),
            mock.patch.object(daily_search.enrich, 'run', side_effect=self.enrich),
            mock.patch.object(score, 'run', side_effect=self.score),
            mock.patch.object(daily_search.digest, 'eligible_jobs', side_effect=lambda db, *a, **k: (store.digest_jobs(db, only_new=False), [])),
            mock.patch.object(feeds, 'place_of', return_value='top'),
            mock.patch.object(self.stores.matches, 'sync', side_effect=self.sync),
            mock.patch.object(daily_search.source_yield, 'run', side_effect=lambda *a, **k: self.event('yield')),
            mock.patch.object(found_boards, 'read_since', return_value=[]),
            mock.patch.object(daily_search.digest, 'build_digest', side_effect=self.digest),
            mock.patch.object(daily_search.telegram, 'to_app', side_effect=lambda text: self.event('app')),
            mock.patch.object(daily_search.telegram, 'credentials', return_value=('token', 'chat')),
            mock.patch.object(daily_search.telegram, 'send', side_effect=lambda *a, **k: self.event('send')),
            mock.patch.object(daily_search.notify, 'wants_email', return_value=False),
            mock.patch.object(daily_search.digest, 'mark_shown', side_effect=lambda *a: self.event('shown')),
            mock.patch.object(daily_search, 'save_run', side_effect=lambda run: self.event('save', self.runs.append(dict(run)))),
            mock.patch.object(daily_search, 'log_crawl', side_effect=lambda stores, run: self.event('log', stores.cron_runs.put({'mode': run['mode']}))),
            mock.patch.object(daily_search.budget, 'status', return_value=None),
            mock.patch.object(daily_search.budget, 'describe', return_value='test budget'),
            mock.patch.object(daily_search.budget, 'apply_caps'),
            mock.patch.object(daily_search.ledger_store, 'sync', side_effect=lambda *a: self.event('ledger', 'Ledger')),
            mock.patch.object(daily_search.ledger_store, 'close_gone', side_effect=lambda *a: self.event('gone', ('Gone', []))),
            mock.patch.object(daily_search.interviews, 'sweep', side_effect=lambda **k: self.event('interviews', 'Interviews')),
            mock.patch.object(daily_search.doctor, 'alert', return_value='Health'),
            mock.patch.object(daily_search.insights, 'run', return_value='Insight'),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(self.join_scorer)   # registered last, so it runs first: before the patches and the temp folder go

    def next_batch(self, *args):
        """The scorer beside the search looks for landed jobs when a thread happens to start: a race with this file's instant gather. Off, except in the tests of that scorer (self.beside),
        so the older tests keep their one order; ts, 10 Nov 2026."""
        return self.real_next_batch(*args) if self.beside else ([], slots.SCORE)

    def join_scorer(self):
        """Waits for the scorer thread the search started (src/daily_search_scoring.py `_beside`).
        Why (ts, 10 Nov 2026; flaky on main after #3649, red on #3653 and #3654 which do not touch this file): the search's own join stops at the run's end
        (`thread.join(wait())`, 0 s once a test has spent the clock) and leaves the thread to finish alone, as it should on a person's Mac; a test that asserts
        on its scores, or drops the temp folder under it ("attempt to write a readonly database", "Directory not empty"), must wait for it. 30 s is a hang guard only."""
        for thread in [t for t in __import__('threading').enumerate() if t.name == 'scorer']:
            thread.join(30)
            self.assertFalse(thread.is_alive(), 'the scorer thread did not end')

    def own_connection(self):
        db = self.connect(self.root / 'jobs.sqlite')
        if __import__('threading').current_thread() is __import__('threading').main_thread():   # a thread's own: that thread closes it
            self.addCleanup(db.close)
        return db

    def event(self, name, result=None):
        self.calls.append(name)
        return result

    def plan(self, args, stores):
        self.event('plan')
        return (lambda: 'Fictional profile') if args.score_max else None

    def gather(self, sources, db, search, so_far, due, first=None):
        self.event('gather')
        self.first_given = first
        jobs = [dict(j) for j in self.jobs] if sources else []
        if self.expire:
            jobs = jobs[:1]
            time_budget.start(180, now=0)
        source_rows = [{'company': s['company'], 'ok': not self.failed, 'total': len(jobs), 'matches': len(jobs)} for s in sources]
        if self.failed:
            jobs = []
        if not self.late_jobs:
            so_far.add(jobs, 'employer sites')
            if self.beside and jobs:   # the search is still reading other sources: the scorer beside it takes the landed jobs meanwhile
                deadline = __import__('time').monotonic() + 10
                while 'score' not in self.calls and __import__('time').monotonic() < deadline:
                    __import__('time').sleep(0.02)
                self.event('gather goes on')
        return {'jobs': jobs, 'sources': source_rows}, None

    def boards_beside(self, search):
        """A repeat run's boards first (src/sources/boards_first.py Beside), read by nothing here."""
        self.event('boards beside')
        return mock.Mock(take=lambda feed_db, on_jobs: [])

    def import_jobs(self, db, report):
        self.event('import')
        return self.import_report(db, report)

    def enrich(self, db, model, maximum, stats, only_ids=None):
        self.event('enrich')
        if self.enrich_error:
            raise self.enrich_error
        stats.update(done=0, pending=0)
        return 'Enriched'

    def score(self, db, candidates, profile, model, maximum, stats, on_scored, only_ids, scope='all'):
        self.event('score')
        self.score_calls.append(only_ids)
        self.score_scopes.append(scope)
        if self.score_error:
            raise self.score_error
        picked = [j for j in candidates if only_ids is None or j['id'] in only_ids]
        if self.fail_scores:   # the AI refuses every call (a key answering 401)
            stats.update(done=0, pending=len(picked), failed=len(picked))
            return f'Scored 0 of {len(picked)}'
        for job in picked:
            score.save(db, job, model, {'score': 81, 'reason': 'Fixture fit'}, profile)
            on_scored()
        stats.update(done=len(picked), pending=len(picked))   # as score.run: the batch it took
        return f'Scored {len(picked)}'

    def sync(self, *a, **k):
        self.event('partial' if k.get('partial') else 'matches')
        return self.matches_sync(*a, **k)

    def digest(self, db, limit, shown_ids, **kwargs):
        self.event('digest')
        rows = store.digest_jobs(db, only_new=False)
        shown_ids.extend(j['id'] for j in rows)
        return [f'Digest: {len(rows)} jobs'], len(rows), [None]

    def run_search(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self.args, key, value)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = daily_search.search(self.args, self.stores)
        self.join_scorer()   # what the search left the scorer to finish alone
        self.assertEqual(result, 0)
        self.assertEqual((self.root / 'daily-latest.txt').read_text(), f'Digest: {self.db.execute("SELECT count(*) FROM jobs").fetchone()[0]} jobs\n')
        self.report = json.loads((self.root / 'daily-latest.json').read_text())
        return output.getvalue()

    def assert_order(self, *names):
        for name in names:
            self.assertIn(name, self.calls)
        positions = [self.calls.index(name) for name in names]
        self.assertEqual(positions, sorted(positions), self.calls)

    def test_new_jobs_score_sync_save_and_report_in_order(self):
        out = self.run_search(log_run=True)
        self.assertIn('Added 1 new job(s): Zurich 1', out)
        self.assertIn('New job: SRE | Example | https://example.test/jobs/one', out)
        self.assertIn('Scored 1', out)
        self.assertEqual([r['fit'] for r in self.stores.matches.list()], [81])
        self.assertEqual(self.report['jobs'], [JOB])
        self.assertEqual(len(self.stores.cron_runs.list()), 1)
        self.assert_order('plan', 'web', 'eures', 'sources', 'boards beside', 'gather', 'import', 'coverage', 'apis',
                          'keep seen', 'contribute', 'stale', 'dropped', 'places', 'elsewhere', 'prune', 'descriptions',
                          'enrich', 'score', 'partial', 'matches', 'yield', 'digest', 'app', 'save', 'log')

    def test_jobs_only_returned_at_gather_end_are_imported_too(self):
        self.late_jobs = True
        self.run_search()
        self.assertEqual(len(self.stores.matches.list()), 1)
        self.assertEqual(self.runs[0]['new'], 1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM jobs').fetchone()[0], 1)

    def test_timed_batches_score_before_reading_and_continue_in_order(self):
        self.jobs.append({**JOB, 'id': 'two', 'url': 'https://example.test/two', 'title': 'Second SRE'})
        time_budget.start(180)
        deadline = time_budget.DEADLINE
        with mock.patch.object(time_budget, 'batch', side_effect=[1, 1]), \
                mock.patch.object(time_budget, 'over', return_value=False), mock.patch.object(time_budget, 'record'):
            out = self.run_search()
        self.assertEqual(time_budget.DEADLINE, deadline)
        self.assertEqual(len(self.stores.matches.list()), 2)
        self.assertEqual(self.calls.count('score'), 2)
        self.assertEqual(out.count('Scored 1'), 2)
        self.assert_order('descriptions', 'score', 'partial', 'enrich', 'matches', 'digest')

    def waiting_jobs(self, n):
        """n jobs found by earlier searches and not scored yet (#3058: a tester's refresh scored 3 of 303)."""
        store.import_watch_report(self.db, {'jobs': [{'company': 'Old', 'id': f'old{i}', 'title': f'Old SRE {i}', 'location': 'Zurich',
                                                      'url': f'https://example.test/old/{i}', 'description': 'A fictional job.'} for i in range(n)]})

    def test_a_refresh_scores_the_jobs_waiting_with_its_search_before_the_import(self):
        # Design (3 Nov 2026, owner): Find jobs grows the scored list; a waiting job is the cheapest growth (one score, no search), so it goes first.
        self.waiting_jobs(5)
        time_budget.start(180)
        with mock.patch.object(time_budget, 'record'):
            out = self.run_search(limit=100)
        self.assertEqual(self.calls.count('score'), 2, 'the waiting jobs, then the new job found with the time left')
        self.assertEqual(len(self.score_calls[0]), 5, 'the first pass is the 5 waiting jobs, started with the search (beside it: ps E2a-1)')
        self.assertLess(self.calls.index('score'), self.calls.index('keep seen'), 'scored before the search imports what it found (import_sources)')
        self.assertEqual(len(self.stores.matches.list()), 6, '5 waiting + 1 new, all scored')
        self.assertNotIn('job(s) waiting, none scored', out)

    def test_the_employer_sites_read_while_the_waiting_jobs_are_scored(self):
        # L35 · ps E2a-1 (owner, 8 Nov 2026: "Both: no waits + background (Recommended)", then "3 min, then Find more"): a repeat Find jobs run scored
        # its waiting jobs before naming any employer (p10: scoring 0-144 s, employers named at 128 s, the read's cut at 67.5 s: 0 of 561 sites read).
        # 50 wait and the scorer is slow: it ends only once the employer sites have started reading, or after the hang guard if they never do.
        self.waiting_jobs(50)
        self.stores = sqlite_store.open_store({'JOBADABRA_DATA_DIR': str(self.root / 'store')})   # this Mac's store: its connection is the run's thread's
        self.addCleanup(self.stores.matches.db.close)
        time_budget.start(180)
        reading, seen, real, threads = __import__('threading').Event(), [], self.score, []
        gather = self.gather

        def slow_score(db, *a, **k):
            if not threads:
                threads.append(__import__('threading').get_ident())
                seen.append(reading.wait(10))   # a hang guard, not a pace: the read starts at once beside it
            try:
                return real(db, *a, **k)
            finally:
                self.event('scored')

        def read(*a, **k):
            reading.set()
            return gather(*a, **k)
        output = io.StringIO()   # not run_search: its digest check counts 10 rows a page, and 51 jobs are listed here
        every = lambda db, *a, **k: (store.digest_jobs(db, limit=10_000, only_new=False), [])   # the fixture's lists a page of 10
        with mock.patch.object(time_budget, 'record'), mock.patch.object(score, 'run', side_effect=slow_score), \
                mock.patch.object(boards_ahead, 'scan_beside', side_effect=read), mock.patch.object(daily_search.digest, 'eligible_jobs', side_effect=every), \
                contextlib.redirect_stdout(output):
            self.assertEqual(daily_search.search(self.args, self.stores), 0)
        out = output.getvalue()
        self.assertEqual(seen, [True], 'the employer sites started reading while the waiting jobs were still being scored')
        self.assertNotEqual(threads[0], __import__('threading').get_ident(), 'the waiting jobs are scored beside the search, in a thread of their own')
        self.assertEqual(len(self.score_calls[0]), 50, 'all 50 waiting jobs in the first pass: all of scoring\'s time is still theirs (L13)')
        self.assertLess(self.calls.index('scored'), self.calls.index('keep seen'), 'joined before the import: nothing reads their numbers half-written')
        self.assertNotIn('scoring skipped', out, 'its own connection: the search\'s never crosses a thread (a ProgrammingError would land here)')
        self.assertIn('(so far)', out)
        self.assertNotIn('not updated yet', out, 'Job Matches written as they are scored, on the thread\'s own connection to the store')
        self.assertEqual(len(self.stores.matches.list()), 51, '50 waiting + 1 new, all scored')

    def test_a_refresh_with_nothing_waiting_keeps_its_order(self):
        time_budget.start(180)
        with mock.patch.object(time_budget, 'record'):
            self.run_search()
        self.assertEqual(self.calls.count('score'), 1)
        self.assertLess(self.calls.index('gather'), self.calls.index('score'))

    def test_the_card_gets_one_scored_count_for_the_whole_run(self):
        # Waiting-first plus the search's own pass: the newest "Scored N of M" line (what the card shows, desktop/renderer/human-log.js) is the sum.
        self.waiting_jobs(4)
        time_budget.start(180)
        with mock.patch.object(time_budget, 'record'):
            out = self.run_search(limit=100)
        lines = [line for line in out.splitlines() if re.fullmatch(r'Scored \d+ of \d+ job\(s\)', line)]
        self.assertEqual(lines[-1], 'Scored 5 of 5 job(s)', '4 waiting + 1 new, not the last pass alone (1 of 1)')
        self.assertEqual(self.runs[0]['score']['done'], 5)

    def test_the_waiting_pass_counts_in_the_runs_scored_total(self):
        self.waiting_jobs(4)
        self.jobs = []   # nothing new: the second pass has no job, the run still scored 4
        time_budget.start(180)
        with mock.patch.object(time_budget, 'record'):
            self.run_search(limit=100)
        self.assertEqual(self.runs[0]['score']['done'], 4)

    def test_a_search_that_uses_the_whole_clock_still_leaves_the_waiting_jobs_scored(self):
        # #3058: 303 waited, the refresh spent its 3 minutes searching and scored the floor of 3 (here 8 wait). gather() here uses up the clock.
        self.waiting_jobs(8)
        self.expire = True
        time_budget.start(180)
        with mock.patch.object(time_budget, 'record'):
            self.run_search(limit=100)
        self.assertGreaterEqual(len(self.stores.matches.list()), 8, 'every waiting job scored, not the floor of 3')

    def test_after_a_change_of_places_the_waiting_pass_skips_the_jobs_the_cleanup_will_close(self):
        # Code review of #3058: the cleanup after the crawl closes jobs outside your places; scoring them first spent the clock on them.
        self.waiting_jobs(6)
        time_budget.start(180)
        outside = lambda job: not job['title'].endswith(('0', '1', '2', '3'))   # Old SRE 0..3 are no longer in the places
        with mock.patch.object(time_budget, 'record'), mock.patch.object(feeds, 'keep_open', side_effect=outside):
            self.run_search(limit=100)
        early = {j['title'] for j in store.digest_jobs(self.db, only_new=False) if j['id'] in self.score_calls[0]}
        self.assertEqual(early, {'Old SRE 4', 'Old SRE 5'})

    def test_the_waiting_pass_takes_all_of_scorings_time(self):
        # Owner, 3 Nov 2026: "If the jobs in the backlog means jobs that are not currently displayed in the jobs list, then all of it first". 8 wait,
        # 40 s of scoring time is 13 jobs at the 3 s pace: all 8 go first (the half share of #3074 took 6), the search's pass takes what is left.
        self.waiting_jobs(8)
        time_budget.start(180, now=time_budget.time.monotonic() - 100)
        time_budget.score_first()
        with mock.patch.object(time_budget, 'record'):
            self.run_search(limit=100)
        self.assertEqual(len(self.score_calls[0]), 8)
        self.assertLess(self.calls.index('score'), self.calls.index('keep seen'))

    def test_find_jobs_only_ever_asks_for_the_jobs_that_were_never_scored(self):
        # Owner, 3 Nov 2026: "if those jobs are already in the jobs list ... that should not be handled by find jobs at all": every scoring call a
        # refresh makes (the waiting pass, the search's pass, the top-up batches) is in the 'new' scope; the Re-score run is mode rescore.
        self.waiting_jobs(5)
        time_budget.start(180)
        with mock.patch.object(time_budget, 'record'):
            self.run_search(limit=100)
        self.assertGreaterEqual(len(self.score_scopes), 2)
        self.assertEqual(set(self.score_scopes), {'new'})

    def test_a_refusing_ai_is_warned_once_for_the_whole_run(self):
        # Code review of #3058: both passes said "N job(s) not scored" and the second counted the first's failures twice.
        self.waiting_jobs(3)
        self.fail_scores = True
        time_budget.start(180)
        with mock.patch.object(time_budget, 'record'):
            out = self.run_search(limit=100)
        warned = [w for w in self.runs[0]['warnings'] if 'not scored' in w]
        self.assertEqual(warned, ['4 job(s) not scored: the AI call failed'], '3 waiting + 1 new, said once, the retried jobs not counted twice')
        self.assertEqual((self.runs[0]['score']['pending'], self.runs[0]['score']['failed']), (4, 4), 'the 3 retried jobs are counted once, in the last pass')
        self.assertEqual([l for l in out.splitlines() if l.startswith('Scored ')][-1], 'Scored 0 of 4 job(s)')

    def test_the_waiting_passes_numbers_survive_a_failing_search_pass(self):
        self.waiting_jobs(3)
        time_budget.start(180)
        real = self.score
        def fail_second(db, candidates, profile, model, maximum, stats, on_scored, only_ids, scope='all'):
            if self.calls.count('score') >= 1:
                self.event('score')
                raise RuntimeError('boom')
            return real(db, candidates, profile, model, maximum, stats, on_scored, only_ids, scope)
        with mock.patch.object(time_budget, 'record'), mock.patch.object(score, 'run', side_effect=fail_second):
            self.run_search(limit=100)
        self.assertEqual(self.runs[0]['score']['done'], 3)
        self.assertIn('scoring skipped: RuntimeError', self.runs[0]['warnings'])

    def test_no_sources_still_reports_and_saves_empty_search(self):
        self.sources = []
        out = self.run_search()
        self.assertEqual(self.report, {'jobs': [], 'sources': []})
        self.assertEqual(self.stores.matches.list(), [])
        self.assertNotIn('Added ', out)
        self.assertEqual(self.runs[0]['new'], 0)
        self.assert_order('gather', 'score', 'matches', 'digest', 'save')

    def test_failed_source_is_counted_without_blocking_report(self):
        self.failed = True
        out = self.run_search()
        self.assertFalse(self.report['sources'][0]['ok'])
        self.assertEqual(len(self.runs[0]['failing_feeds']), 1)
        self.assertEqual(self.stores.matches.list(), [])
        self.assertIn('Scored 0', out)

    def test_deadline_hit_during_gather_keeps_partial_jobs_and_clock(self):
        self.jobs.append({**JOB, 'id': 'two', 'url': 'https://example.test/two', 'title': 'Second SRE'})
        self.expire = True
        # Why (29 Oct 2026): now=0 sets deadline 180; a fresh Linux runner's monotonic clock can still be below it.
        with mock.patch.object(time_budget.time, 'monotonic', return_value=181):
            out = self.run_search()
        self.assertEqual(len(self.report['jobs']), 1)
        self.assertEqual(time_budget.DEADLINE, 180)
        self.assertEqual(self.stores.matches.list(), [])
        self.assertIn('Scored 0', out)
        self.assert_order('gather', 'descriptions', 'score', 'enrich', 'digest', 'save')

    def test_nothing_new_does_not_send_or_mark_shown(self):
        self.jobs = []
        out = self.run_search(mode='scheduled', send=True)
        self.assertIn('No new jobs since the last run; nothing sent.', out)
        self.assertNotIn('send', self.calls)
        self.assertNotIn('shown', self.calls)
        self.assertEqual(self.runs[0]['telegram'], 'nothing new; not sent')
        self.assert_order('matches', 'ledger', 'gone', 'interviews', 'digest', 'save', 'log')

    def test_more_preview_never_imports_syncs_or_saves(self):
        self.import_report(self.db, {'jobs': [JOB]})
        out = self.run_search(mode='more')
        self.assertEqual(self.report, {'jobs': [], 'sources': []})
        for name in ('gather', 'import', 'matches', 'save', 'log', 'shown'):
            self.assertNotIn(name, self.calls)
        self.assertIn('Scored 1', out)
        self.assertEqual(self.stores.matches.list(), [])
        self.assert_order('descriptions', 'enrich', 'score', 'digest', 'app')

    def test_first_slice_precedes_boards_and_full_gather(self):
        self.run_search(first_jobs=True)
        self.assert_order('plan', 'web', 'sources', 'proposal', 'slice', 'boards first', 'gather')
        self.assertNotIn('boards beside', self.calls, 'a first run reads its boards after its slice, not beside the employer sites')

    def test_the_found_boards_start_before_the_employer_sites_and_are_read_beside_them(self):
        """L10 (owner, 26 Oct 2026: "START A JOB SEARCH WITH SEARCHING ON GOOGLE!"; ps E2a-2, owner, 8 Nov 2026, option "the boards still
        start first"): a repeat run starts the web search's boards before the employer sites and hands them to that read, never in front of it."""
        self.run_search()
        self.assert_order('web', 'sources', 'boards beside', 'gather')
        self.assertNotIn('boards first', self.calls, 'nothing reads the boards in front of the employer sites')
        self.assertIsNotNone(self.first_given, 'the employer read is given the boards to show beside it')

    def test_only_visits_does_not_start_web_or_close_jobs(self):
        self.sources.append({'company': 'Browser', 'ats': 'visit', 'slug': 'browser'})
        out = self.run_search(mode='today', only_visits=True)
        self.assertIn('Reading only the 1 page(s) read in Chrome on this Mac', out)
        for name in ('web', 'boards first', 'boards beside', 'apis', 'stale', 'dropped', 'places'):
            self.assertNotIn(name, self.calls)
        self.assertEqual([s['company'] for s in self.report['sources']], ['Browser'])

    def test_enrichment_and_scoring_errors_are_warned_and_reported(self):
        self.enrich_error = ValueError('facts fixture')
        self.score_error = ValueError('score fixture')
        out = self.run_search()
        self.assertIn('Warning: enrichment skipped: ValueError: facts fixture', out)
        self.assertIn('Warning: scoring skipped: ValueError: score fixture', out)
        self.assertIn('enrichment skipped: ValueError', self.runs[0]['warnings'])
        self.assertIn('scoring skipped: ValueError', self.runs[0]['warnings'])
        self.assert_order('enrich', 'score', 'matches', 'digest', 'save')

    def test_sent_digest_marks_shown_before_save(self):
        out = self.run_search(send=True)
        self.assertIn('Sent 1 Telegram message(s); imported 1 jobs.', out)
        self.assertEqual(self.runs[0]['telegram'], 'sent 1 message(s), 1 new')
        self.assert_order('digest', 'send', 'shown', 'save', 'log')

    def test_refused_delivery_leaves_jobs_unshown(self):
        with mock.patch.object(daily_search.telegram, 'send', side_effect=ValueError('refused')), \
                mock.patch.object(daily_search.telegram, 'failure_words', return_value='Delivery refused'):
            out = self.run_search(send=True)
        self.assertIn('Warning: Delivery refused', out)
        self.assertNotIn('shown', self.calls)
        self.assertEqual(self.runs[0]['telegram'], 'not sent: Telegram refused it')
        self.assertEqual(len(self.stores.matches.list()), 1)


if __name__ == '__main__':
    unittest.main()
