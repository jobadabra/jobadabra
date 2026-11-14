"""One Job Matches row per job: find rows that are the same job (same URL, ignoring tracking parameters, a
trailing slash or the host's case) and keep the one with the most information; the others go to Notion's trash
(restorable for 30 days). Used by the sync (it heals itself when it meets duplicates)."""
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING = ('utm_', 'gh_src', 'gh_jid_src', 'ref', 'source', 'src', 'lever-source', 'trk', 'fbclid', 'gclid')
# Which row wins: the one that records a decision (Applied, Dismissed), then an open job, then the most recently scored.
STATUS_RANK = {'Applied': 5, 'Dismissed': 4, 'Open': 3, 'Not seen': 2, 'Closed': 1}


IDENTIFYING_FRAGMENT = re.compile(r'/|^jp-|^job:|[0-9a-f]{12,}', re.I)
UNLINKED = 'job:'   # the fragment that names a job a listing page shows with no link of its own (unlinked_job_url)


def unlinked_job_url(page, title, employer='', place=''):
    """The address of a job a listing page names with no link of its own: the page, then `#job:` and the employer's, the title's and the card's place words.
    Invariants: the same job read again (the next search, the list in another order) gets the same address, so the store's key finds its row; two
    jobs on one page differ unless the page names one employer's same title in the same place twice (one ad listed again, as store.same_job counts a
    board's repeats; same_job also tells two cities apart). `place` is the card's own, never the page's: a staffing site or an aggregator is the
    "employer" of every card, so one title in two towns is two jobs (sa, 14 Nov 2026);
    normalize_url keeps the fragment (IDENTIFYING_FRAGMENT `^job:`).
    Why (xc, 14 Nov 2026): the AI page reader gave such jobs the page as their address and a layout `page#title`, whose fragment normalize_url
    dropped; the board read keeps one job per address and the store one row per key, so a page's 22 jobs became 1 (LisboaUX) and 54 kept became 8 new
    (a Madrid electrician board). A position number (#1, #2) is not an identity: the list reorders between searches."""
    words = '-'.join(re.findall(r'\w+', f'{employer or ""} {title or ""} {place or ""}'.lower()))
    return f"{urlsplit(page)._replace(fragment='').geturl()}#{UNLINKED}{words}"


def normalize_url(url):
    """The same job's URL, whatever tracking parameters, trailing slash or host case it came with."""
    parts = urlsplit((url or '').strip())
    if not parts.scheme:
        return (url or '').strip()
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not k.lower().startswith(TRACKING)]
    # A fragment is usually an in-page anchor (#apply), but some links are only told apart by it: an email
    # (mail.google.com/…/#all/<id>), a recruiter lead (…#jp-<digest>), a hash-routed board (#/jobs/123).
    fragment = parts.fragment if IDENTIFYING_FRAGMENT.search(parts.fragment) else ''
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip('/') or '/', urlencode(sorted(query)), fragment))


def _url(page):
    return ((page['properties'].get('Job URL') or {}).get('url') or '').strip()


def _status(page):
    return ((page['properties'].get('Status') or {}).get('select') or {}).get('name')


def _scored(page):
    return (((page['properties'].get('Scored') or {}).get('date') or {}).get('start')) or ''


def keeper(pages):
    """The row to keep among copies of one job, and why."""
    best = max(pages, key=lambda p: (STATUS_RANK.get(_status(p), 0), _scored(p), p.get('last_edited_time', '')))
    others = [p for p in pages if p is not best]
    if any(STATUS_RANK.get(_status(p), 0) < STATUS_RANK.get(_status(best), 0) for p in others):
        why = f'its status is {_status(best)}'
    elif any(_scored(p) < _scored(best) for p in others):
        why = f'scored most recently ({_scored(best)})'
    else:
        why = 'edited most recently'
    return best, why


def plan(pages):
    """[{url, keep, drop: [...], why}] for every job with more than one row (pages: Job Matches rows)."""
    groups = {}
    for page in pages:
        if _url(page):
            groups.setdefault(normalize_url(_url(page)), []).append(page)
    out = []
    for key, copies in groups.items():
        if len(copies) > 1:
            keep, why = keeper(copies)
            out.append({'url': _url(keep), 'keep': keep, 'drop': [p for p in copies if p is not keep], 'why': why})
    return sorted(out, key=lambda g: g['url'])
