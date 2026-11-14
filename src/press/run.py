"""One Find jobs run's state in one object, made once at the run's entry and passed down (contract C1 of
docs/superpowers/specs/2026-11-10-find-jobs-code-shape.md; owner, 10 Nov 2026: "each session that tries to improve a case, does this wihout
worsening/affecting other improvements done previosuly").
Why (cr 1/5, 10 Nov 2026; field names agreed with session sf, who adopts them in its 3/8): the run's state still lives at module level in a
dozen modules, so one session's change reached another's through it. This file only NAMES that state: `Run.current()` binds each field to
the module (or the containers) that hold it today, so every caller's API is unchanged and nothing moves. A later PR swaps one field for a
per-run object with the same method names; tests/unit/press/test_run.py lists the fields still shared between two Runs and that list only shrinks.
Invariants: a Run is flat (a frozen dataclass of small holders), has no logic of its own, and reads no clock, store or network.
Limit: two Runs share the one process Clock (`time_budget.CLOCK`, whose attribute dictionary IS time_budget's module) until the ~57 patches of
`time_budget.<name>` move (sf 3/8)."""
from dataclasses import dataclass, field
from typing import Any, Callable


def _no_sync(*_args, **_kwargs):
    """The run's default store sync: nothing to send (a test, a CLI run)."""


@dataclass(frozen=True)
class Reader:
    """One reader's state for this run, today still in its own module (cr 2/5 and 3/5 move each onto the Run): `early` its read started
    with the search, `cut` and `held` whether the last read ended on its clock and what it had so far, `searched` the searches done once
    per run, `taken` what the first-jobs slice took earlier. A field a reader does not have stays None."""
    early: Any = None
    cut: Any = None
    held: Any = None
    searched: Any = None
    taken: Any = None


@dataclass(frozen=True)
class Run:
    """Everything one Find jobs run owns. Each field holds today's module or container for that state (see the header):
    clock: the one Clock (time_budget.CLOCK) · claims: who scores which job (press.scorer) · counts: run_counts · details: run_details ·
    resume: what was said and ran (press.resume) · yields: each step's yield (press.step_yield) · titles: the title queue and its hub
    (ai.title_queue) · scope: each reader's AI views (ai.batch_scope) · ai: the run's AI calls, failures and stop (ai.decide) ·
    methods: how each source was read (read_methods) · cut: the reads' cut and the short read (sources.read_budget) ·
    reads: {reader name: Reader} · say, sync: the run's output line and store sync callbacks."""
    clock: Any
    claims: Any
    counts: Any
    details: Any
    resume: Any
    yields: Any
    titles: Any
    scope: Any
    ai: Any
    methods: Any
    cut: Any
    reads: dict = field(default_factory=dict)
    say: Callable = print
    sync: Callable = _no_sync

    @classmethod
    def current(cls, say=print, sync=None):
        """This process's run, built from the module state it still keeps (thin adapters: nothing is copied, every field is the live object)."""
        from .. import read_methods, run_counts, run_details, time_budget
        from ..ai import batch_scope, decide, title_queue
        from ..sources import aggregators, board_claims, board_web, eures, found_boards, linkedin_guest, read_budget
        from . import resume, scorer, step_yield
        reads = {
            'EURES': Reader(early=eures._early, cut=eures.CUT, held=eures.HELD),
            'job boards': Reader(early=board_web._early, searched=board_web._searched),
            'found boards': Reader(early=found_boards._early, held=board_claims._CLAIMED),   # held: the boards an early read took (src/sources/board_claims.py)
            'free job APIs': Reader(taken=aggregators.TAKEN),
            'LinkedIn': Reader(held=linkedin_guest.PACE),   # LinkedIn's pace, stop and job pages (src/sources/linkedin_guest.py)
        }
        return cls(clock=time_budget.CLOCK, claims=scorer, counts=run_counts, details=run_details, resume=resume, yields=step_yield,
                   titles=title_queue, scope=batch_scope, ai=decide, methods=read_methods, cut=read_budget, reads=reads, say=say,
                   sync=sync or _no_sync)


FIELDS = tuple(name for name in Run.__dataclass_fields__)
