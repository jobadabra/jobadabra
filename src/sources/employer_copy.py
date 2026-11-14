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

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing

from .. import store
from . import ats

MAX_EMPLOYERS = 5   # feeds read per press for LinkedIn's jobs, inside the LinkedIn lane and before its read cut (src/sources/read_budget.py deadline)
MAX_GUESSES = 5     # employers with no known feed looked up by name per press, each on ats.GUESSABLE at once
WORLDWIDE = r'\b(?:worldwide|anywhere)\b'   # a feed place open from every country


def _company(name):
    """An employer name as identity() keys it ('Canonical Ltd' -> 'canonical'); '' for none or a placeholder."""
    return store.identity(name, 'x').split('|', 1)[0]


def feed_of(company, index):
    """(ats, slug) of this employer's feed in the index, or None: the exact name first, then one name the other's first words (store._same_company)."""
    key = _company(company)
    if not key:
        return None
    named = [(entry, _company(entry.get('company'))) for entry in index or () if entry.get('ats') and (entry.get('slug') or entry.get('board'))]
    for exact in (True, False):
        for entry, other in named:
            if other and (other == key if exact else store._same_company(key, other)):
                return entry['ats'], entry.get('slug') or entry['board']
    return None


def _places_agree(listed, feed_place):
    """LinkedIn's place and the feed job's agree: the same city (store.cities_agree), or the feed job is open worldwide or names the country LinkedIn listed it in
    ('Home based - Worldwide', 'Remote, Switzerland' for 'Zurich, Zurich, Switzerland'). Why (Gitar on #4257): a remote job open to one region only ('Remote - USA') is
    another posting, so any other remote place keeps LinkedIn's copy."""
    if store.cities_agree(listed, feed_place):
        return True
    feed, last = store.folded(feed_place), store.folded((listed or '').rsplit(',', 1)[-1]).strip() if ',' in (listed or '') else ''
    country = last if len(last) > 2 else ''   # Why (Gitar on #4259): 'New York, NY' ends in a state code, not a country
    return bool(re.search(WORLDWIDE, feed) or (country and re.search(rf'\b{re.escape(country)}\b', feed)))


def match(job, feed):
    """The one feed job that is this LinkedIn job, or None (none, or two that could be it)."""
    key = store.identity(job.get('company'), job.get('title'))
    same = [each for each in feed if key and store.identity(job.get('company'), each.get('title')) == key and _places_agree(job.get('location'), each.get('location'))]
    return same[0] if len(same) == 1 else None


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
        found = list(pool.map(lambda each: probe(*each), tries))
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
        where = feed_of(job.get('company'), index)
        if where and where not in feeds and len(feeds) < limit and not past_cut():   # Why (Gitar on #4257): a slow feed never costs the LinkedIn jobs already read
            feeds[where] = list(fetch(*where) or ())   # a feed that is down or changed shape: LinkedIn's copy stays
        hit = match(job, feeds.get(where) or ()) if where else None
        name = _company(job.get('company'))
        if not where and name and name not in guessed and len(guessed) < guesses and not past_cut():
            guessed[name] = guess(job.get('company'))
        for system, slug, feed in [] if where or hit else guessed.get(name) or ():
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
    """This Mac's own feeds (feed_sources, src/scout_core.py), as index entries."""
    return [{'company': row['company'], 'ats': row['ats'], 'slug': row['slug']} for row in db.execute('SELECT ats, slug, company FROM feed_sources WHERE active = 1')]


def from_row(jobs):
    """LinkedIn's reader row's pass (src/sources/reader_rows.py): prefer_employer over the downloaded index (unless JOBADABRA_DISABLE=index) and this Mac's feeds; a
    guessed feed that held a job joins feed_sources, so every later press reads it; the jobs still on LinkedIn go to the Scout as board employers."""
    from .. import employer_index, paths, scout_core
    from ..features import disabled
    from . import board_employers
    index = [] if disabled('index') else employer_index.load()
    with closing(store.connect(paths.jobs_db())) as db:
        scout_core.ensure_tables(db)
        index = [*index, *_local_feeds(db)]

    def register(company, system, slug):
        with closing(store.connect(paths.jobs_db())) as db:
            db.execute("INSERT OR IGNORE INTO feed_sources (ats, slug, company, tier, quality, added_at) VALUES (?, ?, ?, 'Standard', NULL, ?)",
                       (system, slug, (company or '')[:120], scout_core.now()))
            db.commit()
        print(f'LinkedIn: {company} runs on {system} ({slug}): read by every search from now on', flush=True)
    return prefer_employer(jobs, index, register=register, note=lambda left: board_employers.note(left, 'LinkedIn'))
