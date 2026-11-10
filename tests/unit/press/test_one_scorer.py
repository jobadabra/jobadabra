"""One scorer per Find jobs run (ts, 10 Nov 2026; owner asked via AskUserQuestion, "Yes, build it (Recommended)"; night 9 Nov, run 42537909472: 18 personas scored a
median of 3 jobs on press 1 although 73-204 jobs were in their places; "No time left in this refresh to score any: N job(s)" at 105-163 s in 14 of 18).
Design: a job is Listed (a reader), Placed (place_triage), Kept (title sorting), Scored (the one scorer). The scorer starts at the first Kept job on every press, first
included, runs beside the readers and stops at the run's end minus TAIL; the job facts take only what scoring leaves; the slice scores `first` jobs once and the scorer
goes on; AI calls: first press's local reads > scoring of this run's jobs > the rest > the jobs of earlier runs (LATER) > the web search.
Guard: release - what a first Find jobs run gives the person in its 3 minutes."""
import itertools
import threading
import unittest
from pathlib import Path
from unittest import mock

from src import daily_search_scoring as scoring
from src.ai import slots
from src.press import scorer
from src.press.clock import Clock

T0 = 1000.0


class ScoringEndsWhereTheRunEnds(unittest.TestCase):
    """The 25 s kept 'for the job facts' were read as '0 of 74' on every night log: scoring stopped at 105 s of 135 and nothing used the rest."""

    def clock(self):
        clock = Clock()
        clock.start(180, now=T0)
        clock.score_first(True)
        patcher = mock.patch.object(clock, '_paces', return_value=dict(clock.PACE))
        patcher.start()
        self.addCleanup(patcher.stop)
        return clock

    def test_scoring_keeps_no_seconds_for_the_facts(self):
        clock = self.clock()
        self.assertFalse(clock.over('score', T0 + 150), 'before: stopped at 150 s (FACTS 25 s + TAIL 15 s before 180)')
        self.assertFalse(clock.over('score', T0 + 164))
        self.assertTrue(clock.over('score', T0 + 166), 'the last TAIL seconds: a call started now would end past 180 s')

    def test_a_batch_at_130_s_takes_the_time_left_not_the_floor(self):
        clock = self.clock()
        self.assertEqual(clock.batch('score', 100, now=T0 + 130, say=False), 11, '(180 - 130 - 15 s) / 3 s each; before: 3, the floor')

    def test_the_facts_get_what_scoring_leaves(self):
        clock = self.clock()
        self.assertFalse(clock.over('enrich', T0 + 164), 'the facts have the same end as scoring: they run when no job waits for a score')


class ScoringHasItsOwnSlotLevel(unittest.TestCase):
    def order(self, levels):
        gate, out, started = slots.Slots(1), [], []
        done = threading.Event()
        with gate:
            threads = []
            for n, level in enumerate(levels):
                def take(level=level, n=n):
                    with slots.priority(level), gate:
                        out.append(n)
                thread = threading.Thread(target=take)
                thread.start()
                threads.append(thread)
                while gate.waiting() < n + 1:
                    done.wait(0.005)
        for thread in threads:
            thread.join()
        return out

    def test_scoring_goes_after_the_first_presss_local_reads_and_before_ordinary_calls(self):
        got = self.order([slots.LATER, slots.NORMAL, slots.SCORE, slots.FIRST, slots.NORMAL])
        self.assertEqual(got, [3, 2, 1, 4, 0], 'FIRST, SCORE, NORMAL in arrival order, LATER (the web search, earlier runs\' jobs) last')


