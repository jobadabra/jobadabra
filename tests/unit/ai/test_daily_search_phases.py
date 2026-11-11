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
        self.calls, self.runs, self.score_calls, self.score_scopes, self.fail_scores, self.rounds = [], [], [], [], False, []
        self.jobs, self.sources = [dict(JOB)], [dict(SOURCE)]
        self.failed = self.expire = self.late_jobs = self.waiting_first = False
        self.scorer_gate = None   # an Event: the scorer thread does nothing until the search has saved its run (test_a_scorer_that_starts_after_the_search_ended...)
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
            # Why (11 Nov 2026, flaky test_read_methods on sf's push): #3802 starts the free job APIs at second 0; unstubbed, every search test read the live APIs in a thread that outlived it.
            mock.patch.object(daily_search, 'start_apis', return_value=None),
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

    def next_batch(self, db, profile, hidden, earlier, size, ceiling, only_waiting=False):
        """The scorer beside the search picks only jobs that waited, except in that scorer's own tests (self.beside). Why (ts, 10 Nov 2026; sf 2/8): this file's
        search is instant, so a job may land between any snapshot and the pick; asking for waiting ones only, before the claim, holds whatever the thread's timing."""
        return self.real_next_batch(db, profile, hidden, earlier, size, ceiling, only_waiting or not self.beside)

    def join_scorer(self):
        """Waits for the scorer thread the search started (src/daily_search_scoring.py `_beside`).
        Why (ts, 10 Nov 2026; #3649 bounded the join (27da5b9f) and wrote this test; it was green in #3649's own CI and has been intermittently red since, on #3653 and #3654, which do not touch this file: a race that was there from the start, not a later change): the search's own join stops at the run's end
        (`thread.join(wait())`, 0 s once a test has spent the clock) and leaves the thread to finish alone, as it should on a person's Mac; a test that asserts
        on its scores, or drops the temp folder under it ("attempt to write a readonly database", "Directory not empty"), must wait for it. 30 s is a hang guard only."""
        for thread in [t for t in __import__('threading').enumerate() if t.name == 'scorer']:
            thread.join(30)
            self.assertFalse(thread.is_alive(), 'the scorer thread did not end')

    def own_connection(self):
        if self.scorer_gate and __import__('threading').current_thread().name == 'scorer':
            self.scorer_gate.wait(30)   # hang guard only
        db = self.connect(self.root / 'jobs.sqlite')
        if __import__('threading').current_thread() is __import__('threading').main_thread():   # a thread's own: that thread closes it
            self.addCleanup(db.close)
        return db

    def event(self, name, result=None):
        self.calls.append(name)
        if name == 'save' and self.scorer_gate:
            self.scorer_gate.set()
        return result

    def plan(self, args, stores):
        self.event('plan')
        return (lambda: 'Fictional profile') if args.score_max else None

    def gather(self, sources, db, search, so_far, due, first=None):
        self.event('gather')
        if self.waiting_first:   # Why (#3798): as in a real run (scorer at second 0, reading 100+ s), the owed round starts before the search lands a job; the import no longer waits for it
            deadline = __import__('time').monotonic() + 10   # a hang guard, not a pace
            while 'score' not in self.calls and __import__('time').monotonic() < deadline:
                __import__('time').sleep(0.02)
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

    def boards_beside(self, search, listed=None):
        """The boards' lane (src/sources/boards_first.py Beside), read by nothing here; listed: a first run's own board list (lanes 4a)."""
        self.event('boards beside' if listed is None else 'boards lane')
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
        self.rounds += [only_ids] if __import__('threading').current_thread().name == 'scorer' else []   # Why (after #3685): the scorer's IN_FLIGHT first rounds start together, so which calls first is a race (load: its round of 1 came first, 1 in 16)
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
        self.waiting_first = True
        time_budget.start(180)
        with mock.patch.object(time_budget, 'record'):
            out = self.run_search(limit=100)
        self.assertEqual(len(max(self.rounds[:daily_search_scoring.IN_FLIGHT], key=len)), daily_search_scoring.BATCH, 'the first round is waiting jobs, started with the search (beside it: ps E2a-1), a round of the one list (sf 2/8)')
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
        self.assertEqual(len(max(self.rounds[:daily_search_scoring.IN_FLIGHT], key=len)), daily_search_scoring.BATCH, 'a round of the one ranked list: since sf 2/8 (owner, 10 Nov 2026: "One list together (Recommended)") the waiting jobs have no round of their own')
        self.assertEqual(self.runs[0]['score']['done'], 51, 'joined before the closing pass: the run\'s numbers are read whole, never half-written')
        self.assertNotIn('scoring skipped', out, 'its own connection: the search\'s never crosses a thread (a ProgrammingError would land here)')
        self.assertIn('(so far)', out)
        self.assertNotIn('not updated yet', out, 'Job Matches written as they are scored, on the thread\'s own connection to the store')
        self.assertEqual(len(self.stores.matches.list()), 51, '50 waiting + 1 new, all scored')

    def test_what_the_search_found_is_imported_while_the_owed_jobs_are_still_scored(self):
        """Design (#3798, 11 Nov 2026): the jobs a search found go to the list when its reading ends; the waiting jobs the run owes (L13) are still
        scored first by the AI, beside it, but the import never waits for them. p14's repeat run: 14 employer jobs read late were imported only after
        the owed scoring (153 s locally), and on CI after the app's 175 s stop, so they were never listed."""
        self.waiting_jobs(20)
        self.stores = sqlite_store.open_store({'JOBADABRA_DATA_DIR': str(self.root / 'store')})   # this Mac's store: its connection is the run's thread's
        self.addCleanup(self.stores.matches.db.close)
        time_budget.start(180)
        imported, held, real = __import__('threading').Event(), [], self.score

        def owed_score(db, *a, **k):
            if not held:   # the first owed round (IN_FLIGHT rounds start together: each records whether the import came while it ran)
                held.append(imported.wait(10))   # a hang guard, not a pace: the round runs until the search has imported
            return real(db, *a, **k)
        every = lambda db, *a, **k: (store.digest_jobs(db, limit=10_000, only_new=False), [])   # the fixture's lists a page of 10
        with mock.patch.object(time_budget, 'record'), mock.patch.object(score, 'run', side_effect=owed_score), \
                mock.patch.object(feed_facts, 'keep_seen', side_effect=lambda *a: (self.event('keep seen'), imported.set())), \
                mock.patch.object(daily_search.digest, 'eligible_jobs', side_effect=every), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(daily_search.search(self.args, self.stores), 0)
        self.assertTrue(held and all(held), f'the search imported what it found while the owed round was still being scored: {held}')
        self.assertEqual(len(self.stores.matches.list()), 21, '20 waiting + 1 new, all scored')

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
        self.assertGreaterEqual(len(self.stores.matches.list()), 8, 'every waiting job scored, not the floor of 3: owed to the run past its clock (sf 2/8)')

    def test_after_a_change_of_places_the_waiting_pass_skips_the_jobs_the_cleanup_will_close(self):
        # Code review of #3058: the cleanup after the crawl closes jobs outside your places; scoring them first spent the clock on them.
        self.waiting_jobs(6)
        time_budget.start(180)
        outside = lambda job: not job['title'].endswith(('0', '1', '2', '3'))   # Old SRE 0..3 are no longer in the places
        with mock.patch.object(time_budget, 'record'), mock.patch.object(feeds, 'keep_open', side_effect=outside):
            self.run_search(limit=100)
        early = {j['title'] for j in store.digest_jobs(self.db, only_new=False) if j['id'] in max(self.rounds[:daily_search_scoring.IN_FLIGHT], key=len)}
        self.assertEqual(early, {'Old SRE 4', 'Old SRE 5'})

    def test_the_waiting_pass_takes_all_of_scorings_time(self):
        # Owner, 3 Nov 2026: "If the jobs in the backlog means jobs that are not currently displayed in the jobs list, then all of it first". 8 wait,
        # 40 s of scoring time is 13 jobs at the 3 s pace: all 8 are owed to the run (the half share of #3074 took 6); since sf 2/8 in rounds of the one list.
        self.waiting_jobs(8)
        self.waiting_first = True
        time_budget.start(180, now=time_budget.time.monotonic() - 100)
        time_budget.score_first()
        with mock.patch.object(time_budget, 'record'):
            self.run_search(limit=100)
        self.assertEqual(len(max(self.rounds[:daily_search_scoring.IN_FLIGHT], key=len)), daily_search_scoring.BATCH, 'the first round: waiting jobs, in the one ranked list (sf 2/8; until then all 8 in one pass)')
        self.assertEqual(len(self.stores.matches.list()), 9, 'all 8 waiting and the new one scored in the run')
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

    def test_a_first_run_starts_its_boards_lane_before_its_slice_and_reads_no_board_after_it(self):
        """L10 (lanes 4a, owner, 11 Nov 2026, asked via AskUserQuestion: "Yes, update L05 and L10 (Recommended)"): every press starts the job
        boards at second 0 in their own lane; the first-jobs step reads employer sites and scores them without waiting for the boards. Before, a
        first run read its boards after its slice, past the read cut: board jobs in 1 of 49 first runs since 26 Oct."""
        self.run_search(first_jobs=True)
        self.assert_order('plan', 'web', 'sources', 'proposal', 'boards lane', 'slice', 'gather')
        self.assertNotIn('boards first', self.calls, 'no board read waits after the slice')

    def test_the_found_boards_start_before_the_employer_sites_and_are_read_beside_them(self):
        """L10 (owner, 26 Oct 2026: "START A JOB SEARCH WITH SEARCHING ON GOOGLE!"; ps E2a-2, owner, 8 Nov 2026, option "the boards still
        start first"): a repeat run starts the web search's boards before the employer sites and hands them to that read, never in front of it."""
        self.run_search()
        self.assert_order('web', 'sources', 'boards beside', 'gather')
        self.assertNotIn('boards first', self.calls, 'nothing reads the boards in front of the employer sites')
        self.assertIsNotNone(self.first_given, 'the employer read is given the boards to show beside it')


if __name__ == '__main__':
    unittest.main()
