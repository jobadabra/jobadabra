"""The central scout's board pass: per thin country, the boards that give jobs located there, published as board facts.
Why: 24 Oct 2026 (owner, "A. Central scout measures boards"): a first search in a country with no installs (Moldova) found 7 to 22 local jobs depending on
which boards the AI happened to name, because the shared-board facts need installs in the country. One country a run: the AI proposes its boards
(board_ideas), the engine reads each by rules only (no AI page reader: the owner chose "rules only" on 24 Oct 2026), the jobs whose place is in that country
are counted, and a board with MIN_LOCAL of them is kept as a fact. The index publish sends the facts (site: api/employers.js board_facts), where they are
served as the same board fact installs share. Never worldwide remote: only a job whose place names the country counts.
Google's results add boards the AI never names (src/scout_google_boards.py). Tests: tests/unit/sources/test_scout_boards.py.
Why (12 Nov 2026, owner: "own job"): the pass ran last inside the scout's run and found the run's AI calls spent by the passes before it (lab France run
43149389454: "its AI calls: 1 of 24", every later call refused at the relay's cap). It is its own job now (`python -m src scout --board-pass`, jobadabra-lab
central-scout.yml), behind its own relay with its own cap (JOB_CALLS); the scout's run only publishes the facts kept (facts())."""
import time
from datetime import datetime, timedelta, timezone

from . import pool_tags, role_kinds, scout_cells, scout_google_boards

MIN_LOCAL = 3           # local jobs a board needs before it is published (the site refuses fewer)
FACT_DAYS = 30          # a fact not measured again within this long is no longer published (the site drops it too)
MAX_BOARDS = 12         # boards read per country and run
BUDGET_S = 240          # the pass gives up starting new boards after this long
# Why (12 Nov 2026, owner: "Reserve kinds + batch places"): France trial 43154452142 asked one call per place, its 24 calls for places and kinds all went to
# places, and three boards with local jobs were never asked their kinds of work. Two allowances, each its one owner: places never spend the kinds' calls.
PLACE_CALLS = 2 * MAX_BOARDS   # place questions, 50 places a call (pool_tags.countries_each): a board's search page names at most ~100 distinct places
KIND_CALLS = MAX_BOARDS        # one kinds-of-work question a board (its first 40 titles, one batch), reserved
IDEA_CALLS = 1          # the AI's board ideas: one country is one slice (src/ai/board_ideas.py slices)
# The job's whole cap, the relay's and the engine's: every AI step of the pass on its own allowance, added up, so no step's calls are refused by another's:
# ideas 1 + Google's judge 15 + a board's country 12 + places 24 + kinds 12 = 64.
JOB_CALLS = IDEA_CALLS + scout_google_boards.MAX_JUDGED + MAX_BOARDS + PLACE_CALLS + KIND_CALLS
KINDS_PER_COUNTRY = 3   # the kinds of work one run asks boards for: the country's kinds take turns (kinds_for)
ASKED_KINDS = 'boards_kinds'   # the scout's memory: {country: [kinds asked, oldest first]}
RECENT = 4              # countries done lately wait their turn
PLACES, KINDS = 'central scout board places', 'central scout board kinds'   # the allowances' names


def ensure(db):
    db.execute('CREATE TABLE IF NOT EXISTS scout_board_facts (host TEXT NOT NULL, country TEXT NOT NULL, url TEXT NOT NULL, families TEXT NOT NULL, '
               'local_jobs INTEGER NOT NULL, read_at TEXT NOT NULL, PRIMARY KEY (host, country))')


def named_country(text):
    """The pool id of a country named by hand ("md" or "Moldova", any case); None for no name (the thinnest country's turn); a name no list knows
    raises ValueError naming the accepted ones: the by-hand scout run's country input.
    Why (12 Nov 2026, sa): "Slovakia" was unknown and the run silently read the thinnest country instead (Moldova), so a wrong name looked like a result."""
    wanted = str(text or '').strip().casefold()
    if not wanted:
        return None
    found = next((code for code, name in pool_tags.COUNTRIES.items() if wanted in (code, name.casefold())), None)
    if found is None:
        raise ValueError(f"unknown country {str(text).strip()!r}; accepted: {', '.join(f'{name} ({code})' for code, name in pool_tags.COUNTRIES.items())}")
    return found


def next_country(db, named=None):
    """The European country (pool id) whose boards are read next: the one named by hand, else the thinnest by employers with local jobs, not done
    lately; None without counts."""
    if named:
        scout_cells._set(db, 'boards_aimed', ([c for c in scout_cells._meta(db, 'boards_aimed', []) if c != named] + [named])[-RECENT:])
        db.commit()
        return named
    counted, recent = scout_cells._meta(db, 'country_totals', None), scout_cells._meta(db, 'boards_aimed', [])
    if not isinstance(counted, dict):
        return None
    thin = sorted((counted.get(c, 0), scout_cells.EUROPE.index(c), c) for c in scout_cells.EUROPE if c not in recent)
    if not thin:
        scout_cells._set(db, 'boards_aimed', [])
        db.commit()
        return None
    country = thin[0][2]
    scout_cells._set(db, 'boards_aimed', (recent + [country])[-RECENT:])
    db.commit()
    return country


