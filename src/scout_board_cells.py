"""Board discovery's cells: which (country, role family) cells the board pass reads next, weakest first, and how long an empty cell rests.
Why (12 Nov 2026, owner, asked via AskUserQuestion: "Separate lab workflow (Recommended)", "Every 2 h (Recommended)", "Stay free for now (Recommended)"):
the pass picked the country with the fewest employers (src/scout_boards.py next_country), so countries with many employers and no measured board never
had a turn. A cell is (country, family) because a board fact carries its families (src/pool_tags.py FAMILIES) and installs match boards by them.
The cell with the fewest boards of MIN_LOCAL+ local jobs goes first (the lab's priority cells first among equals); a run takes its country and that
country's PER_RUN weakest families. A cell that kept no board rests REST_DAYS (1, 2, 4, 8, then 30 days); a kept board clears its rest. A fact older
than REFRESH_DAYS, or measured under an older rule than scout_board_counts.LISTED_RULE, is read again before the site drops it at FACT_DAYS; those re-reads and the reported boards share the pass's places (share). Memory: scout_meta key CELLS. Tests: tests/unit/sources/test_scout_board_cells.py."""
import sqlite3
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

from . import pool_tags, scout_board_counts, scout_cells

CELLS = 'board_cells'          # scout_meta: {"<country>|<family>": {"tries": n, "until": "YYYY-MM-DD", "asked": "YYYY-MM-DD"}}
PER_RUN = 3                    # families one run asks a country's boards for (one AI ideas call names boards for all of them)
REST_DAYS = (1, 2, 4, 8, 30)   # an empty cell's rest after its 1st, 2nd, ... empty try; the last one repeats
REFRESH_DAYS = 20              # a fact this old is read again (the site drops it at src/scout_boards.py FACT_DAYS)
TARGET = 4                     # boards PROVEN for the cell (MIN_RIGHT+ jobs of the family) before it leaves the queue (only a refresh reads it again)
# Why (13 Nov 2026, bp; sa for the owner, plan approved "Yes, go on (Recommended)", sketch https://claude.ai/artifact/YPkXa1B2BDQg4WjDbrQLfx): 2 left four of the six places
# of a first search to the per-search naming, whose variance (Madrid electrician: 6 to 26 right jobs on near-identical code) is what the proven boards remove; 4 leaves two.
# Cost, from run 43485778466: a pass (one country, 3 families) 6.3 min and 25-41 AI calls; 930 cells = 310 passes = ~33 h on one lane, ~4-5 h on 8 lanes.
SEEDED = ('serp_waiting', 'serp_pairs', 'serp_month')   # src/scout_google_boards.py memory, copied once by seed()
REREAD, REREAD_DAYS = 'board_reread', 3   # scout_meta: {"<host>|<country>": "YYYY-MM-DD"} a due fact was read again; it is not due again for this long
SKIPPED = 'board_skipped'   # scout_meta: {"<country>": [hosts whose re-read the pass had no time for]} (note_skipped, read by record)
RAN = 'board_ran'   # scout_meta: {"<country>": [families a board of the last pass was asked by their own word]} (note_ran, read by record)
WORDS, WORDS_DAYS = 'board_words', 30     # scout_meta: {"<country>|<family>": {"words": [...], "at": "YYYY-MM-DD"}} the family's search words in the country's language (local_words)


def _facts(db):
    """[(host, country, url, families, read_at, counts)] of every fact kept (src/scout_boards.py scout_board_facts); counts {family: jobs} is None for a fact
    kept before 13 Nov 2026 (no count per family: it proves no family)."""
    from . import scout_boards
    scout_boards.ensure(db)
    return [(host, country, url, families, read_at, scout_boards._counts(text) if text is not None else None) for host, country, url, families, read_at, text in db.execute(
        'SELECT host, country, url, families, read_at, family_jobs FROM scout_board_facts WHERE local_jobs >= ?', (scout_boards.MIN_LOCAL,))]


