"""The first job waits for ONE batch of titles, not for a reader's whole sort (#2918; owner, 6 Nov 2026: "Score from the nearest batches as they land"). The
slice's thread is the hub: the employer sites' sorted batches and the other readers' jobs reach scoring as they land, nearest first, each job imported and
scored once. A slow sort here is a reader whose later batches never end until a job was scored. Tests: this file, tests/unit/ai/test_title_queue.py."""
import threading
import unittest
from unittest import mock

from src import first_jobs
from src.ai import title_queue
from src.sources import careers

_READER = careers.READER
WAIT = 20   # a hang guard only: the test releases the sort itself


def setUpModule():   # no page read reaches a real model from this file (tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def job(name, url=None):
    return {'id': name, 'title': 'Engineer', 'company': name, 'location': 'Town', 'url': url or f'https://x/{name}', 'status': 'new',
            'date_posted': '', 'description': '', 'remote': False, 'salary': ''}


NEAR, FAR, SAME = job('near'), job('far'), job('same', 'https://x/same')


class Slice:
    """One press of the slice with fakes: `scan` and `boards` as given; the job store is the list of jobs imported; the scorer records which it scored."""

    def __init__(self, scan, boards, kept=None, fits=None):
        self.imported, self.scored, self.events, self.said = [], [], [], []
        self.scan, self.boards, self.kept, self.fits = scan, boards, kept or (lambda feed_db, name, found, shown=None: list(found)), fits or (lambda db: {})

    def scorer(self, db, candidates, profile, model, max_jobs, workers=5, stats=None, on_scored=None, every=10, only_ids=None, **kw):
        self.scored.extend(sorted(only_ids))
        self.events.append(f'scored {sorted(only_ids)}')
        stats.update(done=len(only_ids))

    def import_jobs(self, report):
        self.imported.extend(j['id'] for j in report['jobs'])
        self.store = [{'id': j['id'], 'company': j['company'], 'title': j['title'], 'location': j['location']} for j in getattr(self, 'store', [])]
        self.store += [{'id': j['id'], 'company': j['company'], 'title': j['title'], 'location': j['location']} for j in report['jobs']]

    def run(self, others=None):
        self.store = []
        with mock.patch.object(first_jobs.score, 'queue', side_effect=lambda *a, **k: [j for j in self.store if j['id'] not in self.scored]), \
                mock.patch.object(first_jobs, 'to_score', return_value=[]), mock.patch.object(first_jobs, 'aggregators_kept', side_effect=self.kept):
            return first_jobs.run(mock.MagicMock(), mock.MagicMock(), [{'company': 'A', 'ats': 'greenhouse', 'slug': 'a'}], profile='p', hidden=frozenset(),
                                  sync=lambda: None, say=self.said.append, scan=self.scan, scorer=self.scorer, fits=self.fits, boards=self.boards,
                                  import_jobs=self.import_jobs, others=others or {})


def sort(batches, ask, land):
    """What a reader's title sort does (src/ai/title_queue.py): batches [(key, titles)] asked in the queue, landed in this thread."""
    title_queue.serve(batches, ask, land, 2)