def kinds_for(db, country, named=None):
    """The kinds of work this run asks a country's boards for: the ones named by hand, else the KINDS_PER_COUNTRY asked longest ago there (never asked first:
    software, then the thinnest by the central list's counts).
    Why (12 Nov 2026, sa; a by-hand pass of one country): "software and the 2 thinnest" was the same 3 kinds every run, so a country's boards for its other
    kinds were never asked for, and a search for a trade there read a board of another field (0 of its jobs fit)."""
    order = ('software', *scout_cells.AIMED)
    if named:
        return [kind for kind in dict.fromkeys(named) if kind in order]
    cells, asked = scout_cells._meta(db, 'cells', None), scout_cells._meta(db, ASKED_KINDS, None)
    cells, asked = cells if isinstance(cells, dict) else {}, (asked.get(country) or []) if isinstance(asked, dict) else []
    turn = lambda kind: (asked.index(kind) if kind in asked else -1, kind != 'software', cells.get(f'{kind}|{country}', 0), order.index(kind))
    return sorted(order, key=turn)[:KINDS_PER_COUNTRY]


def named_kinds(text):
    """The kinds of work named by hand ("trades, education", any case), the fixed ids only; [] for none: the by-hand run's kinds input."""
    wanted = [word.strip().casefold() for word in str(text or '').split(',')]
    return [kind for kind in dict.fromkeys(wanted) if kind in ('software', *scout_cells.AIMED)]


def _asked(db, country, kinds):
    """These kinds were asked for this country now: they go to the end of its turn list (one owner of the turns: the scout's memory, key ASKED_KINDS)."""
    held = scout_cells._meta(db, ASKED_KINDS, None)
    held = held if isinstance(held, dict) else {}
    held[country] = [kind for kind in held.get(country) or [] if kind not in kinds] + list(kinds)
    scout_cells._set(db, ASKED_KINDS, held)


def search_for(db, country, kinds=None):
    """The search the boards are proposed and read for: these kinds of work (kinds_for's when none are given), the whole country."""
    words = [word.strip() for kind in (kinds or kinds_for(db, country)) for word in role_kinds.WORK[kind].split(',') if word.strip()]
    return {'role_keywords': list(dict.fromkeys(words)),
            'locations': {'top_tier': [], 'country_wide': [pool_tags.COUNTRIES[country]], 'abroad': []}}


def family_search(country, families):
    """The search board discovery's cells are proposed and read for: the role families' own words (src/pool_tags.py FAMILIES), the whole country."""
    words = [word.strip() for family in families for word in pool_tags.FAMILIES.get(family, '').split(',') if word.strip()]
    return {'role_keywords': list(dict.fromkeys(words)),
            'locations': {'top_tier': [], 'country_wide': [pool_tags.COUNTRIES[country]], 'abroad': []}}


def _first(*groups):
    """The boards of these groups in order, each host once, at most MAX_BOARDS: facts read again, then Google's, then the AI's."""
    seen, out = set(), []
    for board in (board for group in groups for board in group):
        if board['host'] not in seen:
            seen.add(board['host'])
            out.append(board)
    return out[:MAX_BOARDS]


def local_of(jobs, country):
    """The jobs whose place is in `country`: every distinct place asked in one batch (pool_tags.countries_each); a place left unanswered is not local."""
    places = list(dict.fromkeys(str(job.get('location') or '').strip() for job in jobs if str(job.get('location') or '').strip()))
    where = pool_tags.countries_each(places)[0] if places else {}
    return [job for job in jobs if country in where.get(str(job.get('location') or '').strip(), ())]


def kinds_of(local):
    """(families, unanswered) of these jobs' titles (the first 40, one question): unanswered titles mean "not asked", never "no kinds"."""
    titles = list(dict.fromkeys(str(job.get('title') or '') for job in local if job.get('title')))[:40]
    return pool_tags.families_read(titles) if titles else ([], [])


def measure(board, local, country, families):
    """The fact for one board's read: its jobs in `country` and their role families; None under MIN_LOCAL or without families."""
    if len(local) < MIN_LOCAL or not families:
        return None
    return {'host': board['host'], 'url': board['search_url'], 'country': country, 'families': families, 'local_jobs': len(local)}


