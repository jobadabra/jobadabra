"""Board discovery's cells: which (country, role family) cells the board pass reads next, weakest first, and how long an empty cell rests.
Why (12 Nov 2026, owner, asked via AskUserQuestion: "Separate lab workflow (Recommended)", "Every 2 h (Recommended)", "Stay free for now (Recommended)"):
the pass picked the country with the fewest employers (src/scout_boards.py next_country), so countries with many employers and no measured board never
had a turn. A cell is (country, family) because a board fact carries its families (src/pool_tags.py FAMILIES) and installs match boards by them.
The cell with the fewest boards of MIN_LOCAL+ local jobs goes first (the lab's priority cells first among equals); a run takes its country and that
country's PER_RUN weakest families. A cell that kept no board rests REST_DAYS (1, 2, 4, 8, then 30 days); a kept board clears its rest. A fact older
than REFRESH_DAYS is read again before the site drops it at FACT_DAYS. Memory: scout_meta key CELLS. Tests: tests/unit/sources/test_scout_board_cells.py."""
import sqlite3
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

from . import pool_tags, scout_cells

CELLS = 'board_cells'          # scout_meta: {"<country>|<family>": {"tries": n, "until": "YYYY-MM-DD", "asked": "YYYY-MM-DD"}}
PER_RUN = 3                    # families one run asks a country's boards for (one AI ideas call names boards for all of them)
REST_DAYS = (1, 2, 4, 8, 30)   # an empty cell's rest after its 1st, 2nd, ... empty try; the last one repeats
REFRESH_DAYS = 20              # a fact this old is read again (the site drops it at src/scout_boards.py FACT_DAYS)
TARGET = 2                     # boards a cell needs before it leaves the queue (only a refresh reads it again)
SEEDED = ('serp_waiting', 'serp_pairs', 'serp_month')   # src/scout_google_boards.py memory, copied once by seed()
REREAD, REREAD_DAYS = 'board_reread', 3   # scout_meta: {"<host>|<country>": "YYYY-MM-DD"} a due fact was read again; it is not due again for this long
WORDS, WORDS_DAYS = 'board_words', 30     # scout_meta: {"<country>|<family>": {"words": [...], "at": "YYYY-MM-DD"}} the family's search words in the country's language (local_words)


def _facts(db):
    """[(host, country, url, families, read_at)] of every fact kept (src/scout_boards.py scout_board_facts)."""
    from . import scout_boards
    scout_boards.ensure(db)
    return db.execute('SELECT host, country, url, families, read_at FROM scout_board_facts WHERE local_jobs >= ?', (scout_boards.MIN_LOCAL,)).fetchall()


def strength(db, today):
    """Counter {(country, family): boards with MIN_LOCAL+ local jobs measured within FACT_DAYS}."""
    from . import scout_boards
    cutoff = (today - timedelta(days=scout_boards.FACT_DAYS)).isoformat()
    return Counter((country, family) for _, country, _, families, read_at in _facts(db) if read_at >= cutoff
                   for family in families.split(',') if family)


def stale(db, today):
    """{country: [board]} of facts older than REFRESH_DAYS and not yet dropped, the boards in the shape the pass reads, oldest country first.
    A fact read again within REREAD_DAYS that did not pass waits: one board under the floor now must not take every run until it is dropped."""
    from . import scout_boards
    old, gone = (today - timedelta(days=REFRESH_DAYS)).isoformat(), (today - timedelta(days=scout_boards.FACT_DAYS)).isoformat()
    tried, recent = scout_cells._meta(db, REREAD, {}), (today - timedelta(days=REREAD_DAYS)).isoformat()
    tried = tried if isinstance(tried, dict) else {}
    due = sorted((read_at, country, host, url) for host, country, url, _, read_at in _facts(db)
                 if gone <= read_at < old and str(tried.get(f'{host}|{country}') or '') < recent)
    out = {}
    for _, country, host, url in due:
        out.setdefault(country, []).append({'name': host, 'host': host, 'search_url': url, 'countries': [pool_tags.COUNTRIES.get(country, country)],
                                            'kinds': ['any'], 'source_kind': 'sector'})   # sector: a measured listing page may have no {role}
    return out


def parse(text):
    """[(country, family)] from "sk:nursing_care, nl:accounting_finance" (country by code or name, families by id); unknown ones are left out."""
    from . import scout_boards
    cells = []
    for item in str(text or '').split(','):
        country, _, family = item.strip().partition(':')
        try:
            code = scout_boards.named_country(country)
        except ValueError:
            continue
        if code and family.strip() in pool_tags.FAMILIES:
            cells.append((code, family.strip()))
    return list(dict.fromkeys(cells))