class TheFirstJobNeedsOneBatch(unittest.TestCase):
    def test_a_job_of_the_first_landed_batch_is_scored_before_the_readers_sort_ends(self):
        scored, ended = threading.Event(), []

        def scan(sources, feed_db, on_sorted=None, **kw):
            report = {'jobs': [dict(NEAR), dict(FAR)], 'sources': []}
            if on_sorted is None:   # main: the jobs reach scoring only after the whole sort
                return report

            def ask(titles):
                if titles == ['far']:
                    scored.wait(WAIT)   # the far batch is slow: it ends only after a job was scored
                return {'fit': titles}
            sort([((0, 1.0), ['near']), ((1, 900.0), ['far'])], ask, lambda titles, result: on_sorted([dict({'near': NEAR, 'far': FAR}[titles[0]])]))
            ended.append(True)
            return report
        run = Slice(scan, lambda say: [])
        original = run.scorer

        def scorer(*args, **kwargs):
            original(*args, **kwargs)
            if not ended:
                scored.set()   # a score while the sort still runs
        run.scorer = scorer
        run.run()
        self.assertTrue(scored.is_set(), 'a job was scored while the reader\'s sort still ran')
        self.assertEqual(run.events[0], "scored ['near']", 'the nearest job was scored first, before the far batch ended')

    def test_another_readers_nearest_batch_is_scored_before_the_employer_sort_ends(self):
        """The owner's scenario: the employer sites' far batches are slow; the boards' near batch must reach scoring first."""
        scored, ended = threading.Event(), []

        def scan(sources, feed_db, on_sorted=None, **kw):
            def ask(titles):
                scored.wait(WAIT)   # every employer batch ends only after a score from another reader
                return {'fit': titles}
            sort([((1, 900.0), ['far'])], ask, lambda titles, result: None)
            ended.append(True)
            return {'jobs': [dict(FAR)], 'sources': []}

        def kept(feed_db, name, found, shown=None):   # the boards' sort: its near batch lands first and its jobs are handed on
            hand = title_queue.handing()
            sort([((0, 5.0), ['near'])], lambda titles: {'fit': titles}, lambda titles, result: hand([dict(NEAR)]))
            return [dict(NEAR)]
        run = Slice(scan, lambda say: [dict(NEAR)], kept)
        original = run.scorer

        def scorer(*args, **kwargs):
            original(*args, **kwargs)
            if not ended:
                scored.set()
        run.scorer = scorer
        run.run()
        self.assertTrue(scored.is_set(), 'the boards\' job was scored while the employer sites\' sort still ran')
        self.assertEqual(run.events[0], "scored ['near']", run.events)

    def test_a_job_two_readers_find_is_imported_and_scored_once(self):
        def scan(sources, feed_db, on_sorted=None, **kw):
            if on_sorted:
                on_sorted([dict(SAME)])
            return {'jobs': [dict(SAME)], 'sources': []}

        def kept(feed_db, name, found, shown=None):
            title_queue.handing()([dict(SAME)])
            return [dict(SAME)]
        run = Slice(scan, lambda say: [dict(SAME)], kept)
        run.run()
        self.assertEqual(run.imported, ['same'], 'imported once')
        self.assertEqual(run.scored, ['same'], 'scored once')


    def test_a_reader_still_reading_when_the_slice_ends_is_left_to_the_full_search(self):
        """Gitar on #3336: the slice never waits for a slow EURES; the full crawl starts at once."""
        import time
        from concurrent.futures import Future
        run = Slice(lambda sources, feed_db, **kw: {'jobs': [dict(NEAR)], 'sources': []}, lambda say: [])
        slow = Future()   # never set: a read that has not ended
        began = time.monotonic()
        with mock.patch('src.sources.read_budget.cut_at', lambda: time.monotonic() + 0.5):   # the read cut of a timed press
            run.run(others={'EURES': slow})
        self.assertLess(time.monotonic() - began, 5, 'the slice did not wait for the reader still reading')
        self.assertFalse(slow.done())
        self.assertEqual(run.scored, ['near'])


    def test_the_slices_look_at_the_early_eures_read_leaves_it_for_the_free_api_stage(self):
        """Gitar on #3336: the slice's thread popped the early read, so a slice that ended first made the free-API stage read EURES again."""
        from concurrent.futures import ThreadPoolExecutor
        from src.sources import eures
        seen = []
        with mock.patch.object(eures, 'early', return_value=object()), mock.patch.object(eures, 'read', side_effect=lambda search, keep=False: seen.append(keep) or []), \
                mock.patch('src.paths.load_search_config', return_value={}), mock.patch.object(first_jobs, 'placed', side_effect=lambda jobs: jobs):
            pool = ThreadPoolExecutor(max_workers=1)
            futures = first_jobs._others(pool)
            futures['EURES'].result(10)
            pool.shutdown()
        self.assertEqual(seen, [True], 'read with keep=True: the early read stays in place')


    def test_a_reader_that_has_read_is_sorted_before_the_next_score_starts(self):
        """Night p1 Sofia: EURES was read at 73 s but the hub scored its employer jobs first (31 s on a slow AI) and took EURES at 112 s, past every clock. One owner of the order:
        the hub looks at a reader that has read before it starts a score (the boards stand in for EURES: the same `_Readers` path)."""
        import time

        def scan(sources, feed_db, on_sorted=None, **kw):   # the employer scan ends only once the boards' hand-over is waiting for the hub
            hub, end = title_queue.current_hub(), time.monotonic() + WAIT
            while hub.box.qsize() == 0 and time.monotonic() < end:
                time.sleep(0.005)   # a hang guard, the state waited for is the posted message
            self.assertGreater(hub.box.qsize(), 0, 'positive control: the boards had read')
            return {'jobs': [dict(FAR)], 'sources': []}
        run = Slice(scan, lambda say: [dict(NEAR)])
        run.run()
        self.assertEqual(run.events[0], "scored ['far', 'near']", f'both jobs were there before the first score: {run.events}')

    def test_a_reader_joined_while_another_joins_at_the_end_does_not_stop_the_slice(self):
        """Night 9 Nov 2026, p1 (run 42537909472, 105 s): "Warning: first jobs skipped: KeyError: 'EURES'". At the slice's end both readers had read; joining the boards
        hands their jobs on, the score step's look at the hub (`before`, #3339) joins EURES meanwhile, and the end's own list still named it. The slice then stopped
        before its closing "First jobs: N found" line, the one the app closes the first-jobs card on."""
        from concurrent.futures import Future
        boards, eu = Future(), Future()
        boards.set_result([dict(NEAR)])
        eu.set_result([dict(FAR)])
        joined = []
        with title_queue.hub() as hub:
            readers = None

            def hand(items):   # what the slice's hand does: a score step, which first looks at the hub (_Scoring.step -> before -> take_ready)
                readers.take_ready()

            def take(name, future, shown):
                joined.append(name)
                return future.result()
            readers = first_jobs._Readers(hub, {'boards': boards, 'EURES': eu}, None, first_jobs._Imports(lambda report: None), hand, lambda line: None)
            with mock.patch.object(readers, '_take', side_effect=take):
                self.assertEqual(hub.box.qsize(), 2, 'positive control: both readers had read and wait in the hub')
                readers.finish()
        self.assertEqual(sorted(joined), ['EURES', 'boards'], 'each reader joined once')
        self.assertEqual(readers.pending, {})

if __name__ == '__main__':
    unittest.main()