def run(db, ideas=None, read_board=None, clock=time.monotonic, out=print, named=None, google=None, country_of=None, kinds=None, families=None, again=()):
    """Read the next thin country's boards for this run's kinds of work (kinds: named by hand, else the country's next in turn) and keep the facts. Returns the facts kept (a list); never raises: the next scout run publishes what it kept.
    families: board discovery's cells (src/scout_board_cells.py): the boards are asked for these role families instead of kinds; again: kept facts' boards read first, to measure them again."""
    from .ai import board_ideas, cost, decide
    from .sources import careers, found_boards
    ensure(db)
    country = next_country(db, named)
    if not country:
        return []
    try:
        kinds = list(families) if families is not None else kinds_for(db, country, kinds) or kinds_for(db, country)   # named kinds that are none of ours: the country's turn
        search = family_search(country, kinds) if families is not None else search_for(db, country, kinds)
        proposed = (ideas or (lambda asked: board_ideas.ideas(asked, field=False)))(search)[:MAX_BOARDS] if kinds else []   # several kinds: no one field to ask for
        thin = [kind for kind in kinds if kind not in ('software', 'software_dev')]   # the few free searches: never the strongest kind
        found = (google or _google)(db, country, thin, out) if thin else []   # boards only Google's results name, judged by the AI first
        proposed = _first(list(again), found, proposed)
        began, kept, unread, counts = clock(), [], [], []
        reader, careers.READER = careers.READER, None   # rules only: the AI page reader is off for the scout's boards (owner, 24 Oct 2026)
        try:
            for board in proposed:
                if clock() - began > BUDGET_S:
                    break
                jobs, state, _ = (read_board or found_boards.read_board)(board, search, careers.get_text)
                with decide.own_allowance(PLACES, PLACE_CALLS):
                    local = local_of(jobs, country)
                placeless = [job for job in jobs if not str(job.get('location') or '').strip()]
                # a list with no places (they are on each job's page): the AI names the board's country; only 'this country' counts them
                whole = bool(placeless) and len(local) < MIN_LOCAL and (country_of or _country_of)(board, country) == 'this country'
                counted = local + placeless if whole else local
                families, unasked = [], []
                if len(counted) >= MIN_LOCAL:
                    with decide.own_allowance(KINDS, KIND_CALLS):
                        families, unasked = kinds_of(counted)
                fact = measure(board, counted, country, families)
                why = '' if fact or len(counted) < MIN_LOCAL else ' (kinds of work not asked: not kept)' if unasked else ' (no kinds of work from the AI: not kept)'
                counts.append(f"{board['host']} {len(jobs)}/{len(counted)}" + (' (no places; the AI: this country)' if whole else '') + why)
                if fact:
                    kept.append(fact)
                elif state in ('empty', 'browser'):
                    unread.append(board['host'])
        finally:
            careers.READER = reader
        stamp = datetime.now(timezone.utc).date().isoformat()
        for fact in kept:
            db.execute('INSERT OR REPLACE INTO scout_board_facts (host, country, url, families, local_jobs, read_at) VALUES (?, ?, ?, ?, ?, ?)',
                       (fact['host'], country, fact['url'], ','.join(fact['families']), fact['local_jobs'], stamp))
        if families is None:
            _asked(db, country, kinds)   # after the reads: a pass that failed before them keeps the kinds' turn (cells keep their own: src/scout_board_cells.py)
        db.commit()
        out(f"Board pass: {pool_tags.COUNTRIES[country]} ({', '.join(kinds)}): {len(proposed)} boards proposed, {len(kept)} with {MIN_LOCAL}+ local jobs"
            + (f"; listed/local: {', '.join(counts)}" if counts else '')
            + (f"; not measured (rules could not read the page): {', '.join(unread)}" if unread else '')
            + f"; its AI calls: places {decide.spent(PLACES)} of {PLACE_CALLS}, kinds {decide.spent(KINDS)} of {KIND_CALLS}, {sum(cost.TOPICS.values())} of {JOB_CALLS} in all")   # Why (12 Nov 2026): France's lines showed neither which question spent the calls nor whether the job's cap held
        return kept
    except Exception as error:  # noqa: BLE001 — the board pass is a bonus: a failure must never stop the index
        out(f'Warning: board pass skipped: {type(error).__name__}: {error}')
        return []


def _google(db, country, kinds, out):
    """The field boards Google's results name for these kinds in this country (src/scout_google_boards.py), each page judged by the AI."""
    from . import scout_google_boards
    from .sources import board_check, careers
    from .ai import decide

    def ask(*question):   # its own allowance: title sorting spends the scout's 600 first (owner, 26 Oct 2026, "Own 15-call allowance")
        return decide.one(*question, allowance=scout_google_boards.MAX_JUDGED)
    return scout_google_boards.boards(db, country, kinds, lambda board, roles: board_check.field_kind(board, careers.get_text, roles, ask=ask), out=out)


def _country_of(board, country):
    """The AI's answer to which country's jobs this board lists (src/sources/board_check.py lists_country), on the board pass's own allowance."""
    from .ai import decide
    from .sources import board_check, careers

    def ask(*question):
        return decide.one(*question, allowance=MAX_BOARDS)
    return board_check.lists_country(board, careers.get_text, pool_tags.COUNTRIES.get(country, country), ask=ask)


def facts(db, today=None):
    """Every fact measured within FACT_DAYS, as the index publish sends them: [{host, url, country, families, local_jobs}]."""
    ensure(db)
    cutoff = ((today or datetime.now(timezone.utc).date()) - timedelta(days=FACT_DAYS)).isoformat()
    return [{'host': host, 'url': url, 'country': country, 'families': families.split(','), 'local_jobs': jobs}
            for host, country, url, families, jobs in db.execute(
                'SELECT host, country, url, families, local_jobs FROM scout_board_facts WHERE read_at >= ? AND local_jobs >= ? ORDER BY country, host', (cutoff, MIN_LOCAL))]