def strength(db, today):
    """Counter {(country, family): boards PROVEN for the family (MIN_RIGHT+ jobs of it located in the country) measured within FACT_DAYS}.
    Why (13 Nov 2026, bp, owner: "Why ? Let's fix it."): it counted the boards that had seen the family once, so an airline board and a tech board (one aircraft
    electrician and one electronics job) filled (es, electrical_mechanical) at TARGET and the cell left the queue: the boards that give Madrid electricians
    their jobs (Jobeka 19 right, Trabajo.org 16) were never looked for."""
    from . import scout_boards
    cutoff = (today - timedelta(days=scout_boards.FACT_DAYS)).isoformat()
    return Counter((country, family) for _, country, _, _, read_at, counts in _facts(db) if read_at >= cutoff
                   for family in scout_boards.proven_families({'family_jobs': counts}))


def _rules(db):
    """{(host, country): rule} of every fact kept (scout_board_facts.rule; None for a fact measured before the rules were numbered). Call after _facts(): that makes the column."""
    return {(host, country): rule for host, country, rule in db.execute('SELECT host, country, rule FROM scout_board_facts')}


def stale(db, today):
    """{country: [board]} of facts due to be read again and not yet dropped, the boards in the shape the pass reads, the one serving the most right jobs first, then the oldest read (countries in that order). Due: older than REFRESH_DAYS, or kept before
    13 Nov 2026 (no count per family), or measured under an older rule than scout_board_counts.LISTED_RULE (a fact with no rule included), at once.
    A fact read again within REREAD_DAYS that did not pass waits: one board under the floor now must not take every run until it is dropped.
    Design (14 Nov 2026, sa for the owner: "the due re-reads go highest served right count first"): a fact at an older rule misleads the order in proportion to the count the site still serves for it, so the largest served
    count (its best family) is read again first, the oldest read breaks a tie; the pass's country (pick) is the one holding the largest such count, so the worst stale count anywhere goes first and a small old one waits only while a bigger one is due (each read waits REREAD_DAYS, so the bigger ones leave the queue); a pass re-reads only half its places, so the oldest-first order left airlinejobs.com's es 53 behind 167 facts of every size.
    Why (14 Nov 2026, sa for the owner): a fact does not say under which rule it was measured, so airlinejobs.com's es 53 (read from a list before the listed rule) lived on as a searched count until its 20-day refresh."""
    from . import scout_boards
    old, gone = (today - timedelta(days=REFRESH_DAYS)).isoformat(), (today - timedelta(days=scout_boards.FACT_DAYS)).isoformat()
    tried, recent = scout_cells._meta(db, REREAD, {}), (today - timedelta(days=REREAD_DAYS)).isoformat()
    tried = tried if isinstance(tried, dict) else {}
    facts = _facts(db)
    rules = _rules(db)
    due = sorted((-max((counts or {}).values(), default=0), read_at, country, host, url) for host, country, url, _, read_at, counts in facts
                 if gone <= read_at and (read_at < old or counts is None or (rules.get((host, country)) or 0) < scout_board_counts.LISTED_RULE)
                 and str(tried.get(f'{host}|{country}') or '') < recent)
    out = {}
    for served, _, country, host, url in due:
        out.setdefault(country, []).append({'name': host, 'host': host, 'search_url': url, 'countries': [pool_tags.COUNTRIES.get(country, country)],
                                            'kinds': ['any'], 'source_kind': 'sector', 'served': -served})   # served: the count that ranked it (due_line prints it)   # sector: a measured listing page may have no {role}
    return out


