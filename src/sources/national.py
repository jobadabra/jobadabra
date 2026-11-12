"""National public employment services, one row per country (Sweden's Arbetsförmedlingen, Belgium's Le Forem, Norway's NAV): where small local employers post.
Owner, 12 Nov 2026, asked via AskUserQuestion by sa ("Shall I add these national services to Find jobs' source list as our own sources, reading their
official open feeds where they exist?"): "Yes, add them (Recommended)". Why: in 30 fictional profiles (GTM 6 re-measure, EURES off) EURES's jobs and ours
overlapped in 0; Stockholm · Customer Support Agent: 8 right jobs found, 45 in Sweden's public feed. This reader is not EURES and never waits for it.
Owner, 12 Nov 2026, via sa: "you just did something from Sweden but that's it": Belgium's row in the same change.

A service is read only for a person with a place in its own country: each place word's country, point and radius are the map's (src/geo.py resolve, the
AI's answer kept once per word, as EURES reads them); no host or country list beyond each service's own country. Each place is asked by its point and
radius (a town or area) or as the whole country (a country word), nearest first in the person's place order; every role word's first page before any second
page (EURES's role words: the board searches, then the role words, in the person's language and the local one as the search has them). Titles and places are
judged later as for every reader (aggregators.kept). Honest client (aggregators._get: our own user agent, src/sources/host_pace.py: a 401/403 is never
retried, a 429 waits as the site asks); a failure ends the read, keeping what was read; no key in the app. A feed that needs a key (Norway's) is read through our
site with the install's index token (_site_get); without it, the read asks nothing and says nothing. Each job keeps its posting date and its own address at the service.
Read by: src/sources/reader_rows.py (one row per service, in the free job APIs' lane). Tests: tests/unit/sources/test_national.py.
"""
import http.client
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable

from .. import geo, time_budget
from ..press import budget

PAGES = budget.value('national.PAGES')   # per role word and place
NAV_PAGE = 'https://arbeidsplassen.nav.no/stillinger/stilling/'   # an ad's own page at NAV: the only address a Norwegian row may carry
_UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')   # NAV's ad ids, as the site validates them (jobadabra-web api/national.js rowOf)
OFF = None   # what a service's own fetch answers when it is off for this install (no token, the site says 204 or 401, a run that must not ask the site)
PAGE = 100   # rows a page asks: the most both feeds give (JobSearch limit 0-100; Opendatasoft "-1 <= limit <= 100", asked 12 Nov 2026)
MOST = budget.value('national.MOST')   # per read: the titles' AI after it keeps its load


@dataclass(frozen=True)
class Service:
    """One country's public employment service. url(word, place, offset) -> the search page for a role word in one place entry (geo: kind, lat, lon, r) or the whole
    country (place None); rows(answer) -> (jobs as listed, the answer's total); size: rows a page holds (a shorter page is the last); get(url) -> the parsed
    answer, for a service read through our site with the install's token (None: the plain public fetch, aggregators._get); it answers OFF when the service is
    off for this install, which ends the read without a word.
    Why (12 Nov 2026, fw via sa): a country whose feed needs a key the app never holds is read through our site, never with a key in the app."""
    name: str
    country: str
    url: Callable
    rows: Callable
    size: int
    get: Callable = None


def _sweden_url(word, place, offset):
    """Arbetsförmedlingen's JobSearch API (jobsearch.api.jobtechdev.se/search, OpenAPI 1.37: no security scheme, ads CC0, limit 0-100, offset 0-2000;
    `position` + `position.radius` in km take a point, so no place table of its own is needed)."""
    query = {'q': word, 'limit': PAGE, 'offset': offset}
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
        location = _where(where.get('municipality') or where.get('city') or where.get('region'), 'SE')
        jobs.append(aggregators._job('platsbanken', ad['id'], ad['headline'], (ad.get('employer') or {}).get('name'), location, ad['webpage_url'],
                                     str(ad.get('publication_date') or '')[:10], (ad.get('description') or {}).get('text') or ''))
    return jobs, int((answer.get('total') or {}).get('value') or 0)


def _belgium_url(word, place, offset):
    """Le Forem's job offers on the Walloon open-data portal (odwb.be, Opendatasoft Explore v2.1, dataset offres-d-emploi-forem: no key, licence CC BY-SA 4.0,
    publisher Le Forem; Wallonia and part of Brussels). `within_distance` on the offers' own points takes the place's point and radius, as Sweden's feed does."""
    words = word.replace('\\', ' ').replace('"', ' ')   # the word goes inside an ODSQL string
    where = f'search("{words}")'
    if place:
        where += f" and within_distance(lieuxtravailgeo, geom'POINT({place['lon']} {place['lat']})', {max(int(place['r'] or 0), 1)}km)"
    query = {'where': where, 'limit': PAGE, 'offset': offset}
    return 'https://www.odwb.be/api/explore/v2.1/catalog/datasets/offres-d-emploi-forem/records?' + urllib.parse.urlencode(query)


