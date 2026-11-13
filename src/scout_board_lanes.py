"""Board discovery in several lanes at once (jobadabra-lab board-discovery.yml `lanes`): the countries one round reads side by side, each lane in
its own copy of the memory, and how a lane's results for its own country come back into the one memory.
Invariants: the lanes of a round read different countries (countries); a lane reads its own country or nothing (SCOUT_BOARD_ONLY, cells.pick `only`);
no lane's copy is ever saved as the memory: merge copies only what is keyed by the lane's country (facts, the cells' rest, search words, re-read
stamps) and the browser's stops, which are final for every country. Google's results are off in a lane (no SCOUT_SERPAPI_KEY there): their month
count is one number of the whole memory, not a country's.
Why (13 Nov 2026, owner: "Maybe we just need to run the Board discovery" "many times in parallel"): a pass reads one country, and two runs at once
would have saved over each other's memory (one file), so the map filled one country at a time.
Tests: tests/unit/sources/test_scout_board_lanes.py."""
import os
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

from . import scout_board_cells as cells, scout_board_priority, scout_boards, scout_cells

ONLY_ENV = 'SCOUT_BOARD_ONLY'   # a lane's country, by code or name (the lab's workflow sets it from `--board-lanes`)
MAX_LANES = 8                   # lanes a round may start: each is a board pass with its own AI cap (src/scout_boards.py JOB_CALLS)
BY_COUNTRY = ((cells.CELLS, 0), (cells.WORDS, 0), (cells.REREAD, 1))   # scout_meta memories and where the country sits in their "a|b" keys


def only(text):
    """The one country a lane may read, as a set, from SCOUT_BOARD_ONLY's text; None when it is not a lane. Raises ValueError for a country the list does not know
    (a lane that read any country would write over another lane's)."""
    code = scout_boards.named_country(text)
    return {code} if code else None


def countries(db, lanes, today=None, priority=()):
    """Up to `lanes` different countries (at most MAX_LANES), in the order single passes would take them: each next one is picked with the earlier ones left out."""
    left, taken = set(scout_cells.EUROPE), []
    for _ in range(max(0, min(int(lanes), MAX_LANES))):
        turn = cells.pick(db, today, priority=priority, only=left)
        if not turn:
            break
        taken.append(turn[0])
        left.discard(turn[0])
    return taken


def merge(db, path, country):
    """Copy what a lane kept for its country from its copy of the memory (path) into the memory. Returns the facts copied; 0 without the file."""
    if not Path(path).is_file():
        return 0
    scout_boards.ensure(db)
    with closing(sqlite3.connect(path)) as lane:
        scout_boards.ensure(lane)
        facts = lane.execute('SELECT host, country, url, families, local_jobs, read_at, browser, layout, family_jobs, listed_families FROM scout_board_facts WHERE country = ?', (country,)).fetchall()
        stops = lane.execute('SELECT host, why, at FROM scout_browser_final').fetchall()
        theirs = {key: scout_cells._meta(lane, key, {}) for key, _ in BY_COUNTRY}
    db.executemany('INSERT OR REPLACE INTO scout_board_facts (host, country, url, families, local_jobs, read_at, browser, layout, family_jobs, listed_families) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', facts)
    db.executemany('INSERT OR IGNORE INTO scout_browser_final (host, why, at) VALUES (?, ?, ?)', stops)
    for key, part in BY_COUNTRY:
        own = {name: value for name, value in (theirs[key] if isinstance(theirs[key], dict) else {}).items() if name.split('|')[part:part + 1] == [country]}
        if own:
            held = scout_cells._meta(db, key, {})
            scout_cells._set(db, key, {**(held if isinstance(held, dict) else {}), **own})
    db.commit()
    return len(facts)


def plan(db_path, lanes):
    """`--board-lanes N`: prints the round's countries on one line (codes, spaces between; an empty line when every cell rests). Returns the exit code.
    The memory is started as a pass starts it (cells.seed), its lines on stderr so the one line stays the answer."""
    from . import store
    with closing(store.connect(db_path)) as db:
        cells.seed(db, os.environ.get('SCOUT_BOARD_SEED_DB'), lambda line: print(line, file=sys.stderr))
        named = cells.parse(os.environ.get('SCOUT_BOARD_PRIORITY'))
        print(' '.join(countries(db, lanes, priority=scout_board_priority.priority(named, db=db))))
    return 0


def merge_all(db_path, pairs, out=print):
    """`--board-merge sk=<path> nl=<path>`: each lane's country merged from its copy, then the cells' line of the whole memory. Returns the exit code."""
    from . import pool_tags, store
    with closing(store.connect(db_path)) as db:
        for pair in pairs:
            name, _, path = pair.partition('=')
            try:
                country = scout_boards.named_country(name)
            except ValueError:
                country = None
            if not country or not path:
                out(f'Board lanes: {pair!r} is not <country>=<path>: left out')
                continue
            out(f'Board lanes: {pool_tags.COUNTRIES[country]}: {merge(db, path, country)} boards with local jobs came back from its lane')
        out(cells.line(db, priority=cells.parse(os.environ.get('SCOUT_BOARD_PRIORITY'))))
    return 0