def _resting(memory, cell, today):
    return str((memory.get(f'{cell[0]}|{cell[1]}') or {}).get('until') or '') > today.isoformat()


def pick(db, today=None, priority=(), named=(), only=None):
    """(country, families, boards to read again) for the next run, or None when every cell under TARGET rests.
    named: cells given by hand (their first country, its named families). Else a country with a fact due for a refresh goes first, its weakest
    families asked beside the refresh; else the weakest cell's country. Weakest: fewest boards, then a priority cell, then the country's fewest boards, then asked longest ago.
    only: the countries this pick may give (a lane of src/scout_board_lanes.py reads its own country or nothing); None = any."""
    today = today or date.today()
    again = {country: boards for country, boards in stale(db, today).items() if only is None or country in only}
    if named and only is not None:   # a lane: cells named for another country are not its own, and its merge would drop them
        named = [cell for cell in named if cell[0] in only]
        if not named:
            return None
    if named:
        country = named[0][0]
        return country, [family for code, family in named if code == country][:PER_RUN], again.get(country, [])
    memory, counted, wanted = scout_cells._meta(db, CELLS, {}), strength(db, today), set(priority)
    memory = memory if isinstance(memory, dict) else {}
    families = list(pool_tags.FAMILIES)

    whole = Counter()
    for (code, _), boards in counted.items():
        whole[code] += boards

    def rank(cell):   # the country's own boards break ties: a country with none goes before one gap in a covered country
        return (counted.get(cell, 0), cell not in wanted, whole[cell[0]], str((memory.get(f'{cell[0]}|{cell[1]}') or {}).get('asked') or ''),
                scout_cells.EUROPE.index(cell[0]), families.index(cell[1]))
    open_cells = sorted((cell for cell in ((country, family) for country in scout_cells.EUROPE if only is None or country in only for family in families)
                         if counted.get(cell, 0) < TARGET and not _resting(memory, cell, today)), key=rank)
    country = next(iter(again), None) or (open_cells[0][0] if open_cells else None)
    if not country:
        return None
    return country, [family for code, family in open_cells if code == country][:PER_RUN], again.get(country, [])


def record(db, country, families, kept, today=None, again=()):
    """After a run: a family with a kept board is cleared; one without rests REST_DAYS by its empty tries in a row; the facts read again are stamped."""
    today = today or date.today()
    if again:
        tried = scout_cells._meta(db, REREAD, {})
        tried = tried if isinstance(tried, dict) else {}
        recent = (today - timedelta(days=REREAD_DAYS)).isoformat()   # older stamps no longer hold a fact back: dropped, the memory stays small
        scout_cells._set(db, REREAD, {**{key: day for key, day in tried.items() if str(day) >= recent},
                                      **{f"{board['host']}|{country}": today.isoformat() for board in again}})
    memory = scout_cells._meta(db, CELLS, {})
    memory = memory if isinstance(memory, dict) else {}
    found = {family for fact in kept for family in fact.get('families') or []}
    for family in families:
        key = f'{country}|{family}'
        tries = 0 if family in found else int((memory.get(key) or {}).get('tries') or 0) + 1
        until = (today + timedelta(days=REST_DAYS[min(tries, len(REST_DAYS)) - 1])).isoformat() if tries else ''
        memory[key] = {'tries': tries, 'until': until, 'asked': today.isoformat()}
    scout_cells._set(db, CELLS, memory)
    db.commit()


def line(db, today=None, priority=()):
    """One log line: cells with a board of MIN_LOCAL+ local jobs (all and the priority ones), cells resting."""
    today = today or date.today()
    counted, memory = strength(db, today), scout_cells._meta(db, CELLS, {})
    memory = memory if isinstance(memory, dict) else {}
    total = len(scout_cells.EUROPE) * len(pool_tags.FAMILIES)
    resting = sum(1 for key in memory if str((memory.get(key) or {}).get('until') or '') > today.isoformat())
    wanted = list(dict.fromkeys(priority))
    return (f'Board cells: {sum(1 for n in counted.values() if n)} of {total} have a board'
            + (f', priority {sum(1 for cell in wanted if counted.get(cell))} of {len(wanted)}' if wanted else '') + f'; {resting} resting')