def _belgium_rows(answer):
    """The offers of one answer as jobs: their leforem.be page as the address (the licence's attribution: the source and the offer's own page go with each job),
    the first workplace town as the location, the trade and sector as the short description (the dataset has no posting text)."""
    from . import aggregators
    jobs = []
    for offer in answer.get('results') or []:
        if not (offer.get('numerooffreforem') and offer.get('titreoffre') and offer.get('url')):
            continue
        town = next((str(t).title() for t in offer.get('lieuxtravaillocalite') or [] if t), '')
        about = ' · '.join(str(part) for part in (offer.get('metier'), *(offer.get('secteurs') or []), offer.get('typecontrat'), offer.get('regimetravail')) if part)
        jobs.append(aggregators._job('forem', offer['numerooffreforem'], offer['titreoffre'], offer.get('nomemployeur'), _where(town, 'BE'), offer['url'],
                                     str(offer.get('datedebutdiffusion') or '')[:10], about))
    return jobs, int(answer.get('total_count') or 0)


def _norway_url(word, place, offset):
    """Norway's public employment service (NAV's arbeidsplassen.no), kept by our site because NAV's feed needs a key the app never holds
    (jobadabra-web api/national.js: GET /api/index/national under the employer index's install token; 204 = the country off). Same point and radius as above."""
    from .. import service
    query = {'country': 'no', 'q': word, 'offset': offset}
    if place:
        query.update({'lat': place['lat'], 'lon': place['lon'], 'r': max(int(place['r'] or 0), 1)})
    return f'{service.SITE}/api/index/national?' + urllib.parse.urlencode(query)


def _norway_rows(answer):
    """The site's rows as jobs, checked again here (fixed fields, a NAV ad id, the ad's own page at NAV as the address); the site sends no posting text."""
    from . import aggregators
    jobs = []
    for row in (answer or {}).get('rows') or []:
        if not (isinstance(row, dict) and _UUID.fullmatch(str(row.get('id') or '')) and str(row.get('url') or '').startswith(NAV_PAGE)
                and isinstance(row.get('title'), str) and row['title'].strip()):
            continue
        jobs.append(aggregators._job('arbeidsplassen', row['id'], row['title'][:300], str(row.get('employer') or '')[:200],
                                     _where(str(row.get('place') or '')[:80], 'NO'), row['url'], str(row.get('date') or '')[:10]))
    total = (answer or {}).get('total')
    return jobs, total if isinstance(total, int) and total >= 0 else 0


def _site_get(url):
    """One page from our site with this install's index token, or OFF: a run that must not ask the site (service.site_off: tests, CI, smoke), no token, or the
    site's 204 (the country off, or NAV's key not on the site) or 401 (the token refused). Never retried; any other error is the read's failure as usual."""
    from .. import employer_index, service
    from . import ats
    if service.site_off():
        return OFF
    install = service.install_id()
    token = employer_index._mint(service.SITE, install)
    if not token:
        return OFF
    request = urllib.request.Request(url, headers={'User-Agent': ats.USER_AGENT, 'Authorization': f'Bearer {token}', 'X-Install-Id': install, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=service.TIMEOUT) as response:
            return OFF if response.status == 204 else json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 401:
            return OFF
        raise


def _where(town, country):
    """"<town>, <country>" for where the job is; the country alone when the service names no town."""
    name = geo.country_name(country) or country
    return f'{town}, {name}' if town else name


SERVICES = (
    Service('Platsbanken', 'SE', _sweden_url, _sweden_rows, PAGE),
    Service('Le Forem', 'BE', _belgium_url, _belgium_rows, PAGE),
    Service('arbeidsplassen.no', 'NO', _norway_url, _norway_rows, PAGE, get=_site_get),
)


def places(search, country, client=None):
    """The person's places in this country, nearest first: geo entries of their towns and areas, or [None] (the whole country) when they name the country
    itself and no town or area in it. [] when none of their places is in it (the service is not asked)."""
    from .. import places as known
    from ..places import place_words
    # Why (#3887, 12 Nov 2026, Gitar and the yardstick's p10): the countries already known for the person's places (the place cache, filled when the search is
    # prepared) decide first, so the map is asked about their words only for a person with a place in this country, never by every service for everyone.
    if (geo.country_name(country) or country) not in known.countries(search, limit=None):
        return []
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
    get = get or service.get or aggregators._get   # a caller's own fetch (a test) first, then the service's
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
                    answer = get(service.url(word, place, page * service.size))
                    if answer is OFF:   # Why (12 Nov 2026, sa): a service off for this install reads nothing and says nothing to the person
                        return jobs[:MOST]
                    listed, total = service.rows(answer)
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
