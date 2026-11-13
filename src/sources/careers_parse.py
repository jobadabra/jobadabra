"""Reading a careers page as text: the address <-> feed slug, links, which links look like a job list, and the jobs a page publishes itself
(schema.org JobPosting data), plus the numbered pages of a job list.

Split out of careers.py (pure move; import it through careers, never first). No network and no module state here, with ONE exception: a one-posting page
whose structured title the page does not show is asked about once per title wording (_shown_title, the title-field question, cached by decide); careers.py imports
and re-exports every name. Guarded by tests/unit/sources/test_careers.py and test_careers_paging.py.
"""
import hashlib
import html
import json
import re
import urllib.parse

from . import ats
from .. import country_codes
from ..ai import meanings_pack, page_words

MAX_JOB_PAGES = 40       # job pages read when the listing carries no data itself
CAREER_WORDS = meanings_pack.matcher('page-words', 'careers_link')   # the meanings pack: the old list (seed) + rows the site adds
JOB_PATH = meanings_pack.matcher('page-words', 'job_path')   # the meanings pack: the old list (seed) + rows the site adds
JOB_ID = re.compile(r'/(?:(?:[^/]*-)?(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{5,}|[0-9a-z]{16,})|\d{5,}-[^/]+|\d{5,}(?:/[^/]+){1,2})$', re.I)   # the id last (…-123456), first (/123456-the-title) or before one or two slugs (/<word>/123456/<employer>/<title>)
COUNTRIES = {'CH': 'Switzerland', 'DE': 'Germany', 'AT': 'Austria', 'FR': 'France', 'IT': 'Italy', 'GB': 'United Kingdom', 'UK': 'United Kingdom',
             'NL': 'Netherlands', 'IE': 'Ireland', 'ES': 'Spain', 'PT': 'Portugal', 'PL': 'Poland', 'SE': 'Sweden', 'US': 'United States'}


# Job boards, social networks and directories: a "website" that is one of these is not the employer's own, so it is never read or guessed from.
AGGREGATORS = ('xing.com', 'linkedin.com', 'indeed.com', 'glassdoor.com', 'kununu.com', 'jobs.ch', 'jobup.ch', 'swissdevjobs.ch', 'jobscout24.ch',
               'techtree.dev', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'wikipedia.org', 'google.com', 'monster.com',
               'stepstone.de', 'stepstone.ch', 'jobcloud.ch', 'workable.com', 'greenhouse.io', 'lever.co', 'ashbyhq.com', 'join.com')



def own_site(website):
    """True when the address looks like an employer's own site rather than a job board, network or directory."""
    host = (urllib.parse.urlsplit(website if '//' in (website or '') else f'//{website or ""}').hostname or '').lower().removeprefix('www.')
    return bool(host) and not any(host == d or host.endswith('.' + d) for d in AGGREGATORS)


# ---------- the address as a feed slug ----------

def encode(url):
    """https://www.acme.ch/en/careers -> www.acme.ch__en__careers (word characters, dots and dashes only; the query is dropped)."""
    parts = urllib.parse.urlsplit(url)
    path = '__'.join(segment for segment in parts.path.split('/') if segment)
    slug = f'{parts.hostname or ""}__{path}' if path else (parts.hostname or '')
    if not re.fullmatch(r'[\w.-]{1,120}', slug):
        raise ValueError('address too long or unusual for a feed slug')
    return slug


def decode(slug):
    host, _, path = slug.partition('__')
    if not re.fullmatch(r'[\w.-]+', host):
        raise ValueError('not a careers slug')
    return f'https://{host}/' + '/'.join(segment for segment in path.split('__') if segment)




