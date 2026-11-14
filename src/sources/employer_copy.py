"""A LinkedIn job's own copy on its employer's job feed: the job is kept under the employer's address, so Apply opens the employer's page and no LinkedIn sign-in is needed.
Why (owner, 14 Nov 2026, asked via AskUserQuestion: "Employer's own posting (Recommended)"; "that's very logical to me"): the app treats a linkedin.com job as Easy Apply
(desktop/lib/easy-apply-batch.js settle), so a guest-found job whose Apply goes to the employer opened only with Easy Apply on and a LinkedIn sign-in, and LinkedIn's logged-out
page names no employer address (a sign-in box only). Only employers the downloaded index already knows (src/employer_index.py) are read: no guessed slugs, each feed once a press,
at most MAX_EMPLOYERS. A job matches only when exactly one feed job has its identity (src/store.py identity) and the places agree; anything else keeps LinkedIn's copy.
Tests: tests/unit/sources/test_employer_copy.py."""
import re

from .. import store
from . import ats

MAX_EMPLOYERS = 5   # feeds read per press for LinkedIn's jobs, inside the LinkedIn lane and before its read cut (src/sources/read_budget.py deadline)
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
    feed, country = store.folded(feed_place), store.folded((listed or '').rsplit(',', 1)[-1]).strip() if ',' in (listed or '') else ''
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


def prefer_employer(jobs, index, fetch=None, limit=MAX_EMPLOYERS, log=print, past_cut=_past_cut):
    """`jobs` (LinkedIn's, as read) with each one its employer's feed lists under the employer's address, description and date; LinkedIn's place stays (it is the place
    the job was listed for). `fetch(ats, slug)` -> jobs or None (src/sources/ats.py probe). A feed that fails, is past `limit` or would start after the read cut leaves its jobs as they were; a moved job carries no LinkedIn apply route. -> a new list."""
    fetch = fetch or ats.probe   # looked up at call time, so a test's stand-in is the one read; None for a feed that is down, empty or changed shape
    feeds, out, moved = {}, [], 0
    for job in jobs:
        where = feed_of(job.get('company'), index)
        if where and where not in feeds and len(feeds) < limit and not past_cut():   # Why (Gitar on #4257): a slow feed never costs the LinkedIn jobs already read
            feeds[where] = list(fetch(*where) or ())   # a feed that is down or changed shape: LinkedIn's copy stays
        hit = match(job, feeds.get(where) or ()) if where else None
        if hit:
            moved += 1
            job = {**{key: value for key, value in job.items() if key != 'apply_route'}, 'id': hit['id'], 'url': hit['url'], 'description': hit.get('description') or job.get('description', ''),
                   'date_posted': hit.get('date_posted') or job.get('date_posted', ''), 'notes': 'also on LinkedIn'}
        out.append(job)
    if moved:
        log(f"LinkedIn: {moved} job(s) open on the employer's own site")
    return out
