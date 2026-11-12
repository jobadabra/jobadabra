"""A found job board's history: when a board that refused is looked at again, which boards their history dropped, what this search's
reads gave. Moved out of src/sources/found_boards.py unchanged (the 500-line rule); found_boards re-exports every name.
Tests: tests/unit/sources/test_found_boards.py."""
import sqlite3
from contextlib import closing
from datetime import datetime, timezone

BROWSER_RETRY_DAYS = 30   # a board marked 'browser' is looked at again after this long (its page or routes may have changed)


def _retry_when_unjudged(entry, relevant, ai_failed=False):
    """The other ways found nothing relevant while the refresh's time for sorting titles was spent, or an AI call of theirs failed: the titles or the
    link were not judged, not rejected (24 Oct 2026: a Moldovan board's IT field was read at 163 s, "Time is up for this refresh: 10 title(s) left",
    0 relevant, and the board was not looked at again for that link; check #10, Rabota: "decide board field link: CliError", 3 jobs, never retried).
    The board is tried again next refresh; the pages it read are kept (page_reads), so that costs no model."""
    from .. import time_budget
    if not relevant and (ai_failed or time_budget.over('titles')):
        entry.pop('form_for', None)


def _retry_due(entry, now):
    try:
        last = datetime.fromisoformat(entry['last_read'])
    except (KeyError, ValueError):
        return True
    return ((now or datetime.now(timezone.utc)) - last).days >= BROWSER_RETRY_DAYS


def _dead():
    """The boards dropped by their history (board_yield.dead) in this install's job cache; none before its first search."""
    from .. import paths
    from . import board_yield
    path = paths.DATA / 'jobs.sqlite'
    if not path.exists():
        return set()
    with closing(sqlite3.connect(path)) as db:
        return board_yield.dead(db)


def read_since(stamp):
    """{board host: relevant jobs} of the found boards read at or after `stamp` (ISO, UTC): this search's reads, for source_yield."""
    from ..ai import board_ideas
    from .careers_parse import registrable
    return {registrable(host): int(entry.get('relevant') or 0) for host, entry in (board_ideas.load().get('boards') or {}).items()
            if (entry.get('last_read') or '') >= stamp}
