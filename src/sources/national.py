"""National public employment services with an open feed, one row per country (Sweden's Arbetsförmedlingen first): where small local employers post.
Owner, 12 Nov 2026, asked via AskUserQuestion by sa ("Shall I add these national services to Find jobs' source list as our own sources, reading their
official open feeds where they exist?"): "Yes, add them (Recommended)". Why: in 30 fictional profiles (GTM 6 re-measure, EURES off) EURES's jobs and ours
overlapped in 0; Stockholm · Customer Support Agent: 8 right jobs found, 45 in Sweden's public feed. This reader is not EURES and never waits for it.

A service is read only for a person with a place in its own country: each place word's country, point and radius are the map's (src/geo.py resolve, the
AI's answer kept once per word, as EURES reads them); no host or country list beyond each service's own country. Each place is asked by its point and
radius (a town or area) or as the whole country (a country word), nearest first in the person's place order; every role word's first page before any second
page (EURES's role words: the board searches, then the role words, in the person's language and the local one as the search has them). Titles and places are
judged later as for every reader (aggregators.kept). Honest client (aggregators._get: our own user agent, src/sources/host_pace.py: a 401/403 is never
retried, a 429 waits as the site asks); a failure ends the read, keeping what was read; no key.
Read by: src/sources/reader_rows.py (one row per service, in the free job APIs' lane). Tests: tests/unit/sources/test_national.py.
"""
import http.client
import urllib.error
import urllib.parse
from dataclasses import dataclass
from typing import Callable

from .. import geo, time_budget
from ..press import budget

PAGES = budget.value('national.PAGES')   # per role word and place
MOST = budget.value('national.MOST')   # per read: the titles' AI after it keeps its load


@dataclass(frozen=True)
class Service:
    """One country's public employment service. url(word, place, offset) -> the search page for a role word in one place entry (geo: kind, lat, lon, r) or the whole
    country (place None); rows(answer) -> (jobs as listed, the answer's total); size: rows a page holds (a shorter page is the last)."""
    name: str
    country: str
    url: Callable
    rows: Callable
    size: int


def _sweden_url(word, place, offset):
    """Arbetsförmedlingen's JobSearch API (jobsearch.api.jobtechdev.se/search, OpenAPI 1.37: no security scheme, ads CC0, limit 0-100, offset 0-2000;
    `position` + `position.radius` in km take a point, so no place table of its own is needed)."""
    query = {'q': word, 'limit': SWEDEN_PAGE, 'offset': offset}
    if place:
        query.update({'position': f"{place['lat']},{place['lon']}", 'position.radius': max(int(place['r'] or 0), 1)})
    return 'https://jobsearch.api.jobtechdev.se/search?' + urllib.parse.urlencode(query)


def _sweden_rows(answer):
    """The ads of one answer as jobs: its Platsbanken page as the address, its workplace's municipality as the location."""
    from . import aggregators
    jobs = []
    for ad in answer.get('hits') or []:
        if not (ad.get('id') and ad.get('headline') and ad.get('webpage_url')):
            continue
        where = ad.get('workplace_address') or {}
        town = where.get('municipality') or where.get('city') or where.get('region')
        location = f"{town}, {geo.country_name('SE') or 'Sweden'}" if town else (geo.country_name('SE') or 'Sweden')
        jobs.append(aggregators._job('platsbanken', ad['id'], ad['headline'], (ad.get('employer') or {}).get('name'), location, ad['webpage_url'],
                                     str(ad.get('publication_date') or '')[:10], (ad.get('description') or {}).get('text') or ''))
    return jobs, int((answer.get('total') or {}).get('value') or 0)


SWEDEN_PAGE = 100
SERVICES = (
    Service('Platsbanken', 'SE', _sweden_url, _sweden_rows, SWEDEN_PAGE),
)


def places(search, country, client=None):
    """The person's places in this country, nearest first: geo entries of their towns and areas, or [None] (the whole country) when they name the country
    itself and no town or area in it. [] when none of their places is in it (the service is not asked)."""
    from ..places import place_words
    words = place_words(search, per_group=6)   # the one reading of the place fragments (src/places.py), in the person's place order
    mapped = geo.resolve(words, client)
    mine = [mapped[geo.norm(word)] for word in words if (mapped.get(geo.norm(word)) or {}).get('cc') == country]
    near = [entry for entry in mine if entry['kind'] in ('city', 'area')]
    return near or ([None] if any(entry['kind'] == 'country' for entry in mine) else [])


def _stop_at():
    """The monotonic time after which no new page is asked: the read cut less its grace, as for an employer site (src/sources/read_budget.py), so the
    lane still judges these titles before it stops waiting; None without a run budget."""
    from . import read_budget
    cut = read_budget.cut_at()
    return None if cut is None else cut - time_budget.part(read_budget.READ_GRACE)


def read(service, search, get=None, client=None):
    """The service's jobs for the person's role words in their places in its country, as listed (never kept or sorted here; aggregators.kept does).
    [] when no place is in the country. A failure ends the read: what was read is kept and said in one line; one that read nothing raises."""
    from . import aggregators, eures
    get = get or aggregators._get
    areas = places(search, service.country, client)
    words = eures._words(search)   # the one reading of a public search's role words (EURES's)
    if not areas or not words:
        return []
    stop, jobs, seen = _stop_at(), [], set()
    try:
        for place in areas:
            left = list(words)
            for page in range(PAGES):
                for word in list(left):
                    if len(jobs) >= MOST or (stop is not None and time_budget.now() >= stop):
                        print(f'{service.name}: {min(len(jobs), MOST)} job(s) read; the rest waits for the next search', flush=True)
                        return jobs[:MOST]
                    listed, total = service.rows(get(service.url(word, place, page * service.size)))
                    if len(listed) < service.size or (page + 1) * service.size >= total:
                        left.remove(word)
                    for job in listed:
                        if job['url'] not in seen:
                            seen.add(job['url'])
                            jobs.append(job)
    except (OSError, http.client.HTTPException, ValueError) as error:
        if not jobs:
            raise
        code = getattr(error, 'code', None) if isinstance(error, urllib.error.HTTPError) else None
        print(f'{service.name}: stopped ({type(error).__name__}{f" {code}" if code else ""}), keeping the {len(jobs)} read; nothing more asked', flush=True)
    return jobs[:MOST]
