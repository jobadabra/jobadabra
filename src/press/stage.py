"""What one stage of a Find jobs run leaves: done, cut by the clock or failed, with its reason, its items and its seconds (contract C2 of
docs/superpowers/specs/2026-11-10-find-jobs-code-shape.md). Why (cr 1/5, 10 Nov 2026): a stage that failed inside a catch-all looked like a
stage that found 0 jobs, so one session's error read as another's empty result. The runner that makes these (its one catch-all records failed
and the reason on the Run) is session sf's 7/8; this file is only the shape, so sf and the readers (cr 2/5-4/5) build on the same one.
`guard` is the search path's one catch-all (sa, 10 Nov 2026, option d): a block that fails lets the run go on, as the catch-alls it replaces
did, and its failure is counted on the run's details (where, the error's type), so a failure is no longer a silent "0 jobs"; each site keeps
its own warning line and fallback. tests/guards/rules/test_catch_alls_only_shrink.py counts the raw catch-alls left outside this file.
Invariants: status is one of STATUSES; a failed Result names its reason; guard catches Exception only (never BaseException) and records no
word of the error (it can hold a page's URL)."""
import contextlib
from dataclasses import dataclass

DONE = 'done'
CUT = 'cut'   # stopped by the run's clock: what it had is kept, the rest waits
FAILED = 'failed'
STATUSES = (DONE, CUT, FAILED)


@dataclass(frozen=True)
class Result:
    """One stage's result: `items` what it leaves for the next (jobs, scores...), `seconds` its wall time, `reason` why it was cut or failed."""
    status: str
    reason: str = ''
    items: tuple = ()
    seconds: float = 0.0

    def __post_init__(self):
        if self.status not in STATUSES:
            raise ValueError(f'a stage result is one of {STATUSES}, not {self.status!r}')
        if self.status == FAILED and not self.reason:
            raise ValueError('a failed stage names its reason')


class Caught:
    """What a guard caught: `error`, the exception, or None when the block ran through (truthy when it caught one); `reason`, its type's name
    (a failed Result's reason), '' when none."""
    __slots__ = ('error', 'reason')

    def __init__(self):
        self.error = None
        self.reason = ''

    def __bool__(self):
        return self.error is not None


@contextlib.contextmanager
def guard(where, details=None):
    """Runs the block; an Exception in it is caught, counted on the run's details under `where` (a fixed name, never a URL) and its type,
    and left in the Caught it yields, for the caller's own warning line and fallback. details: the Run's details (default: run_details)."""
    caught = Caught()
    try:
        yield caught
    except Exception as error:  # noqa: BLE001 — the search path's one catch-all: the run goes on, the failure is counted (C2)
        caught.error, caught.reason = error, 'TimeoutError' if isinstance(error, TimeoutError) else type(error).__name__   # Why (14 Nov 2026, Gitar on #4177): a TimeoutError subclass (sources.board_round_log.Stalled) counts under the old word, so failure counts do not split
        if details is None:
            from .. import run_details as details
        details.failed(where, caught.reason)
