"""Every reader of jobs, one row each (contract C3 of docs/superpowers/specs/2026-11-10-find-jobs-code-shape.md): a row's `read(run, search)` lists jobs with the place
fact the source itself gives; it never scores, sorts or decides what is kept (that is the run core's: src/press). `on(env)` is the row's one gate.
Why (cr 2/5, sf and oe, 10 Nov 2026): a source was wired by hand at each place that reads it (the free-API stage, the first-jobs slice, the early read), so a new source
or a gate changed in one place and not the others. A reader is added here once; oe's free job APIs and known employers' sites at the press add theirs.
Readers of the rows: aggregators.sources() (the free-API stage's list, through which eures.start_early and the first-jobs slice also ask). The first-jobs slice's own loop
over the rows, with a "starts at the press" field, comes with the Run made at the entry (sf 3/8); the employer feeds' row with it (its employers are the run's pick).
Tests: tests/unit/sources/test_reader_rows.py."""
from dataclasses import dataclass
from typing import Callable, Mapping


@dataclass(frozen=True)
class Row:
    """One reader. read(run, search) -> jobs as listed (run may be None until the entry makes one, sf 3/8); on(env) -> whether this install reads it now."""
    name: str
    read: Callable
    on: Callable[[Mapping], bool]


def _eures_read(run, search):
    """EURES as the free-API stage reads it (src/sources/eures.py read: the read started with the search, else a read now). Looked up at call time, so a test's
    patch of eures.read is the one read."""
    from . import eures
    return eures.read(search)


def _eures_on(env):
    """Why (10 Nov 2026, owner: "our algorim/search can be as good as EURES, without using EURES"): only the installed app turns EURES on (JOBADABRA_EURES=1,
    desktop/lib/eures-on.js), so a run from source, CI and the Night search measure our own sources (#3678)."""
    from ..features import disabled, enabled
    return not disabled('aggregators', env) and enabled('eures', env)


ROWS = (
    Row('EURES', _eures_read, _eures_on),   # the portal's countries only (it returns nothing otherwise)
)