def links(markup, base):
    """(absolute address, link text) for every link on the page."""
    found = []
    for href, inner in re.findall(r'<a\b[^>]*?href=["\']([^"\'#][^"\']*)["\'][^>]*>(.*?)</a>', markup, re.S | re.I):
        found.append((urllib.parse.urljoin(base, html.unescape(href)), re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', inner))).strip()))
    return found



NO_JOBS = meanings_pack.matcher('page-words', 'no_jobs')   # the meanings pack: the old list (seed) + rows the site adds
STRONG_WORDS = meanings_pack.matcher('page-words', 'strong_jobs')   # the meanings pack: the old list (seed) + rows the site adds
JOB_HOST = meanings_pack.matcher('page-words', 'job_host')   # the meanings pack: the old list (seed) + rows the site adds
NOT_JOBS = meanings_pack.matcher('page-words', 'not_jobs')   # the meanings pack: the old list (seed) + rows the site adds


def registrable(host):
    """The last two labels of a host name (karriere.acme.ch -> acme.ch): enough to tell a company's own subdomains apart from other sites."""
    labels = (host or '').lower().removeprefix('www.').split('.')
    return '.'.join(labels[-2:])


def careers_links(markup, base):
    """Links that look like the company's list of jobs, best first: a job system's address, a "jobs / open positions" link, then a general
    "careers" link. On the company's own site (any subdomain), or on a host that is named like a job site (stellen.lu.ch, jobs.acme.com)."""
    host = urllib.parse.urlsplit(base).hostname or ''
    found = []   # structure picks the candidates; the AI says what each link's wording means (ai/page_words.py), words only with no AI at all
    for url, text in links(markup, base):
        parts = urllib.parse.urlsplit(url)
        if parts.scheme in ('http', 'https') and not re.search(r'\.(pdf|jpe?g|png|zip|docx?)$', parts.path, re.I):
            found.append((url, text, parts))
    named = page_words.host_named(parts.hostname for url, text, parts in found if not ats.detect(url) and registrable(parts.hostname) != registrable(host))
    mine = [(url, text, parts) for url, text, parts in found if ats.detect(url) or registrable(parts.hostname) == registrable(host)
            or named.get((parts.hostname or '').lower())]
    words = page_words.link_words((text, parts.path) for url, text, parts in mine)
    scored = []
    for url, text, parts in mine:
        now = words[(str(text or ''), str(parts.path or ''))]
        if now is None:   # not judged yet: left for a later run
            continue
        if ats.detect(url):
            if now.weak_text:   # a job system link counts when it is worded as the careers link, not as any partner or widget
                scored.append((0, url))
            continue
        own = registrable(parts.hostname) == registrable(host)
        job_host = bool(named.get((parts.hostname or '').lower()))
        if not (own or job_host) or now.not_jobs:
            continue
        if now.strong or (job_host and not own):
            scored.append((1, url))
        elif now.weak or job_host:
            scored.append((2, url))
    ordered = [url for _, url in sorted(dict.fromkeys(scored), key=lambda item: item[0])]
    return list(dict.fromkeys(ordered))[:5]



def _walk(value):
    if isinstance(value, dict):
        if str(value.get('@type', '')).lower() == 'jobposting' or 'JobPosting' in (value.get('@type') if isinstance(value.get('@type'), list) else []):
            yield value
        for inner in value.values():
            yield from _walk(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from _walk(inner)


def site_names(markup):
    """The site's own name as the page declares it, lower-cased: its og:site_name and the name of its WebSite or Organization JSON-LD entry.
    Read from the page only (no list of names), so a heading equal to one is the site's logo or name, not a page's title (#3901)."""
    names = set()
    for tag in re.findall(r'<meta\b[^>]*>', markup, re.I):
        if re.search(r'''property\s*=\s*["']og:site_name["']''', tag, re.I):
            named = re.search(r'''content\s*=\s*["']([^"']*)''', tag, re.I)
            names.add(plain_name(named.group(1)) if named else '')
    for block in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', markup, re.S | re.I):
        try:
            data = json.loads(html.unescape(block) if '&quot;' in block else block)
        except ValueError:
            continue
        for item in _typed(data, {'website', 'organization'}):
            names.add(plain_name(item.get('name')))
    names.discard('')
    return names


def plain_name(value):
    """A name or heading as compared text: tags and entities out, spaces folded, lower-cased; '' for anything but text."""
    return re.sub(r'\s+', ' ', ats.plain(value)).strip().lower() if isinstance(value, str) else ''


def _typed(value, kinds):
    """The JSON-LD entries of one of these @types (lower-case), anywhere in the data (@graph, lists, nested)."""
    if isinstance(value, dict):
        types = value.get('@type')
        if {str(kind).lower() for kind in (types if isinstance(types, list) else [types])} & kinds:
            yield value
        for inner in value.values():
            yield from _typed(inner, kinds)
    elif isinstance(value, list):
        for inner in value:
            yield from _typed(inner, kinds)


def _words(value):
    """A JSON-LD text field as text: sites give a string, a {"name": …}, or a list of either (7 Oct 2026: a list in addressLocality ended a
    whole Find new employers run with a TypeError)."""
    if isinstance(value, dict):
        return _words(value.get('name'))
    if isinstance(value, (list, tuple)):
        return ', '.join(part for part in (_words(item) for item in value) if part)
    return str(value).strip() if value not in (None, '') else ''


def hiring_organisation(posting):
    """The name a JobPosting gives for the organisation that hires (a string, {"name": …} or a list of either), or ''.
    Invariant: one organisation's name, never two joined."""
    hiring = posting.get('hiringOrganization')
    if isinstance(hiring, (list, tuple)):
        # Why (#3581, 8 Nov 2026): a board listed the employer and the recruiter that posted the job, and both names became one company. schema.org's
        # EmploymentAgency type marks a recruiter; a list with no such mark gives no way to tell, so its first organisation is kept.
        named = [item for item in hiring if _words(item)]
        hirers = [item for item in named if not (isinstance(item, dict) and str(item.get('@type') or '') == 'EmploymentAgency')]
        hiring = (hirers or named or [''])[0]
    return re.sub(r'\s+', ' ', _words(hiring)).strip()[:120]


def _page_town(markup, posting, memo):
    """The town a list page's own app data gives a posting whose schema.org address names only the country: the posting's identifier is an id there, and the id's data
    block has a set "place" (ats_jobsch.jobsch_towns reads it; memo holds that read, made once per page). '' when the posting has no such id or the data names none.
    Why (12 Nov 2026, ch): jobup.ch, jobs.ch's sibling, listed a Zurich warehouse search's ads with the country only in JSON-LD, their towns only in the page data: 3 of 13 ads had a
    town the place check could use (10 with this), and 13 jobs read gave 2 in the person's places. jobs.ch's own reader did this already (boards.parse_jobs); the page's data is the proof, a posting with no id there is left as it was."""
    ident = posting.get('identifier')
    ident = str(ident.get('value') if isinstance(ident, dict) else ident or '')
    if not re.fullmatch(r'[0-9a-f-]{36}', ident):
        return ''
    if 'towns' not in memo:
        from .ats_jobsch import jobsch_towns
        memo['towns'] = jobsch_towns(markup)
    return memo['towns'].get(ident, '')


def page_title(markup, url, say=True, cut=True):
    """The page's title: its first <h1> that is not the site's own name as the page declares it (site_names), else the first
    part of <title> that is not. say=False: no log line; cut=False: the whole <h1>, not its first part before a " - " or "|". '' when the only heading is the site's name: that page is said in the log and not read as a job."""
    names = site_names(markup)
    headings = [ats.plain(text) for text in re.findall(r'<h1[^>]*>(.*?)</h1>', markup, re.S | re.I)]
    kept = [text for text in headings if plain_name(text) not in names]
    if headings and not kept:
        if say:
            print(f"Job page: its only heading is the site's own name, not a job title; not read as a job: {url}", flush=True)
        return ''
    if say and len(kept) < len(headings) and len(kept) > 1:   # Why (#3901, 12 Nov 2026, sa; moved here 13 Nov 2026, sd): the first is taken, said so a wrong pick can be found (say=False: a caller that only checks a title keeps the log quiet)
        print(f"Job page: {len(kept)} headings besides the site's name, the first taken as the title: {url}", flush=True)
    if kept:
        return re.split(r'\s+[|\u2013\u2014-]\s+', kept[0])[0].strip() if cut else kept[0].strip()
    page = ats.plain((re.search(r'<title[^>]*>(.*?)</title>', markup, re.S | re.I) or [None, ''])[1])
    parts = [part.strip() for part in re.split(r'\s+[|\u2013\u2014-]\s+', page)]
    return next((part for part in parts if plain_name(part) not in names), '')


TITLE_FIELD = 'title-field'   # decide topic: is a JobPosting's title a job title or an unfilled template field
TITLE_FIELD_ANSWERS = ('job_title', 'template_field')
TITLE_FIELD_INSTRUCTIONS = ('A job page gives two lines: the "title" field of its structured data and the heading the page shows, in any language. Answer template_field only when the title is a placeholder '
                    'or variable name a page template did not fill in (an identifier, a token in capitals or with underscores or braces, not a role), whatever the heading says: a heading such as '
                    '"Careers" or "Open positions" over a real role name is a job_title. Answer job_title when the title names a role.')


def _shown_title(markup, url, title):
    """A job page's one JobPosting title, unless it is an unfilled template field: then the page's own heading.
    Why (13 Nov 2026, sd, jobadabra-lab board-discovery run 43502695338 (Spain); Gitar on #4046 refused the first rule, "the page must show the title", for "Sr. Engineer" against a shown "Senior Engineer" and for
    script-drawn titles): a board's job pages carried JSON-LD `"title": "HV_JSON_TITULO"`, so its 39 local jobs shared one title and the kinds question saw one title:
    "no kinds of work from the AI: not kept". Structure only finds the doubt: the title is not in the page's visible text AND shares no word with its heading or <title>.
    Whether that is a template field is the AI's judgment (title-field, asked once per wording and kept); no AI or an unsure answer keeps the title, never a guess.
    Invariant: never an empty title (no heading on the page: the structured title stays, as a script-rendered page needs)."""
    # Why (13 Nov 2026, Gitar on #4086): ats.plain and plain_name both cut at 12,000 characters, so a title shown further down a long page looked absent: fold the whole text here
    seen = re.sub(r'\s+', ' ', ats.posting_text.html_to_text(re.sub(r'<(script|style|noscript)\b.*?</\1>', ' ', markup, flags=re.S | re.I), len(markup))).strip().lower()
    if plain_name(title) in seen:
        return title
    heading = page_title(markup, url, say=False, cut=False)   # the whole heading: "Mozo/a de montaje - Mallorca" is the title, not "Mozo/a de montaje"
    if not heading or plain_name(heading) == plain_name(title):
        return title
    page = ats.plain((re.search(r'<title[^>]*>(.*?)</title>', markup, re.S | re.I) or [None, ''])[1])
    words = lambda text: set(re.findall(r'\w{3,}', plain_name(text)))
    if not words(title) or words(title) & (words(heading) | words(page)):   # no 3+ letter word (a 2-character title, IT, QA): nothing to doubt, no question (Gitar on #4081)
        return title
    from ..ai import decide
    question = f'title: {title}\nheading: {heading}'   # Why (13 Nov 2026, Gitar on #4062): on a list page the heading is the board's, so the AI sees both lines, never the title alone
    # Why (13 Nov 2026, Gitar on #4066): the answer is kept per TITLE wording, not per title+heading: a placeholder is the same on every page of a board, so one question
    # covers its 40 pages (keyed on both it was 40 AI calls on a Trabajos read); the heading is context for the first page asked, not part of the key.
    if decide.one(TITLE_FIELD, hashlib.sha256(title.lower().encode()).hexdigest()[:20], question, TITLE_FIELD_ANSWERS, TITLE_FIELD_INSTRUCTIONS) != 'template_field':
        return title
    print(f"Job page: its structured data names the job {title!r}, which is not a job title; its heading {heading!r} is the title: {url}", flush=True)
    return heading


def jsonld_jobs(markup, url, job_page=False):
    """The JobPosting entries a page publishes, in the common job shape (ats._job). job_page=True: the caller is reading ONE job page from its own link, so a page of exactly
    one posting shows its title (_shown_title). Any other call (a structure probe on a careers or listing page, whose heading is the board's) stays a pure parse: no AI, no rewrite.
    Why (13 Nov 2026, Gitar on #4081): one posting on a page does not make it a job page, and a probe that only tests truthiness must not cost an AI call or swap a title."""
    jobs = _jsonld_jobs(markup, url)
    if job_page and len(jobs) == 1:
        jobs[0]['title'] = ats.posting_text.label(_shown_title(markup, url, jobs[0]['title']))
    return jobs


def _jsonld_jobs(markup, url):
    """The JobPosting entries a page publishes, in the common job shape (ats._job)."""
    jobs, memo = [], {}
    for block in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', markup, re.S | re.I):
        try:
            data = json.loads(html.unescape(block) if '&quot;' in block else block)
        except ValueError:
            continue
        for posting in _walk(data):
            title = ats.plain(str(posting.get('title') or ''))
            if not title:
                continue
            places = posting.get('jobLocation') or []
            places = places if isinstance(places, list) else [places]
            where = []
            for place in places:
                if isinstance(place, str):
                    where.append(place)
                    continue
                address = (place.get('address') if isinstance(place, dict) else None) or {}
                if isinstance(address, list):
                    address = next((a for a in address if a), {})
                if isinstance(address, str):
                    where.append(address)
                    continue
                if not isinstance(address, dict):
                    continue
                country = _words(address.get('addressCountry'))
                where.append(', '.join(part for part in (_words(address.get('addressLocality')) or _words(address.get('addressRegion')) or _page_town(markup, posting, memo), COUNTRIES.get(country.upper()) or country_codes.name(country)) if part))
            remote = 'telecommute' in str(posting.get('jobLocationType') or '').lower()
            salary = posting.get('baseSalary') or {}
            value = salary.get('value') if isinstance(salary, dict) else None
            salary_text = ''
            if isinstance(value, dict) and (value.get('minValue') or value.get('maxValue')):
                salary_text = f"{salary.get('currency', '')} {value.get('minValue', '')}–{value.get('maxValue', '')}".strip()
            link = urllib.parse.urljoin(url, str(posting.get('url') or url))
            jobs.append({**ats._job(link, title, '; '.join(w for w in where if w), link, str(posting.get('datePosted') or '')[:10],
                                    ats.plain(str(posting.get('description') or '')), remote, salary_text), 'employer': hiring_organisation(posting)})
    return jobs



NUMBERED = 5   # links sharing one path shape that differ only in a long number: a list of single pages

def _card_shape(path):
    """The path with its number replaced by #; a short number after a title slug (/jobs/<title-slug>/4349/, owner 24 Oct 2026: a board's cards, ids of
    4-6 digits) is one shape whatever the slug, a year is not a number."""
    segments = path.rstrip('/').split('/')
    if len(segments) >= 3 and re.fullmatch(r'\d{4,}', segments[-1]) and not 1900 <= int(segments[-1]) <= 2100 and re.search(r'[^\W\d_]', segments[-2]):
        return '/'.join(segments[:-2]) + '/*/#'
    return re.sub(r'\d{5,}', '#', path)


def _query_shape(parts):
    """The address with the long numbers of its query replaced by # and its other values dropped (/word/?name=#), '' when the query carries none: cards whose id
    is a query value on one path.
    Why (11 Nov 2026, #3835): a public employment service listed 84 carpenter jobs as /<word>/?<name>=<id>&<kind>; the path held no number,
    so the board read 0 jobs."""
    pairs = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    if not any(re.fullmatch(r'\d{5,}', value) for _, value in pairs):
        return ''
    return parts.path + '?' + '&'.join(f'{name}=#' for name, value in pairs if re.fullmatch(r'\d{5,}', value))   # other values differ by card (its kind)


def numbered_links(found, host, own):
    """The links of a page that are one address shape with a different long number each (/word123456.html, /word/?name=123456): a listing's
    cards, whatever the site calls them. 18 Oct 2026: a job site listed 17 truck-driver jobs as /<word><id>.html; no word of ours matched,
    so the board read 0. The biggest such group counts, when it has NUMBERED or more different ids; menus and categories carry no number.
    Invariant: a link to the list's own path is never a card, whatever its query (a filter or an offset of the same list)."""
    groups = {}
    for url, _ in found:
        parts = urllib.parse.urlsplit(url)
        shape = _card_shape(parts.path)
        if shape == parts.path:   # no number in the path: the id may be a value of the query
            shape = _query_shape(parts) or shape
        if (parts.hostname or '').removeprefix('www.') != host or shape == parts.path or parts.path.rstrip('/') == own:
            continue
        groups.setdefault(shape, []).append(url.split('#')[0])
    best = max(groups.values(), key=lambda urls: len(set(urls)), default=[])
    return list(dict.fromkeys(best)) if len(set(best)) >= NUMBERED else []


def same_site(markup, base):
    """(host, own path, [(url, text, split url)] of the page's links to other pages of the same site): the links a listing's read judges."""
    host = (urllib.parse.urlsplit(base).hostname or '').removeprefix('www.')
    own = urllib.parse.urlsplit(base).path.rstrip('/')
    same = [(url, text, urllib.parse.urlsplit(url)) for url, text in links(markup, base)]
    return host, own, [(url, text, parts) for url, text, parts in same if (parts.hostname or '').removeprefix('www.') == host and parts.path.rstrip('/') != own]


def _job_paths(markup, base):
    """(host, own path, the same-site links that look like job pages, those of them that end in an id)."""
    host, own, same = same_site(markup, base)
    out = []
    words = page_words.link_words((text, parts.path) for url, text, parts in same)
    for url, text, parts in same:
        if (words[(str(text or ''), str(parts.path or ''))] or page_words.Words(False, False, False, False)).job_path:
            out.append(url.split('#')[0])
    out = list(dict.fromkeys(out))
    return host, own, out, [url for url in out if JOB_ID.search(urllib.parse.urlsplit(url).path.rstrip('/'))]


def has_job_ids(markup, base):
    """The page links at least 3 job pages that end in an id: a list built into the page, not only a menu of job words (a page whose cards
    come by script has none until they do, 24 Oct 2026)."""
    return len(_job_paths(markup, base)[3]) >= 3


POSTING_ID = re.compile(r'(?<![0-9a-z])(\d{5,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-z])', re.I)   # a long number or a UUID standing alone in a path segment or beside a slug


def _posting_key(url):
    """(key, the segments after the id's segment, whether that segment holds a slug beside the id) of a job address, or None when its path carries no id. The key is the host,
    the path before the LAST id-carrying segment and the id in it: a company id earlier in the path never joins two postings."""
    parts = urllib.parse.urlsplit(url)
    segments = [segment for segment in parts.path.split('/') if segment]
    for at in range(len(segments) - 1, -1, -1):
        found = POSTING_ID.search(segments[at])
        if found:
            return (parts.netloc.lower(), tuple(segments[:at]), found.group(1).lower()), tuple(segment.lower() for segment in segments[at + 1:]), len(segments[at]) > len(found.group(1))
    return None


def one_per_posting(urls):
    """The job addresses with an action on a posting left out, in page order: /jobs/<id>-<slug> is the posting and /jobs/<id>/apply (the same path before the id, the same
    id, more segments after it) is an action on it. Only the certain case is joined: a link is dropped when another link of the same id ends at its id's segment with a slug
    AND its own trailing segments repeat under at least two different ids on the page (an action like /apply is on every card; a job's own name is on one). A single
    employer's /employer/<id>-acme/welder and /driver, or a bare /employer/<id>, are never joined: they may be two jobs, and a lost job is worse than a shown twin (sa, 13 Nov
    2026; Gitar on #4060: a slug beside the id does not make the link a posting when its sub-pages are told apart by name). The one posting with one apply link and no other
    card on the page keeps its twin: shown twice, never lost.
    Why (13 Nov 2026, sd; bp's proof on an airline board, discovery run 43498167418 of jobadabra-lab): 39 rows of ~20 postings, each read from its job page and again from its apply
    page, so a person saw each job twice and the Scout counted 53 for ~27 postings. Same id under the same path is a fact of the addresses, not a meaning: no AI, no word of ours, no host."""
    keyed = [(url, _posting_key(url)) for url in dict.fromkeys(urls)]
    posting = {found[0] for _, found in keyed if found and not found[1] and found[2]}
    ids_by_tail = {}
    for _, found in keyed:
        if found and found[1]:
            ids_by_tail.setdefault(found[1], set()).add(found[0])
    return [url for url, found in keyed if not (found and found[1] and found[0] in posting and len(ids_by_tail[found[1]]) >= 2)]


def job_links(markup, base):
    """Links on a listing page that look like single job pages of the same site, one per posting (one_per_posting)."""
    host, own, out, with_id = _job_paths(markup, base)
    out, with_id = one_per_posting(out), one_per_posting(with_id)
    # Single job pages end in an id (a UUID, a long number): when the page has some, those are the jobs and the rest is its menu
    # ("/karriere/trainee"). 6 Oct 2026: Migros's menu links filled the quota before its 31 job links on the page.
    chosen = with_id if len(with_id) >= 3 else out
    if len(with_id) < 3:   # no job addresses with an id: a list of cards that differ only in their number beats a menu of job words
        chosen = one_per_posting(numbered_links(links(markup, base), host, own)) or chosen
    return chosen[:MAX_JOB_PAGES]



MAX_LIST_PAGES = 20   # numbered pages of one job list read at most: each job on them is one more request to the site
PAGE_PAUSE_S = 0.5


def page_links(url, markup):
    """The numbered pages of the job list at `url` that it links to, in order: the same address with ?page=N (or &p=N, /page/N/), N >= 2.
    6 Oct 2026: Migros lists 1,335 jobs over 67 pages; only the first was read."""
    base = urllib.parse.urlsplit(url)
    found = {}
    for link, _ in links(markup or '', url):
        parts = urllib.parse.urlsplit(link)
        if parts.netloc != base.netloc:
            continue
        query = dict(urllib.parse.parse_qsl(parts.query))
        number = next((query[key] for key in ('page', 'p', 'pg', 'seite') if query.get(key, '').isdigit()), None)
        path = parts.path.rstrip('/')
        if number is None and (match := re.search(r'/page/(\d+)$', path)):
            number, path = match.group(1), path[:match.start()]
        if number and int(number) >= 2 and path == base.path.rstrip('/'):
            found.setdefault(int(number), link)
    return [found[n] for n in sorted(found)][:MAX_LIST_PAGES - 1] or _stepped_pages(url, markup)


def _stepped_pages(url, markup):
    """Paging whose link carries no name of ours (?offset=20,40,60 or /stranica/2,3): the same list address with one number that changes, the numbers in one
    step from one or two steps off zero (a window of pages 1,2,3,34 counts its first three). Filters and categories are not a run, so they are not pages.
    24 Oct 2026: cv.ee's finance section (offset) and posao.hr's health section (path word) were read as their first page only."""
    base = urllib.parse.urlsplit(url)
    here, runs = base.path.rstrip('/'), {}
    for link, _ in links(markup or '', url):
        parts = urllib.parse.urlsplit(link)
        if parts.netloc != base.netloc:
            continue
        path, query = parts.path.rstrip('/'), dict(urllib.parse.parse_qsl(parts.query))
        if path == here:
            others = {key: value for key, value in query.items() if not value.isdigit()}
            for key, value in query.items():
                if value.isdigit() and others == {k: v for k, v in dict(urllib.parse.parse_qsl(base.query)).items() if not v.isdigit()}:
                    runs.setdefault(('?', key), {})[int(value)] = link
        elif path.startswith(here + '/') and (match := re.fullmatch(r'/([^/]+)/(\d+)', path[len(here):])) and not query:
            runs.setdefault(('/', match.group(1)), {})[int(match.group(2))] = link
    for numbers in runs.values():
        run = sorted(numbers)
        step = run[1] - run[0] if len(run) > 1 else 0
        if step <= 0 or run[0] not in (step, 2 * step):
            continue
        kept = [run[0]]
        for number in run[1:]:
            if number - kept[-1] != step:
                break
            kept.append(number)
        if len(kept) >= 3 or (len(kept) == 2 and run[0] == 2 * step):
            return [numbers[n] for n in kept if n >= 2][:MAX_LIST_PAGES - 1]
    return []

