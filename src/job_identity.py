"""The identity of a job a listing page names with no link of its own: one address the board read and the store both tell apart (unlinked_job_url)."""
import re
import unicodedata
from urllib.parse import urlsplit

UNLINKED = 'job:'   # the fragment's mark; src/notion/dedupe.py IDENTIFYING_FRAGMENT keeps a fragment that starts with it


def _words(text):
    """'Madrid, España' -> 'madrid-espana': lower case, accents folded, word characters only."""
    plain = unicodedata.normalize('NFKD', (text or '').lower()).encode('ascii', 'ignore').decode()
    return '-'.join(re.findall(r'\w+', plain))


def unlinked_job_url(page, title, employer='', place=''):
    """The address of a job a listing page names with no link of its own: the page, then `#job:` and its employer, title and place, each field's
    words apart (`--`), so `Dev` in `Madrid` is never the title `Dev Madrid`.
    Invariants: the same job read again (the next search, the list in another order) gets the same address, so the store's key finds its row; two
    jobs on one page differ unless the page names one employer's same title in the same place twice (one ad listed again, as store.same_job counts a
    board's repeats; same_job also tells two cities apart). `place` is the card's own, never the page's, and only its first part, as store._city
    reads it ('Madrid, España' and 'Madrid' are one place): a staffing site or an aggregator is the "employer" of every card, so one title in two
    towns is two jobs (sa, 14 Nov 2026).
    Why (xc, 14 Nov 2026): the AI page reader gave such jobs the page as their address and a layout `page#title`, whose fragment normalize_url
    dropped; the board read keeps one job per address and the store one row per key, so a page's 22 jobs became 1 (LisboaUX) and 54 kept became 8 new
    (a Madrid electrician board). A position number (#1, #2) is not an identity: the list reorders between searches."""
    first = re.split(r'[,;]| - ', place or '')[0]
    fields = '--'.join(_words(field) for field in (employer, title, first))
    return f"{urlsplit(page)._replace(fragment='').geturl()}#{UNLINKED}{fields}"
