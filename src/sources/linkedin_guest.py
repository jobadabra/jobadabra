"""LinkedIn's public (logged-out) job search, read on the person's own computer at a person's pace (spec docs/superpowers/specs/2026-11-13-linkedin-guest-search-design.md).
The method is JobSpy's (speedyapply/JobSpy, MIT, jobspy/linkedin): GET the guest search list, 10 cards a page, `start` 0/10/20, LinkedIn's empty end page
when the list is done, the job's own page for its description. Our own code; nothing of JobSpy's is copied.
Why (owner, 13 Nov 2026, asked via AskUserQuestion: "On each person's Mac (Recommended)": "Each Find jobs reads a few pages from the person's own internet address, with
JobSpy's pace (3-7 s between pages) and a stop at the first 429 or check", since slowed to GAP_S; then "3 searches × 3 pages (Recommended)", "Only kept jobs, ≤10 (Recommended)",
"Shared 1-day pause (Recommended)"): most people never turn on the signed-in LinkedIn switch, so Find jobs read no LinkedIn job for them.
Invariants: one request to LinkedIn at a time, GAP_S after this computer's last one began (any process's), search pages and job pages in the same queue (sa, 13 Nov 2026: one gap for the whole host);
no cookie (an opener with no cookie jar), no proxy, never the signed-in session, our own honest user agent (CLAUDE.md: never disguise); the first 401/403/429/999, sign-in or
check page, or a page that is neither cards nor the empty end stops every LinkedIn read of this process with no retry, said once (SLOW_DOWN is the line the app pauses
LinkedIn on, desktop/lib); no request starts past the read cut (src/sources/read_budget.py cut_at); at most WINDOW_MAX requests in any WINDOW_S on this computer, every
process and press together (the times in FILE, numbers only), search pages first (at most SEARCH_PAGES a process), job pages with what is left. A slow-down is judged by host_pace.answer (the one owner of
429 / 503 + Retry-After, which also widens LinkedIn's gap for every other reader), never retried here. The process's pace lives on PACE, named on the Run
(src/press/run.py reads['LinkedIn']). On only where JOBADABRA_LINKEDIN_GUEST=1
(src/features.py 'linkedin_guest'; src/sources/reader_rows.py is its row). Tests: tests/unit/sources/test_linkedin_guest.py (recorded pages, a stand-in site)."""
import html
import json
import os
import random
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from .. import time_budget
from . import ats, host_pace, page_bytes, posting_text

NAME = 'LinkedIn'
SEARCH_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search'
JOB_URL = 'https://www.linkedin.com/jobs/view/{id}/'   # job_alerts.canonical's form: one job whether a search, an alert e-mail or the signed-in read found it
SEARCHES, PAGES, PAGE_SIZE = 3, 3, 10   # owner, 13 Nov 2026: "3 searches × 3 pages (Recommended)"; the window below reads fewer
# Why (owner, 13 Nov 2026, asked via AskUserQuestion with the measurement: "≤6 in any 10 min (Recommended)"): LinkedIn answered 429 to one address after ~11 guest
# requests in ~10 min, and 9 search + 10 job pages a press would reach it, pausing both LinkedIn reads a day; about half the line, page 1 of each search first.
# Unknown yet: whether job pages count against the same limit (sa, 13 Nov 2026); they share the window until measured.
WINDOW_S, WINDOW_MAX, SEARCH_PAGES = 600, 6, 4
WINDOW_FULL = 'the LinkedIn reads of the last 10 minutes are used: the rest waits for a later run'
FILE = None   # tests point it at a temp file; else data/linkedin_guest.json
# Why (owner, 13 Nov 2026, asked via AskUserQuestion: "20–40 s random (Recommended)"): JobSpy's 3-7 s read 9 pages in 45 s, the burst LinkedIn throttles;
# single requests spread over the press instead, from the start of the last request.
GAP_S = (20.0, 40.0)
EMPTY_END = '<!DOCTYPE html>\n\n<!---->'   # LinkedIn's answer past the last card: the end of a search, not a stop
AUTOMATED = 999   # LinkedIn's own "slow down" to automated reads; host_pace.answer judges the standard ones
WALLS = ('/authwall', '/login', '/checkpoint', '/uas/', '/signup')   # a redirect here is a sign-in or check page
TIMEOUT = 20
SLOW_DOWN = 'LinkedIn asked us to slow down'
SAID = {'limited': f'{SLOW_DOWN}: left alone for now', 'check': 'LinkedIn showed a sign-in or check page: not answered, nothing more is read this time',
        'blocked': 'LinkedIn: could not be read this time'}
JOB_PAGE = re.compile(r'^https://(?:[a-z]{2,3}|www)\.linkedin\.com/jobs/view/(?:[\w%-]*?-)?(\d{6,})/?$')
CARD = re.compile(r'data-entity-urn="urn:li:jobPosting:(\d+)"')



