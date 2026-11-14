"""A LinkedIn job's own copy on its employer's job feed: the job is kept under the employer's address, so Apply opens the employer's page and no LinkedIn sign-in is needed.
Why (owner, 14 Nov 2026, asked via AskUserQuestion: "Employer's own posting (Recommended)"; "that's very logical to me"): the app treats a linkedin.com job as Easy Apply
(desktop/lib/easy-apply-batch.js settle), so a guest-found job whose Apply goes to the employer opened only with Easy Apply on and a LinkedIn sign-in, and LinkedIn's logged-out
page names no employer address (a sign-in box only). Known feeds first (the downloaded index and this Mac's feed_sources, src/scout_notion.py active_sources), each once a press,
at most MAX_EMPLOYERS; then, for at most MAX_GUESSES employers with no known feed, the employer's whole name on the common job systems (ats.name_slugs x ats.GUESSABLE,
owner, 14 Nov 2026, asked via AskUserQuestion: "Both": look up in the press and teach the Scout). A job matches only when exactly one feed job has its identity
(src/store.py identity) and the places agree, so a guessed feed of another company of that name never takes it; a guessed feed that held the job is registered for every
later press, and every employer left unresolved is handed to the Scout (src/sources/board_employers.py note). Anything else keeps LinkedIn's copy.
Tests: tests/unit/sources/test_employer_copy.py."""
import re
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, nullcontext as _nothing

from .. import store
from ..ai import slots
from . import ats

MAX_EMPLOYERS = 5   # feeds read per press for LinkedIn's jobs, inside the LinkedIn lane and before its read cut (src/sources/read_budget.py deadline)
MAX_GUESSES = 5     # employers with no known feed looked up by name per press, each on ats.GUESSABLE at once
WORLDWIDE = r'\b(?:worldwide|anywhere)\b'   # a feed place open from every country


def _company(name):
    """An employer name as identity() keys it ('Canonical Ltd' -> 'canonical'); '' for none or a placeholder."""
    return store.identity(name, 'x').split('|', 1)[0]


def feeds_of(company, index):
    """[(ats, slug)] of this employer's feeds in the index, each once: the exact name's first, then those where one name is the other's first words (store._same_company).
    Why (lg, 14 Nov 2026): GetYourGuide's index feed lacked its Zurich SRE job, which the Scout's newer Ashby feed listed; reading only the first feed missed it."""
    key = _company(company)
    named = [(entry, _company(entry.get('company'))) for entry in index or () if key and entry.get('ats') and (entry.get('slug') or entry.get('board'))]
    found = [(entry['ats'], entry.get('slug') or entry['board']) for exact in (True, False) for entry, other in named
             if other and (other == key if exact else store._same_company(key, other))]
    return list(dict.fromkeys(found))


def _places_agree(listed, feed_place):
    """LinkedIn's place and the feed job's agree: the same city (store.cities_agree), or the feed job is open worldwide or names the country LinkedIn listed it in
    ('Home based - Worldwide', 'Remote, Switzerland' for 'Zurich, Zurich, Switzerland'). Why (Gitar on #4257): a remote job open to one region only ('Remote - USA') is
    another posting, so any other remote place keeps LinkedIn's copy."""
    city = store._city(listed)
    if store.cities_agree(listed, feed_place) or (city and re.search(rf'\b{re.escape(city)}\b', store.folded(feed_place))):   # 'In office - Zürich' names Zurich
        return True
    feed, last = store.folded(feed_place), store.folded((listed or '').rsplit(',', 1)[-1]).strip() if ',' in (listed or '') else ''
    country = last if len(last) > 2 else ''   # Why (Gitar on #4259): 'New York, NY' ends in a state code, not a country
    return bool(re.search(WORLDWIDE, feed) or (country and re.search(rf'\b{re.escape(country)}\b', feed)))


def match(job, feed):
    """The one feed job that is this LinkedIn job, or None (none, or two that could be it)."""
    key = store.identity(job.get('company'), job.get('title'))
    same = {each['url']: each for each in feed if key and store.identity(job.get('company'), each.get('title')) == key and _places_agree(job.get('location'), each.get('location'))}
    return next(iter(same.values())) if len(same) == 1 else None   # one posting a careers page lists twice is one job (keyed by its address)


def _past_cut():
    """True once the lane's read cut has passed (src/sources/read_budget.py deadline): no new feed starts then; False without a budget."""
    from .. import time_budget
    from . import read_budget
    cut = read_budget.deadline()
    return cut is not None and time_budget.now() >= cut


def guess_feed(company, probe=None):
    """[(ats, slug, jobs)] of the live feeds named after this employer's whole name on the common job systems (ats.name_slugs x ats.GUESSABLE), in that order, read at once."""
    probe = probe or ats.probe
    tries = [(system, slug) for slug in ats.name_slugs(company or '')[:2] for system in ats.GUESSABLE]
    if not tries:
        return []
    with ThreadPoolExecutor(max_workers=min(9, len(tries))) as pool:
        found = list(pool.map(slots.carry(lambda each: probe(*each)), tries))   # the caller's level rides into the pool (src/ai/slots.py carry)
    return [(system, slug, list(jobs)) for (system, slug), jobs in zip(tries, found) if jobs]


def _moved(job, hit):
    """The LinkedIn job under its employer's posting: address, id, description and date from the feed; LinkedIn's place stays; no LinkedIn apply route."""
    return {**{key: value for key, value in job.items() if key != 'apply_route'}, 'id': hit['id'], 'url': hit['url'], 'description': hit.get('description') or job.get('description', ''),
            'date_posted': hit.get('date_posted') or job.get('date_posted', ''), 'notes': 'also on LinkedIn'}


