"""The rows of a query on a persona install's store, or [] when its table does not exist yet. Shared by metrics.py and ttfr.py.
Why (2 Nov 2026, run 41373710207): the `scores` table is created by the first scored job, so a press the 180 s budget stopped before that has none; that is
"nothing scored", not an error (ttfr.py selected from it and killed run.mjs before it wrote the press row; Gitar on #2955: one helper, not two copies).
Why (4 Nov 2026, run 41807509648): the same holds for `jobs` and `cron_runs` when the stop came before any step opened the store (persona 6); one `has`, used for all."""


def has(db, table):
    """db: an open sqlite3 connection; table: a table name. -> True when it exists (False for a store a press never opened)."""
    return db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone() is not None


def table_rows(db, table, sql):
    """db: an open sqlite3 connection; table: the table `sql` reads; sql: a SELECT on it. -> its rows, [] without the table."""
    return db.execute(sql).fetchall() if has(db, table) else []


def scores_rows(db, sql):
    """db: an open sqlite3 connection; sql: a SELECT on `scores`. -> its rows, [] without the table."""
    return table_rows(db, 'scores', sql)