class Pace:
    """This process's LinkedIn reads: one at a time (`lock`), the last request's start (its timeout's cut) and the stop (a SAID key). State in its own attributes,
    named on the Run (src/press/run.py reads['LinkedIn'].held), as the guard tests/guards/rules/test_run_state_only_shrinks.py asks."""

    def __init__(self):
        self.lock = threading.Lock()
        self.reset()

    def reset(self):
        """No request yet, no stop."""
        self.last, self.stopped = None, None

    def stop(self, why):
        """Stop every later read of the process; True the first time (it is said once)."""
        first, self.stopped = not self.stopped, self.stopped or why
        return first

    def began(self, at):
        """A request starts now (`at`, the run's clock)."""
        self.last = at


PACE = Pace()
_opener = urllib.request.build_opener()   # no HTTPCookieProcessor: nothing is kept or sent
_sleep = time.sleep


class Later(OSError):
    """LinkedIn is not read any more in this run (a stop, the read cut or the job-page cap): what is left waits for a later run, never a retry now.
    Why (Gitar on #3995): not a host_pace.Busy, whose `until` says when to ask again; this names no time, the next run decides."""

    def __init__(self, url, why):
        super().__init__(why)
        self.url, self.why = url, why


def reset():
    """Forget this process's pace and stop (tests); the window's file is the computer's, kept."""
    with PACE.lock:
        PACE.reset()


def on(env=None):
    """Whether this run reads LinkedIn's public search: only where the desktop app set the flag (src/features.py)."""
    from ..features import disabled, enabled
    return not disabled('aggregators', env) and enabled('linkedin_guest', env)


def job_page(url):
    """True for a LinkedIn job's own page while the guest read is on: the only LinkedIn page src/sources/describe.py may read."""
    return bool(JOB_PAGE.match(str(url or ''))) and on()


def _file():
    if FILE:
        return FILE
    from ..paths import DATA
    return DATA / 'linkedin_guest.json'


def _sent(at):
    """Start times (epoch s) of this computer's LinkedIn requests in the window ending at `at`, every process's (read fresh: another press may have asked)."""
    try:
        times = json.loads(_file().read_text()).get('sent', [])
    except (OSError, ValueError, AttributeError):
        times = []
    # a time a little ahead still counts (the file keeps 0.1 s; another process's clock), and one far ahead (a clock set back) only for a window
    return [float(t) for t in times if isinstance(t, (int, float)) and at - WINDOW_S < float(t) < at + WINDOW_S]


def _spend(at):
    """Count one request that starts now; False when the window filled meanwhile (another process sent during the gap: nothing is sent). Why (Gitar on #3998):
    the count is read again at the moment of sending and written whole (a temp file, then os.replace), so two presses cannot both pass on one look.
    A file that cannot be written still lets this one request go; this process's next look reads what is there."""
    times = _sent(at)
    if len(times) >= WINDOW_MAX:
        return False
    try:
        path = _file()
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(f'{path.name}.{os.getpid()}.tmp')
        temp.write_text(json.dumps({'sent': [round(t, 1) for t in times + [at]]}) + '\n')
        os.replace(temp, path)
    except OSError:
        pass
    return True


def left():
    """How many LinkedIn requests this computer may still send now (0 after a stop): src/sources/describe.py reads only that many job pages."""
    with PACE.lock:
        return 0 if PACE.stopped else max(0, WINDOW_MAX - len(_sent(time_budget.wall().timestamp())))


def _stop(why, status=0):
    """Stop every LinkedIn read of this process and say so once."""
    if PACE.stop(why):
        print(SAID[why] + (f' (HTTP {status})' if status else ''), flush=True)
    return Later(SEARCH_URL, SAID[why])


def _cut():
    from . import read_budget
    return read_budget.cut_at()