def prefer_employer(jobs, index, fetch=None, limit=MAX_EMPLOYERS, log=print, past_cut=_past_cut, guess=guess_feed, register=lambda company, system, slug: None,
                    note=lambda jobs: None, guesses=MAX_GUESSES):
    """`jobs` (LinkedIn's, as read) with each one its employer's feed lists under the employer's address (_moved). `fetch(ats, slug)` -> jobs or None (src/sources/ats.py
    probe); `guess(company)` -> [(ats, slug, jobs)] (guess_feed); `register(company, ats, slug)` keeps a guessed feed that held a job; `note(jobs)` hands the jobs still
    on LinkedIn to the Scout. No feed starts after the read cut or past `limit` known feeds and `guesses` employers. -> a new list."""
    fetch = fetch or ats.probe   # looked up at call time, so a test's stand-in is the one read; None for a feed that is down, empty or changed shape
    feeds, out, moved, guessed = {}, [], 0, {}
    for job in jobs:
        known, hit = feeds_of(job.get('company'), index), None
        for where in known:
            if where not in feeds and len(feeds) < limit and not past_cut():   # Why (Gitar on #4257, #4264): a slow feed never costs the LinkedIn jobs already read, whichever of the employer's feeds it is
                feeds[where] = list(fetch(*where) or ())   # a feed that is down or changed shape: LinkedIn's copy stays
            hit = match(job, feeds.get(where) or ())
            if hit:
                break
        name = _company(job.get('company'))
        # Why (Gitar on #4270): a known feed that lacked the job (a stale index entry) or was not read (past the limit or the cut) is no answer: the name is tried too.
        if not hit and name and name not in guessed and len(guessed) < guesses and not past_cut():
            guessed[name] = guess(job.get('company'))
        for system, slug, feed in [] if hit else guessed.get(name) or ():
            if (system, slug) in known:
                continue   # already read above
            hit = match(job, feed)
            if hit:
                register(job.get('company'), system, slug)
                break
        if hit:
            moved += 1
            job = _moved(job, hit)
        out.append(job)
    left = [job for job in out if job.get('notes') != 'also on LinkedIn']
    if left:
        note(left)
    if moved:
        log(f"LinkedIn: {moved} job(s) open on the employer's own site")
    return out


def _local_feeds(db):
    """This Mac's own feeds (feed_sources, src/scout_core.py), as index entries; none before the Scout made its table."""
    try:
        return [{'company': row['company'], 'ats': row['ats'], 'slug': row['slug']} for row in db.execute('SELECT ats, slug, company FROM feed_sources WHERE active = 1')]
    except sqlite3.OperationalError as problem:
        if 'no such table' in str(problem):
            return []
        raise


def from_row(jobs):
    """LinkedIn's reader row's pass (src/sources/reader_rows.py): prefer_employer over the downloaded index (unless JOBADABRA_DISABLE=index) and this Mac's feeds; a
    guessed feed that held a job joins feed_sources, so every later press reads it; the jobs still on LinkedIn go to the Scout (LinkedIn employers). One connection a
    call, and no schema script on the read (Gitar on #4270: the app may hold the write lock).
    Why (Gitar on #4264): the bookkeeping writes (feed_sources, board_employers.json) never cost the jobs already read: a locked or read-only file is logged and skipped."""
    from .. import employer_index, paths, scout_core
    from ..features import disabled
    from . import board_employers
    index = [] if disabled('index') else employer_index.load()
    try:
        db = store.connect(paths.jobs_db())
    except (OSError, sqlite3.Error) as problem:
        print(f'LinkedIn: this Mac\'s own feeds not read ({type(problem).__name__}): the index only', flush=True)
        db = None
    with closing(db) if db is not None else _nothing():
        try:
            index = [*index, *(_local_feeds(db) if db is not None else [])]
        except sqlite3.Error as problem:
            print(f'LinkedIn: this Mac\'s own feeds not read ({type(problem).__name__}): the index only', flush=True)

        def register(company, system, slug):
            try:
                if db is None:
                    raise sqlite3.OperationalError('no jobs file')
                scout_core.ensure_tables(db)
                db.execute("INSERT OR IGNORE INTO feed_sources (ats, slug, company, tier, quality, added_at) VALUES (?, ?, ?, 'Standard', NULL, ?)",
                           (system, slug, (company or '')[:120], scout_core.now().isoformat(timespec='seconds')))
                db.commit()
            except (OSError, sqlite3.Error) as problem:
                print(f'LinkedIn: {company}\'s feed not kept ({type(problem).__name__}): looked up again next press', flush=True)
                return
            print(f'LinkedIn: {company} runs on {system} ({slug}): read by every search from now on', flush=True)

        def note(left):
            try:
                board_employers.note(left, 'LinkedIn')
            except OSError as problem:
                print(f'LinkedIn: employers not handed to the Scout ({type(problem).__name__})', flush=True)
        return prefer_employer(jobs, index, register=register, note=note)


def linkedin_jobs(search):
    """LinkedIn's reader row (src/sources/reader_rows.py): LinkedIn's public search (src/sources/linkedin_guest.py read), then from_row. The row's one seam
    (tests/unit/sources/test_reader_rows.py SEAMS), so a press test that stubs LinkedIn stubs its employer lookups too."""
    from . import linkedin_guest
    jobs = linkedin_guest.read(search)
    return from_row(jobs) if jobs else jobs
