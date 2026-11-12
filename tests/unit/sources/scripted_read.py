"""A scripted clock and pool for tests of the read budget: time moves only when a test says so, a site that never answers is a future that never ends.
Why (E2b, 8 Nov 2026; #3620 for test_read_budget.py): a test that sleeps, runs a thread pool and asserts `took < N` on the wall clock gives a different
result on a loaded runner, with the code unchanged. What those tests prove is what the code DECIDES at the cut (which site starts, which is left,
whether the pool is waited for), and that is a function of the clock and of what each site does, so both are scripted here. Real threads stay in
tests/unit/ai/test_three_minutes_resume.py and desktop/integration; nothing here sleeps, starts a thread or reads the real time."""
from concurrent.futures import Future
from types import SimpleNamespace
from unittest import mock

from src.press import clock as press_clock
from src.sources import feed_scan, found_boards, read_budget


class Clock:
    """Where the run's time stands. `spend` is the only thing that moves it; `wall` is the epoch second the press began (JOBADABRA_SEARCH_AT)."""
    def __init__(self, now=1000.0, wall=0.0):
        self.now, self.wall = now, wall

    def monotonic(self):
        return self.now

    def time(self):
        return self.wall

    def spend(self, seconds):
        self.now += seconds
        self.wall += seconds


class Hangs(BaseException):
    """Raised by a fake site that does not answer in time (a BaseException: the read code that catches a failed read must not catch this one). `answer` (a function) is what it gives if the test lets it end later."""
    def __init__(self, answer=lambda: None):
        super().__init__('the site is still open')
        self.answer = answer


class StillOpen(Future):
    """A read that has not ended. Waiting for it with a time costs that time on the clock and times out; waiting with no limit is what a cut exists to
    prevent, so it fails the test at once (the old code waited, for minutes) unless the test says the run has no budget (`patient`: the site answers
    while it is waited for). `release()` lets it end late, as a real site's answer does."""
    patient = False

    def __init__(self, clock, answer):
        super().__init__()
        self.clock, self.answer = clock, answer

    def result(self, timeout=None):
        if not self.done() and timeout is None and StillOpen.patient:
            self.release()
        if self.done():
            return super().result(0)
        assert timeout is not None, 'the code waits with no limit for a site that has not answered'
        self.clock.spend(timeout)
        raise TimeoutError()

    def release(self):
        self.set_result(self.answer())


class Pool:
    """Stands in for ThreadPoolExecutor: runs each job at once in the caller's thread. `open` lists the reads left open; `waited` is how each pool was shut down."""
    open, waited = [], []
    clock = None

    def __init__(self, *args, **kwargs):
        pass

    def submit(self, fn, *args, **kwargs):
        try:
            future = Future()
            future.set_result(fn(*args, **kwargs))
        except Hangs as hang:
            future = StillOpen(Pool.clock, hang.answer)
            Pool.open.append(future)
        except BaseException as error:  # noqa: BLE001 — what the pool would have held for the caller
            future = Future()
            future.set_exception(error)
        return future

    def shutdown(self, wait=True, cancel_futures=False):
        Pool.waited.append(wait)


def wait(futures, timeout=None, return_when=None):
    """concurrent.futures.wait on the script: the ones that ended, or (none ended) the time it would wait, spent."""
    if timeout is None and StillOpen.patient:
        for future in futures:
            if not future.done():
                future.release()
    done = {future for future in futures if future.done()}
    if not done and futures:
        assert timeout is not None, 'the code waits with no limit for a site that has not answered'
        Pool.clock.spend(timeout)
    return done, set(futures) - done


def install(case, clock):
    """Patch the run's clock and its two pools (and their waits) for one test case; undone at its end."""
    Pool.open, Pool.waited, Pool.clock, StillOpen.patient = [], [], clock, False
    scripted = SimpleNamespace(monotonic=clock.monotonic, time=clock.time)
    for patch in (mock.patch.object(press_clock, 'time', scripted), mock.patch.object(feed_scan, 'ThreadPoolExecutor', Pool),
                  mock.patch.object(feed_scan, 'wait', wait), mock.patch.object(found_boards, 'ThreadPoolExecutor', Pool),
                  mock.patch.object(read_budget, 'wait', wait)):   # the boards' read takes each board as it ends (read_budget.as_done)
        patch.start()
        case.addCleanup(patch.stop)
    return Pool