def seed(db, path, out=print):
    """Board discovery's own database starts from the Scout's facts, once: while it holds no fact, every fact of the database at `path` is copied in
    (a missing or unreadable file copies nothing). Why (12 Nov 2026, bd): the discovery job saving the Scout's whole database would lose one side's
    memory whenever the two ran at once; its own database starting empty would read the covered countries first again."""
    from . import scout_boards
    scout_boards.ensure(db)
    if not path or not Path(path).is_file():
        return 0
    if db.execute('SELECT 1 FROM scout_board_facts LIMIT 1').fetchone():
        return 0
    try:
        with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as source:
            marked = 'browser' in {row[1] for row in source.execute('PRAGMA table_info(scout_board_facts)')}   # #3910: measured in the browser
            rows = source.execute('SELECT host, country, url, families, local_jobs, read_at, ' + ('browser' if marked else '0')
                                  + ' FROM scout_board_facts').fetchall()
    except sqlite3.Error:
        return 0
    db.executemany('INSERT OR IGNORE INTO scout_board_facts (host, country, url, families, local_jobs, read_at, browser) VALUES (?, ?, ?, ?, ?, ?, ?)', rows)
    for key in SEEDED:   # Google's sites found and not yet judged, its pairs searched and the month's count go with the facts
        try:
            with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as source:
                found = source.execute('SELECT value FROM scout_meta WHERE key = ?', (key,)).fetchone()
        except sqlite3.Error:
            found = None
        if found and scout_cells._meta(db, key, None) is None:
            db.execute('INSERT OR REPLACE INTO scout_meta (key, value) VALUES (?, ?)', (key, found[0]))
    db.commit()
    out(f'Board discovery: started from the Scout\'s {len(rows)} board facts')
    return len(rows)


def keep_stops(db, path, out=print):
    """Every board the Scout's browser was stopped at in the database at `path` (src/scout_boards.py scout_browser_final) stays stopped in `db`, on every
    run: board discovery keeps its own database, and a refusal is final whichever job met it (CLAUDE.md, the refused-sites exception: "stops that board
    in Jobadabra's browser for good, with no retry"). Returns the stops copied; a missing or unreadable file copies none."""
    from . import scout_boards
    scout_boards.ensure(db)
    if not path or not Path(path).is_file() or Path(path).resolve() == Path(db.execute('PRAGMA database_list').fetchone()[2] or ':memory:').resolve():
        return 0
    try:
        with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as source:
            rows = source.execute('SELECT host, why, at FROM scout_browser_final').fetchall()
    except sqlite3.Error:
        return 0
    db.executemany('INSERT OR IGNORE INTO scout_browser_final (host, why, at) VALUES (?, ?, ?)', rows)
    db.commit()
    if rows:   # the run's proof that the Scout's stops reached this database (sa, 12 Nov 2026: checked before a stopped country is read)
        out(f"Board pass: kept as stopped for the browser, from the Scout's memory, never opened: {', '.join(sorted(host for host, _, _ in rows))}")
    return len(rows)


def local_words(db, country, families, today=None, ask=None):
    """{family: [words in the country's language]} for these families, from memory (WORDS, kept WORDS_DAYS) or one AI call for the ones missing
    (src/ai/board_words.py); a family the AI did not answer is absent, and the board pass searches its English words. Nothing is remembered from a failed call."""
    today = today or date.today()
    memory = scout_cells._meta(db, WORDS, {})
    memory = memory if isinstance(memory, dict) else {}
    fresh = (today - timedelta(days=WORDS_DAYS)).isoformat()
    known = {family: (memory.get(f'{country}|{family}') or {}).get('words') for family in families
             if str((memory.get(f'{country}|{family}') or {}).get('at') or '') >= fresh}
    missing = {family: pool_tags.FAMILIES[family] for family in families if family not in known and family in pool_tags.FAMILIES}
    if missing:
        if ask is None:
            from .ai import board_words
            ask = board_words.words
        answered = ask(pool_tags.COUNTRIES.get(country, country), missing)
        if answered:
            for family, found in answered.items():
                memory[f'{country}|{family}'] = {'words': found, 'at': today.isoformat()}
                known[family] = found
            scout_cells._set(db, WORDS, memory)
            db.commit()
    return {family: known[family] for family in families if known.get(family)}


def facts_beside(path, today=None):
    """The facts board discovery's own database kept (src/scout_boards.py facts), for the Scout's publish; [] without the file."""
    from . import scout_boards
    if not path or not Path(path).is_file():
        return []
    try:
        with sqlite3.connect(path) as source:   # not read-only: facts() makes its tables when missing (a new table in ensure())
            return scout_boards.facts(source, today)
    except sqlite3.Error:
        return []
