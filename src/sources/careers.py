"""A company's own careers page, for employers with no job-system feed (Greenhouse, Lever, ...).

The scout uses it on a company website: find the careers link, see whether an ATS is embedded (then its feed is used), else read the jobs
the page itself publishes as schema.org JobPosting data (JSON-LD), on the listing page or on the job pages it links to. Public pages only,
fetched like a browser would, no login, no workaround for a site that refuses (a 403 is an answer). The result is a normal feed:
ats 'careers', slug = the page address written with word characters only (`encode`), so it travels through the employer index unchanged.
"""
import html
import ipaddress
import json
import os
import re
import time
import socket
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from . import ats, careers_parse, host_pace, page_bytes
from . import board_round_log
from ..job_identity import unlinked_job_url
from ..press import stage

MAX_BYTES = 2_000_000
from ..ai import meanings_pack, page_words, slots
from .careers_parse import (MAX_JOB_PAGES, CAREER_WORDS, JOB_PATH, JOB_ID, COUNTRIES, AGGREGATORS, own_site, encode, decode, links,  # noqa: F401
                            NO_JOBS, STRONG_WORDS, JOB_HOST, NOT_JOBS, registrable, careers_links, _walk, _words, jsonld_jobs, job_links,
                            MAX_LIST_PAGES, PAGE_PAUSE_S, page_links, page_title as _page_title)
# ---------- fetching ----------

class NameNotResolved(ValueError):
    """The host has no address (DNS knows no such name). A ValueError like any non-public address (callers that catch it keep working); the round line names it."""


