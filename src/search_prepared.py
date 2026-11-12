"""What a search must know before it reads anything, worked out when the strategy is saved: where the places are and what kind of work the roles are.
The app runs `python -m src.search_prepared` after every save of the search settings (desktop/lib/search-prepared.js); a search then starts with the
kept answers and asks none of these inside its 3 minutes.

Design (owner, 10 Nov 2026, asked via AskUserQuestion: "Yes, at strategy save (Recommended)"; docs/superpowers/specs/2026-11-10-find-jobs-collect-rank-spend.md 4/8):
- One owner of each answer, unchanged: src/places.py (place words), src/contribute.py and src/role_kinds.py (the fixed-list labels, kept per word by
  src/ai/meanings.py). This file only asks them early; it keeps nothing of its own.
- Asked once: a word already answered is a cache read, so a save that changed nothing costs no AI call, and the search's own asks stay as the fallback
  (a save made without AI, an old install): nothing is skipped on a guess.
- A search that starts while this still runs waits for it (`wait`), at most WAIT seconds: it would ask the same questions itself, twice the calls.
Why (sa, 12 Nov 2026, recorded first searches of 17 test people on CI): the employers of a person's kind were known 22-113 s into a first search and
1-2 s into the second; one person read 0 of 90 employer sites in the first search and 89 of 90 in the second.
"""
import sys

WAIT = 60   # seconds a starting search waits for a preparation in flight: about what the same questions take when it asks them itself
LOCK = 'prepared'
SEARCHES = ('scheduled', 'run', 'today', 'more')   # the modes src/daily.py sends to search(); logging, kits, scores and insights never wait for a preparation


def prepare(out=print):
    """Asks, in the search's own order, what its first seconds would ask. A failure of one part leaves the others and never fails the save: the search asks again."""
    from . import employer_index, places, role_kinds
    from .paths import load_search_config, run_lock
    done = []
    with run_lock(name=LOCK, label='preparing the search'):
        places.refresh_quietly()   # "Germany", "Lisbon": the places a posting would name (kept in the place cache)
        for name, ask in (('labels', employer_index.me_now),   # role kinds, families, countries, metros: fixed-list labels, kept per word
                          ('kinds', lambda: role_kinds.of_search(load_search_config()))):
            try:
                ask()
                done.append(name)
            except Exception as error:  # noqa: BLE001 — the search asks this part itself, as before
                print(f'Search not prepared ({name}): {type(error).__name__}', file=sys.stderr)
    out(f"Search prepared: places{''.join(', ' + name for name in done)}")
    return done


def wait():
    """A search's first step: let a preparation in flight finish, at most WAIT seconds; never fails the search."""
    from .paths import LockTimeout, run_lock
    try:
        with run_lock(name=LOCK, label='search start', wait_max=WAIT, poll=1):   # no on_wait: with one, run_lock waits without an end
            pass
    except (LockTimeout, OSError):
        pass   # still preparing, or the lock file cannot be opened: the search asks for itself, as before


def main():
    """`python -m src.search_prepared` (the app, after the search settings are saved)."""
    prepare()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