class OneClaimPerJob(unittest.TestCase):
    def setUp(self):
        scorer.reset()
        self.addCleanup(scorer.reset)

    def test_a_job_is_taken_once_whoever_asks_first(self):
        self.assertEqual(scorer.claim(['a', 'b']), ['a', 'b'])
        self.assertEqual(scorer.claim(['b', 'c']), ['c'], 'the slice and the scorer never score the same job twice')

    def test_the_ceiling_is_per_run_and_counts_every_claim(self):
        self.assertEqual(scorer.claim(['a', 'b', 'c'], ceiling=4), ['a', 'b', 'c'])
        self.assertEqual(scorer.claim(['d', 'e'], ceiling=4), ['d'], 'score_max (60 in the app) bounds the run, not each caller')
        self.assertEqual(scorer.claim(['f'], ceiling=4), [])


class NextBatch(unittest.TestCase):
    """The scorer takes the jobs the search has landed, best places first, `size` at a time; a job found by an earlier run waits at LATER."""

    def setUp(self):
        import tempfile
        from src import store
        scorer.reset()
        self.addCleanup(scorer.reset)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.db = store.connect(Path(tmp.name) / 'jobs.sqlite')
        self.addCleanup(self.db.close)
        patcher = mock.patch('src.sources.feeds.keep_open', return_value=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def land(self, *ids):
        from src import store
        store.import_watch_report(self.db, {'jobs': [{'company': 'Example', 'id': i, 'title': f'Driver {i}', 'location': 'Sofia', 'url': f'https://x.test/{i}',
                                                       'description': 'A fictional job.'} for i in ids]})

    def pick(self, earlier=frozenset(), size=2, ceiling=60, only_waiting=False):
        return scoring.next_batch(self.db, 'Profile v1', frozenset(), earlier, size, ceiling, only_waiting)

    def test_jobs_landed_while_the_search_runs_are_taken_in_batches_once(self):
        self.land('a', 'b', 'c')
        first, level = self.pick()
        second, _ = self.pick()
        self.assertEqual((len(first), len(second)), (2, 1), 'two, then the third; none twice')
        self.assertEqual(self.pick()[0], [], 'nothing left: the scorer waits for the next landing')
        self.assertEqual(level, slots.SCORE, 'this run\'s own jobs')
        self.land('d')
        self.assertEqual(len(self.pick()[0]), 1, 'a job that lands later is taken without the search asking')

    def test_the_jobs_of_earlier_runs_wait_at_later_so_the_employer_naming_is_not_held(self):
        self.land('old1', 'old2')
        earlier = frozenset(job['id'] for job in __import__('src.daily_helpers', fromlist=['to_score']).to_score(self.db, frozenset()))
        ids, level = self.pick(earlier=earlier, size=5)
        self.assertEqual((len(ids), level), (2, slots.LATER), 'L35 (8 Nov 2026): scoring them before the employers are named left 0 of 561 sites read')

    def test_a_batch_is_never_both_this_runs_jobs_and_earlier_ones(self):
        """Code review of ts: a mixed batch took SCORE for the jobs of earlier runs too, which L35 keeps at LATER. A batch is the head's run of one kind."""
        from src.daily_helpers import to_score
        self.land('old1', 'old2')
        earlier = frozenset(job['id'] for job in to_score(self.db, frozenset()))
        self.land('new1')
        picks = [self.pick(earlier=earlier, size=5) for _ in range(2)]
        for ids, level in picks:
            self.assertIn(len({job_id in earlier for job_id in ids}), (1,), f'one kind per batch: {ids}')
            self.assertEqual(level, slots.LATER if ids[0] in earlier else slots.SCORE)
        taken = [job_id for ids, _ in picks for job_id in ids]
        self.assertEqual((len(taken), len(set(taken))), (3, 3), 'all three, none twice')

    def test_waiting_and_new_jobs_are_one_list_the_nearest_first(self):
        """sf 2/8 (owner, 10 Nov 2026, asked via AskUserQuestion: "One list together (Recommended)": "A near new job is not scored after a far old one")."""
        from src.daily_helpers import to_score
        km = {'old near': 5, 'old far': 500, 'new near': 3, 'new far': 800}
        self.land('old near', 'old far')
        earlier = frozenset(job['id'] for job in to_score(self.db, frozenset()))
        self.land('new near', 'new far')
        title = {job['id']: job['title'][len('Driver '):] for job in to_score(self.db, frozenset())}
        with mock.patch('src.time_budget.best_first', lambda jobs: sorted(jobs, key=lambda job: km[job['title'][len('Driver '):]])):
            picks = [[title[job_id] for job_id in self.pick(earlier=earlier, size=1)[0]] for _ in range(4)]
        self.assertEqual(picks, [['new near'], ['old near'], ['old far'], ['new far']], 'by distance, whichever run found them')

    def test_a_list_that_alternates_kinds_is_scored_in_full_rounds(self):
        """Code review of sf 2/8: a batch was the head's run of one kind, so waiting and new jobs at alternating distances made 8 rounds of 1, a quarter of the AI."""
        from src.daily_helpers import to_score
        self.land('o1', 'o2', 'o3', 'o4')
        earlier = frozenset(job['id'] for job in to_score(self.db, frozenset()))
        self.land('n1', 'n2', 'n3', 'n4')
        km = {f'{kind}{n}': 2 * n + (kind == 'n') for kind in 'on' for n in range(1, 5)}   # o1 n1 o2 n2 ...
        with mock.patch('src.time_budget.best_first', lambda jobs: sorted(jobs, key=lambda job: km[job['title'][len('Driver '):]])):
            sizes = [len(self.pick(earlier=earlier, size=4)[0]) for _ in range(3)]
        self.assertEqual(sizes, [4, 4, 0])

    def test_past_the_end_only_waiting_jobs_are_picked(self):
        from src.daily_helpers import to_score
        self.land('old1')
        earlier = frozenset(job['id'] for job in to_score(self.db, frozenset()))
        self.land('new1')
        ids, level = self.pick(earlier=earlier, size=5, only_waiting=True)
        self.assertEqual((len(ids), ids[0] in earlier, level), (1, True, slots.LATER))

    def test_twelve_jobs_landing_over_the_search_are_all_scored_not_three(self):
        """The owner's scenario (night 9 Nov: 73-204 jobs in the places, 3 scored): jobs land source by source while the scorer polls; every one is scored once."""
        scored, stop, landing = [], threading.Event(), [['a', 'b', 'c', 'd', 'e'], [], ['f', 'g'], ['h', 'i', 'j', 'k', 'l']]
        def poll(over=False):
            if landing:
                self.land(*landing.pop(0))
            ids, level = self.pick(size=4, only_waiting=over)
            return ids, level
        def score_batch(ids, level):
            scored.extend(ids)
            return True
        scoring.drain(stop, poll, score_batch, lambda: not landing and len(scored) >= 12, pause=lambda: None)
        self.assertEqual(len(scored), 12)
        self.assertEqual(len(set(scored)), 12, 'none twice')

    def test_the_ceiling_stops_the_scorer(self):
        self.land('a', 'b', 'c')
        self.assertEqual(len(self.pick(size=5, ceiling=2)[0]), 2)
        self.assertEqual(self.pick(size=5, ceiling=2)[0], [])


class TheLoop(unittest.TestCase):
    def test_it_scores_every_batch_until_stopped_and_waits_when_nothing_landed(self):
        stop, batches, scored, waited = threading.Event(), [['a', 'b'], [], ['c']], [], []
        def next_batch(over=False):
            return (batches.pop(0), slots.SCORE) if batches else ([], slots.SCORE)
        def score_batch(ids, level):
            scored.append(ids)
            if not batches:
                stop.set()
        scoring.drain(stop, next_batch, score_batch, lambda: False, pause=lambda: waited.append(1))
        self.assertEqual(scored, [['a', 'b'], ['c']])
        self.assertEqual(waited, [1], 'one wait, for the empty poll')

    def test_a_round_that_scored_nothing_ends_it(self):
        """The AI down or a paused Profile: the claims are not given back, so looping would burn the run's ceiling in seconds (code review of ts)."""
        rounds = []
        scoring.drain(threading.Event(), lambda over: (['a'], slots.SCORE), lambda ids, level: rounds.append(ids) or False, lambda: False)
        self.assertEqual(rounds, [['a']])

    def test_it_ends_with_the_runs_time(self):
        scored = []
        scoring.drain(threading.Event(), lambda over: (['a'], slots.SCORE), lambda ids, level: scored.append(ids), lambda: True)
        self.assertEqual(scored, [], 'ended(): no new batch starts')

    def test_a_stop_before_the_first_pick_starts_nothing_when_nothing_is_owed(self):
        """Code review of sf 2/8: the first pick ignored a stop already set."""
        stop, picks = threading.Event(), []
        stop.set()
        scoring.drain(stop, lambda over: picks.append(over) or (['a'], slots.SCORE), lambda ids, level: True, lambda: False)
        self.assertEqual(picks, [])

    def test_owed_waiting_jobs_are_scored_past_the_end_and_nothing_else(self):
        """L13: the waiting jobs the clock allowed at the start are scored in this run even when the search spends the clock at once; past the end only those."""
        owed, asked, waiting = [3], [], [['w1', 'w2'], ['w3']]
        def next_batch(over):
            asked.append(over)
            return (waiting.pop(0), slots.LATER) if waiting else ([], slots.SCORE)
        def score_batch(ids, level):
            owed[0] -= len(ids)
            return True
        scoring.drain(threading.Event(), next_batch, score_batch, lambda: True, owing=lambda: owed[0] > 0)
        self.assertEqual((owed[0], asked), (0, [True, True]), 'two picks of waiting jobs only, then paid')



class TheThreadBesideTheSearch(unittest.TestCase):
    """The call that ends the scorer: bounded by the run's end, and its counts and the slice's claims survive a scorer that died (code review of ts)."""

    def setUp(self):
        import tempfile
        from src.stores import memory
        scorer.reset()
        self.addCleanup(scorer.reset)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path, self.stores = Path(tmp.name) / 'jobs.sqlite', memory.open_store()

    def test_it_does_not_wait_past_the_runs_end_for_a_round_slow_behind_the_ai_slots(self):
        import time
        release, said = threading.Event(), []
        self.addCleanup(release.set)
        finish = scoring._beside(self.path, self.stores, lambda db, stores: release.wait(10), threading.Event(), wait=lambda: 0.2, counts=lambda: said.append('counts'))
        began = time.monotonic()
        finish()
        self.assertLess(time.monotonic() - began, 2, 'the join gave up at the run\'s end; the 3 minutes hold')
        self.assertEqual(said, ['counts'], 'the counts so far are said all the same')

    def test_a_round_that_ends_after_the_join_gave_up_does_not_touch_the_runs_dict(self):
        """Gitar on #3649: a late round popped run['score'] while the closing pass owned it (doubled totals, or a KeyError and a lost count)."""
        from types import SimpleNamespace
        release, in_round = threading.Event(), threading.Event()
        self.addCleanup(release.set)
        run, args = {'warnings': []}, SimpleNamespace(mode='run', score_max=10, db=self.path)
        clock = mock.Mock(batch=lambda *a, **k: 1, end=lambda: 1.0, now=lambda: 1.0, ended=lambda: False)   # the run's end is now: the join gives up at once

        def late_round(args, stores, db, round_run, *rest, **kw):
            in_round.set()
            release.wait(10)
            round_run['score'] = {'done': 5, 'pending': 5}
            round_run['warnings'].append('a late warning')
        with mock.patch.object(scoring, 'score_candidates', side_effect=late_round), mock.patch.object(scoring, 'sync_partial'), \
                mock.patch.object(scoring, 'time_budget_on', return_value=True), mock.patch.object(scoring, 'next_batch', side_effect=itertools.chain([([1], slots.LATER)], itertools.repeat(([], slots.SCORE)))), \
                mock.patch.object(scoring.score, 'queue', return_value=[{'id': 1}]), mock.patch.object(scoring, 'to_score', return_value=[]), \
                mock.patch.object(scoring, '_stay', return_value=[]):
            finish = scoring.score_beside(args, self.stores, mock.Mock(), run, lambda: 'Profile v1', frozenset(), frozenset(), clock)
            self.assertTrue(in_round.wait(5), 'the scorer is in its round')
            finish()
            run['score'] = {'done': 1, 'pending': 1}   # the closing pass owns it now
            release.set()
            for thread in threading.enumerate():
                if thread.name == 'scorer':
                    thread.join(5)
        self.assertEqual(run['score'], {'done': 1, 'pending': 1}, 'the late round neither doubled nor popped the closing pass\'s count')
        self.assertEqual(run['warnings'], [], 'nor added to the run\'s warnings')

    def test_at_the_first_import_the_rounds_in_flight_start_together_from_the_head_of_the_list(self):
        """sa's Mac runs (10 Nov 2026, main vs the first build of sf 2/8): one round at a time scored 27 jobs where main's two scorers scored 43 (p9, p5, p13).
        IN_FLIGHT rounds start in the same tick, each the next BATCH of the one ranked list, no job in two rounds."""
        from types import SimpleNamespace
        ranked = [{'id': n} for n in range(1, 4 * scoring.BATCH + 1)]
        together, rounds = threading.Barrier(scoring.IN_FLIGHT, timeout=5), []

        def a_round(args, stores, db, round_run, profile, hidden, dismissed, ids, *rest, **kw):
            rounds.append(sorted(ids))
            together.wait()   # broken (BrokenBarrierError) unless every round in flight started before any ended
            round_run['score'] = {'done': len(ids), 'pending': 0}
        args = SimpleNamespace(mode='run', score_max=len(ranked), db=self.path)
        clock = mock.Mock(batch=lambda *a, **k: 0, end=lambda: None, now=lambda: 1.0, ended=lambda: False)
        with mock.patch.object(scoring, 'score_candidates', side_effect=a_round), mock.patch.object(scoring, 'sync_partial'), \
                mock.patch.object(scoring, 'time_budget_on', return_value=True), mock.patch.object(scoring.score, 'queue', return_value=ranked), \
                mock.patch.object(scoring, 'to_score', return_value=[]), mock.patch.object(scoring, '_stay', return_value=[]), mock.patch('builtins.print'):
            finish = scoring.score_beside(args, self.stores, mock.Mock(), {'warnings': []}, lambda: 'Profile v1', frozenset(), frozenset(), clock)
            for _ in range(100):
                if together.broken or len(rounds) == len(ranked) // scoring.BATCH:
                    break
                threading.Event().wait(0.05)
            finish()
        self.assertGreaterEqual(scoring.IN_FLIGHT, 2, 'the budget row keeps more than one round in flight')
        self.assertFalse(together.broken, 'every round in flight started before any ended')
        ids = [job['id'] for job in ranked]
        heads = [ids[i * scoring.BATCH:(i + 1) * scoring.BATCH] for i in range(scoring.IN_FLIGHT)]
        self.assertEqual(sorted(rounds[:scoring.IN_FLIGHT]), heads, 'the first rounds are the head of the list, BATCH each')
        self.assertEqual(sorted(job_id for one in rounds for job_id in one), ids, 'every job scored once, none in two rounds')

    def test_a_scorer_that_died_leaves_the_slice_no_one_to_defer_to(self):
        scorer.begin()
        def work(db, stores):
            raise RuntimeError('database is locked')
        finish = scoring._beside(self.path, self.stores, work, threading.Event())
        with mock.patch('builtins.print'):
            finish()
        self.assertFalse(scorer.shared(), 'the slice goes on by its old rule')


if __name__ == '__main__':
    unittest.main()
