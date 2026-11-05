"""One Jobs row per posting when the same job is listed on several job sites (look-alikes on one site stay separate: see _same_posting).

Owner, 5 Nov 2026 ("Yes + marks every copy"; a tester: "the same posting shows up several times in Jobs"). The stored rows are never touched: only the list
merges, and the row says which other sites list it ("Also on jobup.ch") and carries every copy's link so a status change reaches them all.
Guarded by tests/unit/notion/test_job_copies.py.
"""
import re
import unicodedata
from urllib.parse import urlsplit

from .notion import origin as origin_rule

# The strength of a decision on a copy (see _best).
STATUS_RANK = {'applied': 4, 'dismissed': 3, 'saved': 2}


def _plain(text):
    """A name as one comparable string: case, punctuation and spacing do not tell two postings apart."""
    return ' '.join(re.sub(r'[\W_]+', ' ', unicodedata.normalize('NFKC', str(text or '')).casefold()).split())


def _site(url):
    try:
        host = (urlsplit(url or '').hostname or '').lower()
    except ValueError:   # a crawled link like "http://[bad/1": no site, so its group is never merged
        return ''
    return host[4:] if host.startswith('www.') else host


def _key(row):
    """(company, title, place) of a posting you went after, or None when any of the three is not named (an unnamed place is unknown, never "the same place")
    or the job found you (a recruiter's pitch is a conversation, not a listing)."""
    if origin_rule.is_inbound(source=row.get('source') or '', stage=row.get('stage') or '', notes=row.get('notes') or '', origin=row.get('origin') or ''):
        return None
    key = (_plain(row.get('company')), _plain(row.get('title')), _plain(row.get('location')))
    return key if all(key) else None


def _same_posting(copies):
    """True when these rows with one (company, title, place) are one posting listed on different sites. Two rows on the SAME site stay two: a retailer's
    four "Vendeur, Lausanne" openings look alike and are four jobs, and telling a repost from a second opening is a judgment about the posting text (the AI's, not
    a rule here). Copies that each hold a stage DO merge: marking a merged row Applied writes the stage on every copy (pages/jobs-copies.js), and the row must stay one."""
    sites = [_site(row.get('url')) for row in copies]
    return '' not in sites and len(set(sites)) == len(sites)


def _best(row):
    """Which copy is the row: the one holding a decision or a prepared kit (a stage, or applied / saved / dismissed) before any unread one, whatever its fit
    (its kit and Notion page are the row's); then the stronger decision, then the better fit."""
    fit = row.get('fit')
    decided = bool(row.get('stage')) or STATUS_RANK.get(row.get('status'), 0) > 0
    return (decided, STATUS_RANK.get(row.get('status'), 0), fit if isinstance(fit, (int, float)) else -1, row.get('rank') or 0)


def merge_copies(rows):
    """The list with each posting once. A merged row is its best copy (a decision, then the fit) plus `copies` (every link, its own first) and `also_on`
    (the other sites). Rows that are not copies of anything stay as they are; the order of the list is kept."""
    groups, order = {}, []
    for row in rows:
        key = _key(row) or ('', id(row))   # a row with no key is its own group
        if key not in groups:
            order.append(key)
        groups.setdefault(key, []).append(row)
    merged = []
    for key in order:
        copies = groups[key]
        if len(copies) == 1 or not _same_posting(copies):
            merged.extend(copies)
            continue
        best = max(copies, key=_best)
        others = [row for row in copies if row is not best]
        merged.append({**best, 'copies': [best['url'], *(row['url'] for row in others)], 'also_on': sorted(_site(row['url']) for row in others)})
    return merged