def share(again, candidates, places=None):
    """(re-reads, reported candidates) the pass reads: `places` (default scout_boards.MAX_BOARDS) split in half, a half that is not used given to the other, each list in the order it came
    (the most right jobs served first, then the oldest read; the best-ranked candidate first). The AI's and Google's boards fill what both leave.
    Design (14 Nov 2026, sa for the owner): the places have two owners with two kinds of claim: a fact of an older rule or past its refresh (read again) and a board installs reported (never measured).
    Every old-rule fact is due at once after a rule bump (hundreds), so re-reads alone would fill every pass; and the reported boards (Jobeka, Trabajo.org) alone would leave them to the 20-day refresh.
    Half and half, the unused half to the other, so neither starves the other; it judges nothing about a page. With the default reserve (4 candidates) a pass re-reads 8."""
    from . import scout_boards
    half = (places or scout_boards.MAX_BOARDS) // 2
    return list(again)[:half + max(0, half - len(candidates))], list(candidates)[:half + max(0, half - len(again))]


def due_line(country, again, taken, shown=12):
    """One log line after share() cut the re-reads to the pass's places: how many facts of `country` are due, the ones this pass reads (`taken`, in order, each with the served count that ranked it) and how many wait:
    `Board pass: re-reads due in es: 9; read now: airlinejobs.com (53), ...; waiting: 3`.
    Why (14 Nov 2026, es discovery 43544069411, sa for the owner: "the six re-reads in order with their old counts"): the pass printed only the boards it read, so a pass that re-read nothing looked the same as one that re-read the right ones (Gitar on #4169: printed after share, from the counts stale ranked by)."""
    read = ', '.join('%s (%d)' % (board['host'], board.get('served', 0)) for board in taken[:shown])
    return f'Board pass: re-reads due in {country}: {len(again)}' + (f'; read now: {read}; waiting: {len(again) - len(taken)}' if again else '')


def rule_line(db, today=None):
    """One log line: how many of the facts the site still serves (not dropped, MIN_LOCAL+ local jobs) were measured under an older rule than LISTED_RULE, as `Board pass: facts at an older rule: N of M`.
    Why (14 Nov 2026, lab run 43535757557): `scout.discover(db)` passes today=None in production and this was the one function of the module that did not default it, so every discovery pass ended in a TypeError after its reads."""
    from . import scout_boards
    today = today or date.today()
    gone = (today - timedelta(days=scout_boards.FACT_DAYS)).isoformat()
    facts, rules = [fact for fact in _facts(db) if fact[4] >= gone], _rules(db)
    return f"Board pass: facts at an older rule: {sum(1 for fact in facts if (rules.get((fact[0], fact[1])) or 0) < scout_board_counts.LISTED_RULE)} of {len(facts)}"


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
    families asked beside the refresh; else the weakest cell's country. Weakest: fewest boards, then the earliest in `priority` (an ordered list: src/scout_board_priority.py), then the country's fewest boards, then asked longest ago.
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
    memory, counted, first = scout_cells._meta(db, CELLS, {}), strength(db, today), {cell: place for place, cell in enumerate(dict.fromkeys(priority))}
    memory = memory if isinstance(memory, dict) else {}
    families = list(pool_tags.FAMILIES)

    whole = Counter()
    for (code, _), boards in counted.items():
        whole[code] += boards

    def rank(cell):   # the country's own boards break ties: a country with none goes before one gap in a covered country
        return (counted.get(cell, 0), first.get(cell, len(first)), whole[cell[0]], str((memory.get(f'{cell[0]}|{cell[1]}') or {}).get('asked') or ''),
                scout_cells.EUROPE.index(cell[0]), families.index(cell[1]))
    open_cells = sorted((cell for cell in ((country, family) for country in scout_cells.EUROPE if only is None or country in only for family in families)
                         if counted.get(cell, 0) < TARGET and not _resting(memory, cell, today)), key=rank)
    country = next(iter(again), None) or (open_cells[0][0] if open_cells else None)
    if not country:
        return None
    return country, [family for code, family in open_cells if code == country][:PER_RUN], again.get(country, [])