def _address(host):
    """'ok', 'private' (leads to this computer or a private network) or 'unresolved' (no address): a catalog entry must never make a run reach a private one."""
    if os.getenv('JOBADABRA_FIXTURE_DIR'):
        return 'ok'
    try:
        for family, _, _, _, address in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(address[0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return 'private'
    except socket.gaierror as error:   # Gitar, #4036: only "no such name" is unresolved; a temporary resolver failure (EAI_AGAIN, EAI_FAIL) is a host that may exist
        return 'unresolved' if error.errno in {socket.EAI_NONAME, getattr(socket, 'EAI_NODATA', socket.EAI_NONAME)} else 'private'
    except (OSError, ValueError):
        return 'private'
    return 'ok'


def _public(host):
    """False for an address that leads to this computer or a private network, or that does not resolve."""
    return _address(host) == 'ok'


def get_text(url):
    """The page's HTML, or raises. Only http(s) to public hosts."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.hostname:
        raise ValueError('not a public web address')
    if not _public(parts.hostname):   # the seam the reader tests patch; only the refusal asks why
        raise (NameNotResolved if _address(parts.hostname) == 'unresolved' else ValueError)('not a public web address')   # Why (13 Nov 2026, d03 run 43478619242, #4034): "md.jooble.org" printed as a bare ValueError
    fixtures = os.getenv('JOBADABRA_FIXTURE_DIR')
    if fixtures:
        return page_bytes.text(ats._fixture(fixtures, url))
    request = urllib.request.Request(url, headers={'User-Agent': ats.USER_AGENT, 'Accept': 'text/html,application/xhtml+xml'})
    clock, phase = [time.monotonic()], 'waiting for the answer'   # what the wait ran out in: a refused connection or an HTTP code is not a stall and passes through unchanged
    try:
        with host_pace.open(request, ats.TIMEOUT, on_attempt=lambda: clock.__setitem__(0, time.monotonic())) as response:   # the clock restarts at each real attempt: host_pace's turn-taking sleep and earlier slow-down retries are not the site's silence (Gitar, #4177)
            phase, clock[0] = 'reading the page', time.monotonic()
            return page_bytes.reply(response, MAX_BYTES)
    except urllib.error.URLError as error:   # urllib wraps a timeout while connecting in a URLError; one while waiting for the answer is a bare TimeoutError
        if isinstance(error, board_round_log.Stalled) or not isinstance(error.reason, TimeoutError):
            raise
        raise board_round_log.Stalled('connecting', time.monotonic() - clock[0]) from error
    except TimeoutError as error:
        raise board_round_log.Stalled(phase, time.monotonic() - clock[0]) from error


# ---------- reading a page ----------

def embedded_system(markup):
    """(ats, slug) of the first job system the page links or embeds, or None. A Teamtailor careers site on the company's own domain
    ("jobs.tamedia.ch") is read from that address: its feed is there, and the name in Teamtailor's scripts is not the company's."""
    found = None
    for url in re.findall(r'https?:(?:\\?/){2}[^\s"\'<>\\)]+', markup):
        found = ats.detect(url)
        if found:
            break
    if (not found or found[0] == 'teamtailor') and 'teamtailor' in markup.lower():
        own = re.search(r'https?:(?:\\?/){2}([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\\?/)jobs\.rss', markup, re.I)
        if own and _public(own.group(1).lower()):
            return 'teamtailor', own.group(1).lower()
    return found



def _places():
    """Your places as one pattern (config/search.json), to find where a job page says the job is."""
    from ..paths import keyword_regex, load_search_config, place_regex
    groups = (load_search_config().get('locations') or {})
    return place_regex([*groups.get('top_tier', []), *groups.get('country_wide', []), *groups.get('abroad', [])] or [r'(?!x)x'])


def job_from_page(markup, url):
    """A job from a page with no job data: the main heading is the title, the page text the description, the place is any of your places
    the text names. Rough on purpose: read_page_from asks the AI whether the page is one posting (one_posting.py; the title filter alone kept a
    board's "3,531 Assistant Psychology jobs" category, 26 Oct 2026), and the crawl's title filter keeps only the roles you look for."""
    title = _page_title(markup, url)
    if not 4 <= len(title) <= 120:
        return None
    body = re.sub(r'<(script|style|noscript|nav|header|footer)\b.*?</\1>', ' ', markup, flags=re.S | re.I)
    text = ats.plain(body)
    found = []
    for match in _places().finditer(text[:6000]):
        word = match.group(0).strip().title()
        if word not in found:
            found.append(word)
    return ats._job(url, title, ', '.join(found[:3]), url, '', text, bool(re.search(r'\bremote\b|home.?office', text[:3000], re.I)))


def read_page(url, fetch=None):
    """Jobs a careers page publishes: its own data, or the data of the job pages it links to. Raises when the page cannot be read."""
    fetch = fetch or get_text   # looked up when called: a test's or a run's own fetcher applies
    markup = fetch(url)
    jobs = jsonld_jobs(markup, url) or read_page_from(markup, url, fetch)
    return _asked(url, markup, jobs, fetch)


def fetch(slug, sleep=time.sleep):
    """The ats 'careers' feed: the jobs on the page this slug stands for, and on its numbered pages; read again through the browser when the
    plain page has none."""
    url = decode(slug)
    jobs = read_page(url)
    show = renderer() if not jobs else None
    jobs = read_page(url, show) if show else jobs
    if not jobs:
        return jobs
    more = []   # the first page is read; its page links are a bonus
    with stage.guard('employer sites: page links'):
        more = page_links(url, get_text(url))
    seen = {job.get('url') for job in jobs}
    for link in more:
        sleep(PAGE_PAUSE_S)
        with stage.guard('employer sites: next page') as caught:
            fresh = [job for job in read_page(link, show) if job.get("url") not in seen]
        if caught:   # a page that fails ends the list here
            break
        if not fresh:
            break
        seen.update(job.get('url') for job in fresh)
        jobs = jobs + fresh
    return jobs


READER = 'auto'   # 'auto': Claude reads pages the rules cannot (ai/page_reader.py) when an AI is available; None: never; or a function (url, html) -> jobs (tests)


def reader():
    if READER != 'auto':
        return READER
    if os.getenv('JOBADABRA_FIXTURE_DIR'):
        return None
    from ..ai import page_reader
    return page_reader.read if page_reader.usable() else None


# A job title, in any of the usual languages, as opposed to a menu entry ("About us", "Benefits"): a role noun or a workload/gender mark.
TITLE_LIKE = meanings_pack.matcher('page-words', 'job_title')   # the meanings pack: the old list (seed) + rows the site adds


# Headings of career pages themselves, not jobs: "Search Swiss Re Careers", "Early talent opportunities", "Life at Acme", "Students".
NOT_A_JOB = meanings_pack.matcher('page-words', 'not_a_job')   # the meanings pack: the old list (seed) + rows the site adds


def _titles(jobs):
    """{title: 'job_title' | 'heading' | None} for these jobs' titles: the AI's kind of each (ai/page_words.py), the two word lists only with no AI."""
    return page_words.title_kinds(job['title'] for job in jobs)


def _heading(title):
    """A career page's own heading or menu entry, never a job. "Senior Search Engineer", "Site Reliability Engineer, Europe" and "Graduate
    Software Engineer" are jobs (#110, 3 Oct 2026). An entry not judged yet is not known to be a heading."""
    return _titles([{'title': title}]).get(str(title).strip()) == 'heading'


def _plausible(jobs):
    """Rules found jobs: do they look like job titles (or roles you look for)? If not, the links were probably menu entries."""
    kinds = _titles(jobs)
    jobs = [job for job in jobs if kinds.get(job['title'].strip()) != 'heading']
    if not jobs:
        return False
    from ..ai import page_reader
    return page_reader.plausible(jobs) or sum(1 for job in jobs if kinds.get(job['title'].strip()) == 'job_title') >= max(1, len(jobs) // 2)


def _from_recipe(url, markup, fetch_page):
    """Jobs read by a recipe learned for this page (page_recipes.py), or []: no model call."""
    from . import page_recipes
    recipe = page_recipes.load(url)
    items = page_recipes.replay(recipe, markup, url) if recipe else []
    if recipe and not items:
        page_recipes.mark_broken(url)   # the page changed: flag it; the page is read the usual way and a new read learns a new recipe
    return listed(items, url, markup, fetch_page) if items else []


def listed(items, url, markup, fetch_page):
    """The jobs of a recipe's [(title, link or None)] on this listing page: each linked job page's data (its title stays the listing's), else
    the listing's own title and place. Shared by a page's own recipe and a board's served layout (board_layout.py)."""
    listing = job_from_page(markup, url) or {}

    def one(item):
        title, link = item
        found = None
        if link:
            with stage.guard('employer sites: listed job'):   # a job page that fails: the listing's own title and place
                found = jsonld_jobs(fetch_page(link), link, job_page=True)[:1] or [job_from_page(fetch_page(link), link)]
        job = (found or [None])[0] or {}
        # a card with no link keeps its own address (src/job_identity.py); a recipe's card is a title only, its place the page's, so one title
        # twice on one page is one ad here (store.same_job agrees); a card's own place needs a place in the learned recipe (parked, Gitar on #4197)
        address = link or unlinked_job_url(url, title)
        return ats._job(address, title, job.get('location') or listing.get('location', ''), address,
                        job.get('date_posted', ''), job.get('description', ''), bool(job.get('remote')))
    with ThreadPoolExecutor(max_workers=6) as pool:
        return list(pool.map(slots.carry(one), items[:40]))


def _asked(url, markup, jobs, fetch_page=None, careers_page=False):
    """Rules' jobs when they look like jobs; else a recipe learned earlier (no AI); else, when a model can read the page, its answer,
    and a recipe derived from that answer so the next read needs no model."""
    kinds = _titles(jobs)
    jobs = [job for job in jobs if kinds.get(job['title'].strip()) != 'heading']   # career-page headings are never jobs
    if _plausible(jobs):
        return jobs
    fetch_page = fetch_page or get_text
    replayed = _from_recipe(url, markup, fetch_page)
    if replayed:
        return replayed
    # What the rules found does not look like job titles (menu entries, "About us"): not a list of jobs. Without a model to read the page,
    # nothing is taken from it, and the scout goes on to the page's own links (the real job site is often one link further).
    read = reader()
    if not read:
        return []
    answer = read(url, markup, careers_page=True) if careers_page and READER == 'auto' else read(url, markup)
    if answer is None:
        return []
    if answer and READER == 'auto':   # a real model answered: learn how to read this page without it
        from . import page_recipes
        recipe = page_recipes.derive(markup, url, answer)
        if recipe:
            page_recipes.save(url, recipe)
    return answer


CHOOSER = 'auto'   # 'auto': a model picks the job-list link on a home page the rules cannot read (ai/page_reader.py); None: never; or a function (tests)


def chooser():
    if CHOOSER != 'auto':
        return CHOOSER
    if os.getenv('JOBADABRA_FIXTURE_DIR'):
        return None
    from ..ai import page_reader
    return page_reader.choose_links if page_reader.usable() else None


RENDER = 'auto'   # 'auto': the headless browser (render.py) when Playwright is installed; None: never; or a function url -> html (tests)


def renderer():
    """The function that reads a page after its scripts ran, or None. Off with JOBADABRA_RENDER=0 and in the end-to-end fixtures."""
    if RENDER != 'auto':
        return RENDER
    if os.getenv('JOBADABRA_RENDER') == '0' or os.getenv('JOBADABRA_FIXTURE_DIR'):
        return None
    from . import render
    return render.render if render.available() else None


REFUSALS = {}   # host -> why, for this run: a site that answered 401/403 or a bot check (a 429 is host_pace's "slow down") (the scout offers it as a site only you can open)


def note_refusal(url, error):
    code = getattr(error, 'code', None)
    why = f'HTTP {code}' if code in host_pace.REFUSED else (str(error) if type(error).__name__ == 'Refused' else '')
    if why:
        REFUSALS[(urllib.parse.urlsplit(url if '//' in url else f'https://{url}').hostname or '').lower().removeprefix('www.')] = why


def discover(website, fetch_page=get_text):
    """What a company website offers: {'ats', 'slug'} for an embedded job system, {'ats': 'careers', 'slug', 'jobs'} for a page with jobs,
    or None. Home page, the careers links on it, and one level deeper. A page that is only a shell (its jobs appear after scripts run) is
    read again through the browser when RENDER is set; a site that refuses is left alone."""
    if not own_site(website):
        return None
    website = website if '//' in website else f'https://{website}'
    try:
        home = fetch_page(website)
    except Exception as error:  # noqa: BLE001 — a site that is down or refuses is just "nothing found"
        note_refusal(website, error)
        return None
    # Only a link that looks like the careers link counts as the company's job system: a stray widget or partner link on the home page is not.
    show = renderer() if fetch_page is get_text else None
    found = _explore(website, home, fetch_page, show)
    if not found or found.get('empty'):   # nothing linked, or only an empty page: try the site map and the usual addresses too
        guessed = _explore(website, home, fetch_page, show, links=guessed_links(website, fetch_page), limit=20)
        if guessed and (not found or not guessed.get('empty')):
            found = guessed
    if (not found or found.get('empty')) and (choose := chooser()):   # a model reads the home page's links and picks the job list
        picked = []   # no answer: nothing more to try
        with stage.guard('employer sites: job list chooser'):
            picked = choose(website, home)
        chosen = _explore(website, home, fetch_page, show, links=picked) if picked else None
        if chosen and (not found or not chosen.get('empty')):
            found = chosen
    if found or show is None:
        return found
    try:
        shown = show(website)
    except Exception as error:  # noqa: BLE001 — refused, not allowed or no browser: nothing more to do
        note_refusal(website, error)
        return None
    return _explore(website, shown, show)


def read_page_from(markup, url, fetch_page, part=None, linked=None):
    """read_page for a page already fetched: the data of the job pages it links to, or (a page of plain text) the pages' own headings, kept only
    when the AI judges the page one posting (src/sources/one_posting.py: a site's "About Us" or a "3,531 ... jobs" category is not).
    linked: the job pages a board's served layout named (board_layout.py), so no link on the page is asked about; None = the page's job links.
    Either way at most MAX_JOB_PAGES job pages are read, as the page's own job links always were."""
    def one(link):
        with stage.guard('employer sites: linked page') as caught:
            page = fetch_page(link)
        if caught:
            return [], []
        declared = jsonld_jobs(page, link, job_page=True)
        return (declared, []) if declared else ([], [job for job in [job_from_page(page, link)] if job])
    from . import board_round_log, one_posting
    part = part or board_round_log.untimed   # a board's round names where its seconds went (log only); any other page read times nothing
    if linked is None:
        with part('job links'):
            linked = job_links(markup, url)
    linked = linked[:MAX_JOB_PAGES]
    with part(f'{len(linked)} job pages'), ThreadPoolExecutor(max_workers=6) as pool:
        read = list(pool.map(slots.carry(one), linked))
    headed = list({job['url']: job for _, jobs in read for job in jobs}.values())
    with part('postings'):
        postings = {job['url'] for job in one_posting.kept(headed, reader() is not None)}
    found = [job for declared, jobs in read for job in declared + [job for job in jobs if job['url'] in postings]]
    return list({job['url']: job for job in found}.values())



# Imported last: these look up READER, _asked, careers_links ... on this module when called.
from .careers_explore import (successfactors_site, _look, _shell, CAREER_SUBDOMAINS, SECOND_LEVEL, company_domain, COMMON_PATHS,  # noqa: E402,F401
                              guessed_links, _quiet, _says_no_jobs, _listed, _explore)
