"""What one stage of a Find jobs run leaves: done, cut by the clock or failed, with its reason, its items and its seconds (contract C2 of
docs/superpowers/specs/2026-11-10-find-jobs-code-shape.md). Why (cr 1/5, 10 Nov 2026): a stage that failed inside a catch-all looked like a
stage that found 0 jobs, so one session's error read as another's empty result. The runner that makes these (its one catch-all records failed
and the reason on the Run) is session sf's 7/8; this file is only the shape, so sf and the readers (cr 2/5-4/5) build on the same one.
Invariants: status is one of STATUSES; a failed Result names its reason."""
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
