"""Every source lane of a press reads at the same time and ends in one said state (lanes 1/5, issue #3754; design: WP8 of
docs/superpowers/specs/2026-11-10-find-jobs-finish-line.md, the lane table in src/sources/reader_rows.py LANES).
Why (sf, 10-11 Nov 2026): the sources took turns on one 3-minute clock, so the last ones got nothing: job boards ran out of time on 27 of 32 first presses
and the free job APIs on 28 of 32 (yardstick replays of the night recordings), on every repeat press, and on 18 of 18 people in the live run 42897831935.
The search runs through the real search harness (tests/unit/ai/test_daily_search_phases.py) with the real starters of each source; only each lane's reader is
a stand-in that says it has started and then waits until every lane has started. A state decides the verdict, never a second count: time is a hang guard only,
and the time-up case moves the stand-in clock instead of waiting for it."""
import threading
import time
import unittest
from unittest import mock

from src import daily_search, first_jobs, time_budget
from src.ai import board_ideas
from src.press import stage, step_yield
from src.sources import aggregators, board_web, boards_ahead, boards_first, eures, feed_scan, found_boards, reader_rows
from tests.unit.ai import test_daily_search_phases as phases

GUARD_S = 60   # a hang guard only: every lane starts within milliseconds of the press once none waits for another
MONOTONIC = time.monotonic   # the real clock, for the hang guard: the test moves the stand-in clock the search reads
# The real starters the harness replaces with stand-ins; this test puts them back (taken before any test patches them).
REAL = {(board_web, 'early'): board_web.early, (eures, 'start_early'): eures.start_early, (boards_first, 'run'): boards_first.run,
        (boards_first, 'Beside'): boards_first.Beside, (first_jobs, 'propose_early'): first_jobs.propose_early, (first_jobs, 'run'): first_jobs.run,
        (boards_ahead, 'scan_beside'): boards_ahead.scan_beside, (aggregators, 'scan'): aggregators.scan}
# Each source lane that is on in this search -> its reader's seam. boards_found waits for board_web by design (its declared need) and is not held here.
SEAMS = {'eures': (eures, 'eures'), 'employer_sites': (feed_scan, 'scan'), 'job_boards': (found_boards, 'read'),
         'free_job_apis': (aggregators, 'arbeitnow'), 'board_web': (board_web, 'search')}


class Lanes:
    """The stand-in readers: each says it has started, then waits until every lane has started (or the hang guard ends)."""

    def __init__(self, names):
        self.names, self.started, self.finished_first = set(names), set(), None
        self.all_in, self.lock, self.until = threading.Event(), threading.Lock(), None

    def reader(self, lane, then):
        def read(*args, **kwargs):
            if lane == 'job_boards' and kwargs.get('early'):   # the boards the web search found: boards_found's read, which waits by design
                return []
            with self.lock:
                self.started.add(lane)
                if self.started >= self.names:
                    self.all_in.set()
                self.until = self.until or MONOTONIC() + GUARD_S   # one hang guard for the whole press, not one per reader
            self.all_in.wait(max(0.0, self.until - MONOTONIC()))
            with self.lock:
                if self.finished_first is None:
                    self.finished_first = (lane, sorted(self.started))
            return then(*args, **kwargs)
        return read


class LanesTest(phases.SearchCharacterization):
    @unittest.expectedFailure   # Why (lanes 1/5, #3754): red today, the ratchet's mark: lanes 3/5 makes it pass and removes this line
    def test_every_source_lane_is_reading_before_any_has_finished_and_each_ends_done_time_up_or_failed(self):
        lanes, jumped = Lanes(SEAMS), [0.0]
        real_monotonic = time.monotonic
        employer = {'jobs': [], 'sources': [], 'funnel': {}}

        def jump(*args, **kwargs):   # the job boards read past the read's cut: the stand-in clock moves, nothing waits
            jumped[0] = 10_000.0
            return []

        def refuse(*args, **kwargs):
            raise RuntimeError('the API refused')

        then = {'eures': lambda *a, **k: [], 'employer_sites': lambda *a, **k: dict(employer), 'job_boards': jump, 'free_job_apis': refuse,
                'board_web': lambda *a, **k: {}}
        patches = [mock.patch.object(owner, name, real) for (owner, name), real in REAL.items()]
        patches += [mock.patch.object(owner, name, lanes.reader(lane, then[lane])) for lane, (owner, name) in SEAMS.items()]
        patches += [mock.patch.dict('os.environ', {'JOBADABRA_EURES': '1'}),   # EURES is a lane like any other here, behind its own gate
                    mock.patch.object(board_ideas, 'asked_for', return_value=['site reliability boards']),
                    mock.patch.object(time_budget.time, 'monotonic', side_effect=lambda: real_monotonic() + jumped[0])]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        time_budget.start(180)
        self.run_search(first_jobs=False)
        self.assertTrue(lanes.all_in.is_set(), f'every source lane started before any finished; started: {sorted(lanes.started)}, '
                                               f'first to finish: {lanes.finished_first}')
        ended = step_yield.ended()   # each lane's one said state (design rule 4): a stage.Result per lane id
        self.assertEqual({lane: ended[lane].status for lane in SEAMS}, {'eures': stage.DONE, 'employer_sites': stage.DONE, 'board_web': stage.DONE,
                                                                        'job_boards': stage.CUT, 'free_job_apis': stage.FAILED})
        self.assertIn('wait', ended['job_boards'].reason, 'a lane cut by the clock says what waits')
        self.assertEqual(ended['free_job_apis'].reason, 'RuntimeError')
        self.assertLessEqual(set(SEAMS), set(reader_rows.BY_LANE), 'every lane here is a lane of the table')


for _name in [name for name in dir(phases.SearchCharacterization) if name.startswith('test_') and name not in LanesTest.__dict__]:
    setattr(LanesTest, _name, None)   # the harness's own tests run in their own file


if __name__ == '__main__':
    unittest.main()
