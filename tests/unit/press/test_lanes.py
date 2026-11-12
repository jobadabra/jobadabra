"""Every source lane of a press reads at the same time (lanes 1/5, issue #3754; design: WP8 of
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

from src import daily_search, first_jobs, read_methods, time_budget
from src.ai import board_ideas
from src.sources import aggregators, board_web, boards_ahead, boards_first, eures, feed_scan, feeds, found_boards, national, reader_rows
from tests.unit.ai import test_daily_search_phases as phases
from src.press import stage

GUARD_S = 15   # a hang guard only: every lane starts within milliseconds of the press once none waits for another (the red run waits it out once)
MONOTONIC = time.monotonic   # the real clock, for the hang guard: the test moves the stand-in clock the search reads
# The real starters the harness replaces with stand-ins; this test puts them back (taken before any test patches them).
REAL = {(board_web, 'early'): board_web.early, (eures, 'start_early'): eures.start_early,
        (boards_first, 'Beside'): boards_first.Beside, (first_jobs, 'propose_early'): first_jobs.propose_early, (first_jobs, 'run'): first_jobs.run,
        (boards_ahead, 'scan_beside'): boards_ahead.scan_beside, (aggregators, 'scan'): aggregators.scan,
        (daily_search, 'start_apis'): daily_search.start_apis}
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
    def test_every_source_lane_is_reading_before_any_has_finished_and_each_ends_in_one_said_state(self):
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
                    *[mock.patch.object(aggregators, api, side_effect=refuse) for api in ('himalayas', 'jobicy', 'jobsch')],   # every free API a stand-in: no live site
                    mock.patch.object(national, 'read', side_effect=refuse),   # the national services too (src/sources/national.py)
                    mock.patch.object(aggregators, 'technical_search', return_value=True),   # Jobicy is asked too (IT searches only)
                    mock.patch.object(time_budget.time, 'monotonic', side_effect=lambda: real_monotonic() + jumped[0])]
        # Why (lanes 1/5, #3780's CI): the real starters turn the search's own tallies on; left so, they broke the next tests in the same process
        patches += [mock.patch.dict(read_methods._state)] + [mock.patch.object(feeds, name, getattr(feeds, name)) for name in ('PLACED', 'READ', 'TRIAGED')]
        scans, real_scan = [], REAL[(aggregators, 'scan')]   # the real stage (the harness swaps in a stand-in)
        patches += [mock.patch.object(aggregators, 'scan', side_effect=lambda *a, **k: scans.append(real_scan(*a, **k)) or scans[-1])]   # what the APIs' stage reports
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        time_budget.start(180)
        self.run_search(first_jobs=False)
        self.assertIn('employer_sites', lanes.started, 'positive control: the search reached the stand-in readers')
        self.assertTrue(lanes.all_in.is_set(), f'every source lane started before any finished; started: {sorted(lanes.started)}, '
                                               f'first to finish: {lanes.finished_first}')
        self.assertLessEqual(set(SEAMS), set(reader_rows.BY_LANE), 'every lane here is a lane of the table')
        said = [found['said'] for found in scans if 'said' in found]   # the lane's one said state (design rule 4): done / cut, saying what waits / failed, why
        self.assertEqual(said, [stage.Result(stage.FAILED, 'RuntimeError')], 'a reader that raises is its lane failing, never the run')


for _name in [name for name in dir(phases.SearchCharacterization) if name.startswith('test_') and name not in LanesTest.__dict__]:
    setattr(LanesTest, _name, None)   # the harness's own tests run in their own file


if __name__ == '__main__':
    unittest.main()
