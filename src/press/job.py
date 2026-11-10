"""The states a job goes through in one Find jobs run, each with its one owner (contract C4 of docs/superpowers/specs/2026-11-10-find-jobs-code-shape.md;
the table is session sf's spec docs/superpowers/specs/2026-11-10-find-jobs-collect-rank-spend.md, "one owner each").
Why (cr 1/5, 10 Nov 2026): two places decided "in your places" and a job without an answer was guessed in one and unknown in the other, so a
fix in one moved the other's numbers. Here the states are only named; sf's scoring PRs and cr's readers adopt them.
Invariants: a state is changed only by its owner; a job with no verdict is UNKNOWN in every reader of the list, never a guess."""
LISTED = 'listed'   # a reader read it: title, place, link and the place fact the source already has
PLACED = 'placed'   # the map placed it (in your places, near, far) from the reader's fact, the kept answers or the pack
KEPT = 'kept'       # title sorting (the AI) said it fits
SCORED = 'scored'   # the one scorer gave it a fit
STATES = (LISTED, PLACED, KEPT, SCORED)   # in the order a job goes through them
UNKNOWN = 'unknown'   # a verdict not given yet (busy AI, no fact): its own state, never a guess

OWNERS = {   # repo-relative: the one file (or folder) that may move a job into the state
    LISTED: 'src/sources',
    PLACED: 'src/geo.py',
    KEPT: 'src/ai/title_triage.py',
    SCORED: 'src/daily_search_scoring.py',
}