def _get(url):
    """(final address, text) of one LinkedIn page, in turn and at the pace; Later when LinkedIn may not be asked now. Raises a network error as it is."""
    with PACE.lock:   # held through the request: one at a time, so the gap holds for every thread of the process
        if PACE.stopped:
            raise Later(url, SAID[PACE.stopped])
        at = time_budget.wall().timestamp()
        sent = _sent(at)
        if len(sent) >= WINDOW_MAX:
            raise Later(url, WINDOW_FULL)
        cut, now = _cut(), time_budget.now()
        # Why (Gitar on #3998): the gap counts from this computer's last request, any process's, so two presses are spaced too, not only one press's pages
        wait = 0.0 if not sent else max(0.0, max(sent) + random.uniform(*GAP_S) - at)
        if cut is not None and now + wait >= cut:
            raise Later(url, 'the read time is up')
        if wait:
            _sleep(wait)
        if not _spend(time_budget.wall().timestamp()):   # counted once sent, whatever comes back
            raise Later(url, WINDOW_FULL)
        PACE.began(time_budget.now())
        timeout = TIMEOUT if cut is None else max(1.0, min(TIMEOUT, cut - PACE.last))
        request = urllib.request.Request(url, headers={'User-Agent': ats.USER_AGENT, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9'})
        try:
            with _opener.open(request, timeout=timeout) as response:
                final, text = response.geturl(), page_bytes.reply(response, 3_000_000)
        except urllib.error.HTTPError as error:
            if error.code in host_pace.REFUSED:
                raise _stop('blocked', error.code) from error
            if error.code == AUTOMATED or host_pace.answer(url, error.code, host_pace.retry_after(error.headers), burst=False):
                raise _stop('limited', error.code) from error
            raise
        if any(urllib.parse.urlsplit(final).path.startswith(wall) for wall in WALLS):
            raise _stop('check')
        return final, text


def _plain(fragment):
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', fragment or '')).split())


def _inner(chunk, tag, cls):
    found = re.search(rf'<{tag}\b[^>]*class="[^"]*\b{re.escape(cls)}\b[^"]*"[^>]*>(.*?)</{tag}>', chunk, re.S)
    return _plain(found.group(1)) if found else ''


def parse_cards(page, place=''):
    """The jobs of one search page, as listed: title, company, place (the card's, else the place searched), date, the job's canonical address."""
    marks = list(CARD.finditer(page or ''))
    jobs = []
    for index, mark in enumerate(marks):
        chunk = page[mark.start():marks[index + 1].start() if index + 1 < len(marks) else len(page)]
        title = _inner(chunk, 'h3', 'base-search-card__title')
        if not title:
            continue
        posted = re.search(r'<time\b[^>]*datetime="(\d{4}-\d{2}-\d{2})"', chunk)
        job_id = mark.group(1)
        jobs.append({**ats._job(f'linkedin:{job_id}', title, _inner(chunk, 'span', 'job-search-card__location') or place, JOB_URL.format(id=job_id),
                                posted.group(1) if posted else ''),
                     'company': posting_text.label(_inner(chunk, 'h4', 'base-search-card__subtitle')) or 'Unknown employer'})
    return jobs


def searches(search):
    """[(role, place)] of the strategy's own LinkedIn searches (src/sources/visits_portals.py linkedin_searches, the signed-in read's list too), at most SEARCHES."""
    from .visits_portals import linkedin_searches
    out = []
    for item in linkedin_searches(search, SEARCHES):
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(item['url']).query)
        out.append(((query.get('keywords') or [''])[0], (query.get('location') or [''])[0] or item.get('place', '')))
    return [(role, place) for role, place in out if role]


def _page(role, place, page, seen, jobs):
    """Read one page of one search, its new jobs added to `jobs`; True when the search may have a next page (a full page with something new)."""
    url = SEARCH_URL + '?' + urllib.parse.urlencode({'keywords': role, 'location': place, 'start': page * PAGE_SIZE})
    _, text = _get(url)
    cards = parse_cards(text, place)
    if not cards:
        if text.strip() != EMPTY_END.strip():
            raise _stop('blocked')
        return False
    fresh = [job for job in cards if job['id'] not in seen]
    seen.update(job['id'] for job in fresh)
    jobs += fresh
    return len(cards) == PAGE_SIZE and bool(fresh)


def read(search):
    """The jobs of the strategy's LinkedIn searches, as listed (titles and places are judged by the run like any source's): page 1 of each search, then page 2,
    at most SEARCH_PAGES pages. What was read before a stop, the read cut or a full window is kept. A search that fails on the network is that search only;
    all failing raises the last error (the lane failing)."""
    jobs, seen, failed, error, held = [], set(), set(), None, ''
    wanted, asked = searches(search), 0
    going = list(wanted)
    for page in range(PAGES):
        for pair in list(going):
            if asked >= SEARCH_PAGES:
                going = []
                break
            asked += 1
            try:
                more = _page(*pair, page, seen, jobs)
            except Later as later:
                going, held = [], later.why
                break
            except OSError as problem:   # a timeout or no network: the next search is tried
                failed.add(pair)
                more, error = False, problem
            if not more:
                going.remove(pair)
    if wanted and len(failed) == len(wanted):
        raise error
    if not PACE.stopped:
        print(f'LinkedIn: {len(jobs)} job(s) from the public search' + (f' ({held})' if held else ''), flush=True)
    return jobs


def description(url):
    """A LinkedIn job page's text ('' when it has none or LinkedIn sent it elsewhere); Later when LinkedIn may not be asked now (src/sources/describe.py keeps it for a later run)."""
    found = JOB_PAGE.match(str(url or ''))
    if not found:
        return ''
    final, text = _get(JOB_URL.format(id=found.group(1)))   # the window counts it once sent, whatever comes back (Gitar on #3995)
    if not urllib.parse.urlsplit(final).path.startswith('/jobs/view/'):
        return ''
    body = re.search(r'<div\b[^>]*class="[^"]*\bshow-more-less-html__markup\b[^"]*"[^>]*>(.*?)</div>', text, re.S)
    return ats.plain(body.group(1))[:ats.DESCRIPTION_LIMIT] if body else ''
