"""How many searches in a row a free API was read again because its jobs still wait for an AI answer, and the bound on it (WP8 rule 6, #3754; owner, 12 Nov 2026: "Add a limit first").
One owner of the bound: aggregators.mark_read_unless_waiting asks another_read(); nothing else counts. Tests: tests/unit/sources/test_aggregators.py."""

MOST = 2   # further searches that read a source again for jobs still waiting; then it rests 6 h like the others
TABLE = 'CREATE TABLE IF NOT EXISTS aggregator_owed (source TEXT PRIMARY KEY, search TEXT NOT NULL, rereads INTEGER NOT NULL)'


def another_read(db, name, key):
    """True when source `name` may be read once more for this search (key: aggregators.search_key) though jobs of it still wait; counts it.
    Why (owner, 12 Nov 2026, asked via AskUserQuestion by sa; Gitar on #3893): an answer the AI never gives (a place it leaves out, a cap) kept the source out of the 6 h rest for
    ever, one more fetch of it every search; after MOST re-reads it rests as any source, and what still waits is asked on the next read after the rest. A new search starts at 0."""
    db.execute(TABLE)
    row = db.execute('SELECT search, rereads FROM aggregator_owed WHERE source = ?', (name,)).fetchone()
    done = row[1] if row and row[0] == key else 0
    if done >= MOST:
        return False
    with db:
        db.execute('INSERT OR REPLACE INTO aggregator_owed (source, search, rereads) VALUES (?, ?, ?)', (name, key, done + 1))
    return True


def clear(db, name):
    """The source rests (nothing waits or the bound was reached): its count starts again."""
    db.execute(TABLE)
    with db:
        db.execute('DELETE FROM aggregator_owed WHERE source = ?', (name,))
