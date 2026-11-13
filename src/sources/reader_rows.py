"""Every reader of jobs, one row each (contract C3 of docs/superpowers/specs/2026-11-10-find-jobs-code-shape.md): a row's `read(run, search)` lists jobs with the place
fact the source itself gives; it never scores, sorts or decides what is kept (that is the run core's: src/press). `on(env)` is the row's one gate.
Why (cr 2/5, sf and oe, 10 Nov 2026): a source was wired by hand at each place that reads it (the free-API stage, the first-jobs slice, the early read), so a new source
or a gate changed in one place and not the others. A reader is added here once; oe's free job APIs and known employers' sites at the press add theirs.
Readers of the rows: aggregators.sources() (the free-API stage's list, through which eures.start_early and the first-jobs slice also ask). The first-jobs slice's own loop
over the rows, with a "starts at the press" field, comes with the Run made at the entry (sf 3/8); the employer feeds' row with it (its employers are the run's pick).
Lanes (design: docs/superpowers/specs/2026-11-10-find-jobs-finish-line.md WP8; owner, 10 Nov 2026: "Build the lanes now (Recommended)", asked via AskUserQuestion by sa):
a press is one clock and one lane per source; every lane starts at second 0 and none waits for another unless LANES declares the need here. A lane ends in
one said state, a stage.Result (done / cut = time up, "N wait" / failed, why). A row names its lane; a lane holds one or more rows (the free job APIs are several).
Invariants: `needs` names lanes, never a cycle; a wait not declared here is a bug; an app lane runs in the app and has no engine row.
Tests: tests/unit/sources/test_reader_rows.py."""
from dataclasses import dataclass
from typing import Callable, Mapping


@dataclass(frozen=True)
class Lane:
    """One lane of a press: `side` 'engine' (this process) or 'app' (desktop/lib); `needs`, the lanes whose answer it must have before it reads (a real need,
    never call order); `clock`, the names its "⏱ Time is up … for <name>" lines use (src/press/clock.py STAGES, desktop/lib/press-stages.js)."""
    id: str
    side: str
    needs: tuple = ()
    clock: tuple = ()


LANES = (
    Lane('eures', 'engine'),   # its own line when cut ("EURES: still reading when its time ended", src/sources/eures.py); on only in the installed app (#3678)
    Lane('employer_sites', 'engine', clock=('employer sites',)),
    Lane('job_boards', 'engine', clock=('job boards',)),   # the boards known before the press: the field's, the proposed and the found ones
    Lane('free_job_apis', 'engine', clock=('free job APIs', 'Google Jobs')),
    Lane('job_alert_emails', 'engine', clock=('job-alert emails',)),
    Lane('board_web', 'engine', clock=('web search',)),   # the web search for boards
    Lane('boards_found', 'engine', needs=('board_web',)),   # the boards that web search found: the one declared wait
    Lane('linkedin_guest', 'engine'),   # LinkedIn's public search, desktop only (src/sources/linkedin_guest.py; spec 2026-11-13-linkedin-guest-search-design.md)
    Lane('linkedin', 'app'),   # desktop/lib/search-beside.js withLinkedin; no "Time is up" line yet (a 170 s stop says "stopped", lt's #3705)
    Lane('finder', 'app', clock=('searching wider',)),   # the employer finder after the search (desktop/lib/search-steps.js, press-stages.js scout)
)
BY_LANE = {lane.id: lane for lane in LANES}


@dataclass(frozen=True)
class Row:
    """One reader. read(run, search) -> jobs as listed (run may be None until the entry makes one, sf 3/8); on(env) -> whether this install reads it now;
    lane: the id of its lane in LANES."""
    name: str
    read: Callable
    on: Callable[[Mapping], bool]
    lane: str


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


def _national_read(name):
    """One national employment service's read (src/sources/national.py read), the service and the read looked up at call time, so a test's patch of national.read is the one read."""
    def read(run, search):
        from . import national
        return national.read(next(service for service in national.SERVICES if service.name == name), search)
    return read


def _national_on(env):
    """On wherever the free job APIs are, from source and on CI too: our own source, measured as one (owner, 12 Nov 2026: "Yes, add them (Recommended)");
    JOBADABRA_DISABLE=national turns every service off."""
    from ..features import disabled
    return not disabled('aggregators', env) and not disabled('national', env)


def _linkedin_read(run, search):
    """LinkedIn's public search (src/sources/linkedin_guest.py read), looked up at call time like the others."""
    from . import linkedin_guest
    return linkedin_guest.read(search)


def _linkedin_on(env):
    """Why (owner, 13 Nov 2026, asked via AskUserQuestion: "On each person's Mac (Recommended)"): only the desktop app sets JOBADABRA_LINKEDIN_GUEST=1 (src/features.py
    'linkedin_guest'), so CI, the Night search and the pairs never read LinkedIn from a GitHub address."""
    from ..features import disabled, enabled
    return not disabled('aggregators', env) and enabled('linkedin_guest', env)


# Why (#3887, Norway's and Switzerland's rows, 12 Nov 2026): named here, not imported: the retired replay's verdict script (13 Nov 2026) loaded this file on its own (no package), so nothing at import imports a sibling; kept so. src/sources/national.py SERVICES' names, in its order; tests/unit/sources/test_national.py pins the two equal.
NATIONAL = ('Platsbanken', 'Le Forem', 'arbeidsplassen.no', 'Job-Room')


ROWS = (
    Row('EURES', _eures_read, _eures_on, 'eures'),   # the portal's countries only (it returns nothing otherwise)
    *(Row(name, _national_read(name), _national_on, 'free_job_apis') for name in NATIONAL),   # each its own country only (it returns nothing otherwise)
    Row('LinkedIn', _linkedin_read, _linkedin_on, 'linkedin_guest'),   # started at the press like the free job APIs (src/sources/api_lane.py), in its own thread
)
