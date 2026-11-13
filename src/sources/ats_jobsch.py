"""jobs.ch feed: one employer's postings read from the board's public search (schema.org data and the page's own app data).

Split out of ats.py (pure move; ats.py re-exports it). ats.py imports and re-exports every name here; `_get` is looked up on the `ats` module at call time
so tests that patch `ats._get` keep working. Guarded by tests/unit/sources/test_places_strict.py and test_visits.py.
"""
import json
import re
import urllib.parse



JOBSCH_PAGES = 15       # 20 postings a page on jobs.ch: up to 300 jobs of one employer
JOBSCH_COMPANY = re.compile(r'/companies/(\d+)-(?:\1-)?([a-z0-9-]+)')


def jobsch_company(link):
    """'27602-manor-ag' from a jobs.ch company link (/en/companies/27602-27602-manor-ag/), or ''."""
    match = JOBSCH_COMPANY.search(str(link or ''))
    return f'{match.group(1)}-{match.group(2).strip("-")}' if match else ''


def _postings(markup):
    """The JobPosting entries of a page's structured data (schema.org), wherever they sit in it."""
    def walk(value):
        if isinstance(value, dict):
            if value.get('@type') == 'JobPosting':
                yield value
            for inner in value.values():
                yield from walk(inner)
        elif isinstance(value, list):
            for inner in value:
                yield from walk(inner)
    for block in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', markup, re.S):
        try:
            yield from walk(json.loads(block))
        except ValueError:
            continue


def _unescape(text):
    """A string as read raw from a page's script data, its escapes decoded (8 Oct 2026: "Biel\\u002FSolothurn" was stored and shown as is)."""
    try:
        return json.loads(f'"{text}"')
    except ValueError:
        return text


def jobsch_towns(markup):
    """A jobs.ch page's job id -> its town ("Vevey"), from the page's own app data: the schema.org listing names only the country for many
    postings (7 Oct 2026: Fnac's Vevey jobs were stored as "Switzerland", which a Romandie search can't place). Each posting's part of the
    data runs from its id to the next one; its own "place" is the last one there that is set (its address block has "place": null), else
    the address's city. Capitals are written as a name ("SAINT SULPICE" -> "Saint Sulpice")."""
    markup = markup or ''
    starts = [(m.start(), m.group(1)) for m in re.finditer(r'"id":"([0-9a-f-]{36})"', markup)]
    towns = {}
    for n, (at, ident) in enumerate(starts):
        part = markup[at:starts[n + 1][0] if n + 1 < len(starts) else at + 4000]
        found = re.findall(r'"place":"([^"]+)"', part) or re.findall(r'"city":"([^"]+)"', part)
        if found and ident not in towns:
            town = _unescape(found[-1]).strip()
            towns[ident] = town.title() if town.isupper() else town
    return towns


def posting_places(job, page_town=''):
    """Where a jobs.ch JobPosting is, one entry per address: "Town, Country" (the town without its canton prefix, "ZH Herrliberg"), the bare country for
    an address abroad with no town, and the page's own town (jobsch_towns) for a Swiss address with none (a posting with no jobLocation is one). [] when it
    names nothing: the caller's own fallback.
    Why (5 Nov 2026, tester card f9e48e, #3181): both jobs.ch readers appended ", Switzerland" to every town and fell back to "Switzerland" for an
    address with no town, whatever country the address named, so a job in Germany was listed and scored as Swiss. A missing country is Swiss (the board's)."""
    from .. import country_codes
    # Why (5 Nov 2026, #3242): a posting with no jobLocation is one Swiss address with no town, so it keeps the page's town (was dropped by #3215).
    spots = job.get('jobLocation') or [{}]
    found = []
    for spot in spots if isinstance(spots, list) else [spots]:
        address = (spot.get('address') or {}) if isinstance(spot, dict) else {}
        country = address.get('addressCountry') or 'CH'
        country = country_codes.name(country.get('name', '') if isinstance(country, dict) else country) or 'Switzerland'
        country = 'Switzerland' if country.lower() in ('ch', 'schweiz', 'suisse', 'svizzera') else country
        town = re.sub(r'^[A-Z]{2} ', '', str(address.get('addressLocality') or address.get('addressRegion') or '').strip())
        if not town and country == 'Switzerland':
            town = page_town
        entry = f'{town}, {country}' if town else country if country != 'Switzerland' else ''
        if entry and entry not in found:
            found.append(entry)
    return found


def jobsch_find(name, key, get=None):
    """An employer on jobs.ch by name: {'slug', 'site'} (its company page id, and the job site that page links, or ''), or None. Only a
    listing whose employer has the same name key (`key`, the scout's: "Manor" and "Manor AG" are one) counts, never a similar name."""
    get = get or ats._get
    text = page_bytes.text
    for job in _postings(text(get('https://www.jobs.ch/en/vacancies/?' + urllib.parse.urlencode({'term': name})))):
        org = job.get('hiringOrganization') or {}
        slug = jobsch_company(org.get('sameAs'))
        if slug and key(str(org.get('name') or '')) == key(name):
            page = text(get(f'https://www.jobs.ch/en/companies/{slug}/'))
            links = [link for link in re.findall(r'href="(https?://[^"]+)"', page) if 'jobs.ch' not in link and 'jobcloud' not in link]
            words = re.findall(r'[a-z0-9]{3,}', key(name))
            site = next((link for link in links if any(word in link.lower() for word in words)), '')
            return {'slug': slug, 'site': site}
    return None


def jobsch(slug):
    """One employer's jobs on jobs.ch ('27602-manor-ag'), for an employer whose own job site we cannot read (6 Oct 2026: Manor's careers site
    is a script app, coop.ch refuses automated visitors; both post every job on jobs.ch). The board's public search for its name, keeping
    only the postings of its company page (the id), page by page until a short page."""
    company, _, words = slug.partition('-')
    out, seen = [], set()
    for page in range(1, JOBSCH_PAGES + 1):
        markup = ats._get('https://www.jobs.ch/en/vacancies/?' + urllib.parse.urlencode({'term': words.replace('-', ' '), 'page': page}))
        markup = page_bytes.text(markup)
        postings, towns = list(_postings(markup)), jobsch_towns(markup)
        for job in postings:
            if jobsch_company((job.get('hiringOrganization') or {}).get('sameAs')).split('-')[0] != company or job.get('url') in seen:
                continue
            seen.add(job.get('url'))
            ident = re.search(r'detail/([0-9a-f-]{36})', str(job.get('url') or ''))
            where = ', '.join(posting_places(job, towns.get(ident.group(1), '') if ident else '')) or 'Switzerland'
            out.append(_job(ident.group(1) if ident else job.get('url'), job.get('title'), where,
                            job.get('url'), str(job.get('datePosted') or '')[:10]))
        if len(postings) < 20:
            break
    return out


from . import ats, page_bytes  # noqa: E402  (at the end: ats imports this file back, so importing this file first works too)
from .ats import _job  # noqa: E402  (at the end: ats imports this file back, so importing this file first works too)
