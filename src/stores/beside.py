"""The run's store for a thread that writes Job Matches beside the run's own thread (src/daily_search_scoring.py: the waiting jobs scored while the
search reads). A SQLite connection belongs to the thread that opened it (sqlite3's check_same_thread), so on this Mac's store the thread gets a
connection of its own to the same tracker file; Notion and the memory store hold nothing bound to a thread and are shared as they are.
Only `matches` is replaced: the thread writes nothing else. Tests: tests/unit/stores/test_store_beside.py."""
import contextlib
import dataclasses


def opener(stores):
    """Called in the run's thread (it reads the tracker file's path from the run's own connection there): a context manager to enter in the
    other thread, which yields the store to use in it and closes what it opened when it ends."""
    path = _tracker_file(stores)

    @contextlib.contextmanager
    def here():
        if path is None:
            yield stores
            return
        from . import sqlite
        db = sqlite.connect(path)
        try:
            yield dataclasses.replace(stores, matches=sqlite.Matches(db))
        finally:
            db.close()
    return here


def _tracker_file(stores):
    """The SQLite store's file, None on any other store (or one in memory, a test's: shared, as it has no file to open again)."""
    db = getattr(stores.matches, 'db', None) if stores.name == 'sqlite' else None
    if db is None:
        return None
    return db.execute('PRAGMA database_list').fetchone()[2] or None
