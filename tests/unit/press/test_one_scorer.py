"""One scorer per Find jobs run (ts, 10 Nov 2026; owner asked via AskUserQuestion, "Yes, build it (Recommended)"; night 9 Nov, run 42537909472: 18 personas scored a
median of 3 jobs on press 1 although 73-204 jobs were in their places; "No time left in this refresh to score any: N job(s)" at 105-163 s in 14 of 18).
Design: a job is Listed (a reader), Placed (place_triage), Kept (title sorting), Scored (the one scorer). The scorer starts at the first Kept job on every press, first
included, runs beside the readers and stops at the run's end minus TAIL; the job facts take only what scoring leaves; the slice scores `first` jobs once and the scorer
goes on; AI calls: first press's local reads > scoring of this run's jobs > the rest > the jobs of earlier runs (LATER) > the web search.
Guard: release - what a first Find jobs run gives the person in its 3 minutes."""
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

    def pick(self, earlier=frozenset(), size=2, ceiling=60):
        return scoring.next_batch(self.db, 'Profile v1', frozenset(), earlier, size, ceiling)

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

    def test_the_ceiling_stops_the_scorer(self):
        self.land('a', 'b', 'c')
        self.assertEqual(len(self.pick(size=5, ceiling=2)[0]), 2)
        self.assertEqual(self.pick(size=5, ceiling=2)[0], [])


class TheLoop(unittest.TestCase):
    def test_it_scores_every_batch_until_stopped_and_waits_when_nothing_landed(self):
        stop, batches, scored, waited = threading.Event(), [['a', 'b'], [], ['c']], [], []
        def next_batch():
            return (batches.pop(0), slots.SCORE) if batches else ([], slots.SCORE)
        def score_batch(ids, level):
            scored.append(ids)
            if not batches:
                stop.set()
        scoring.drain(stop, next_batch, score_batch, lambda: False, pause=lambda: waited.append(1))
        self.assertEqual(scored, [['a', 'b'], ['c']])
        self.assertEqual(waited, [1], 'one wait, for the empty poll')

    def test_it_ends_with_the_runs_time(self):
        scored = []
        scoring.drain(threading.Event(), lambda: (['a'], slots.SCORE), lambda ids, level: scored.append(ids), lambda: True)
        self.assertEqual(scored, [], 'ended(): no new batch starts')


if __name__ == '__main__':
    unittest.main()