def note_ran(db, country, ran):
    """The families whose own word ran on ANY board of the pass just read, kept or not (src/scout_boards.py run): record() leaves the others unpenalised."""
    memory = scout_cells._meta(db, RAN, {})
    scout_cells._set(db, RAN, {**(memory if isinstance(memory, dict) else {}), country: sorted(ran)})


def note_skipped(db, country, hosts):
    """The re-reads the pass just read had no time for (src/scout_boards.py run): record() does not stamp them, so they are due again next pass."""
    memory = scout_cells._meta(db, SKIPPED, {})
    scout_cells._set(db, SKIPPED, {**(memory if isinstance(memory, dict) else {}), country: sorted(hosts)})


def record(db, country, families, kept, today=None, again=()):
    """After a run: a family with a kept board is cleared; one without rests REST_DAYS by its empty tries in a row; the facts read again are stamped."""
    from . import scout_boards
    today = today or date.today()
    skipped = (scout_cells._meta(db, SKIPPED, {}) or {}).get(country) or []
    again = [board for board in again if board['host'] not in skipped]
    if again:
        tried = scout_cells._meta(db, REREAD, {})
        tried = tried if isinstance(tried, dict) else {}
        recent = (today - timedelta(days=REREAD_DAYS)).isoformat()   # older stamps no longer hold a fact back: dropped, the memory stays small
        scout_cells._set(db, REREAD, {**{key: day for key, day in tried.items() if str(day) >= recent},
                                      **{f"{board['host']}|{country}": today.isoformat() for board in again}})
    memory = scout_cells._meta(db, CELLS, {})
    memory = memory if isinstance(memory, dict) else {}
    found = {family for fact in kept for family in scout_boards.proven_families(fact)}   # a family the board only saw once is not found
    # Why (13 Nov 2026, bp; Gitar on #4027): a family whose own word ran on no board of the pass (a read stops after two idle queries) was not asked: work owed, never a miss.
    # Decided from every board read, not from the kept ones: an all-empty pass is when the later families are most often skipped. No note (a pass by hand): none owed.
    ran = scout_cells._meta(db, RAN, {})
    ran = ran.get(country) if isinstance(ran, dict) else None
    owed = {family for family in families if family not in ran and family not in found} if ran is not None else set()
    for family in families:
        key = f'{country}|{family}'
        tries = 0 if family in found else int((memory.get(key) or {}).get('tries') or 0) + (family not in owed)
        rest = REST_DAYS[0] if family in owed else REST_DAYS[min(tries, len(REST_DAYS)) - 1] if tries else 0   # owed: asked again after the shortest rest
        until = (today + timedelta(days=rest)).isoformat() if rest else ''
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
            columns = {row[1] for row in source.execute('PRAGMA table_info(scout_board_facts)')}   # #3910: measured in the browser; 13 Nov 2026: its layout
            rows = source.execute('SELECT host, country, url, families, local_jobs, read_at, ' + ('browser' if 'browser' in columns else '0')
                                  + ', ' + ('layout' if 'layout' in columns else 'NULL') + ', ' + ('family_jobs' if 'family_jobs' in columns else 'NULL')
                                  + ', ' + ('listed_families' if 'listed_families' in columns else 'NULL') + ', ' + ('rule' if 'rule' in columns else 'NULL') + ' FROM scout_board_facts').fetchall()
    except sqlite3.Error:
        return 0
    db.executemany('INSERT OR IGNORE INTO scout_board_facts (host, country, url, families, local_jobs, read_at, browser, layout, family_jobs, listed_families, rule) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', rows)
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


def stopped_hosts(db):
    """The hosts the Scout's browser was stopped at (a 401/403, a bot check, a sign-in page), without a leading `www.`: {} until a stop exists. One owner of this question
    for the board pass (scout_boards.browser_final) and the candidate filter (scout_board_candidates.choose); compare a host with `host.removeprefix('www.')`."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name = 'scout_browser_final'").fetchone():
        return set()
    return {host.removeprefix('www.') for (host,) in db.execute('SELECT host FROM scout_browser_final')}


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
