"""Whether a proposed job board is one (owner, 19 Oct 2026, step 1 of the local-sources sketch: two of a driver's three trade boards were
made up: fahrerjobs.de is one haulage company's own site, trucker.jobs has no address). Asked once per board, only when its read gave no
job: its home page is fetched (structure only: no address, or a home page that is not there, is 'gone'; a refusal is left to the read),
and the AI says what the site is from its name, description and link texts, one fixed answer (src/ai/decide.py). Nothing is checked
while the AI page reader is off (careers.READER None: tests, a user who keeps pages from the AI). found_boards.read reads a spare board in place of one
that is not a board, hands 'one employer' to the scout with its website (board_employers.note_site) and skips them later
(board_yield.pick). Tests: tests/unit/sources/test_board_check.py.
field_kind: the same question for THIS search's field, asked before a board the web search found joins the list (owner's yes, 26 Oct 2026, discovery
sketch "AI judges the page": a pilot search's web search returned a recruiter, a news site's search page and an empty board as trade boards).
Tests: tests/unit/sources/test_board_judge.py.
Both judge the home page and the page the board's jobs are listed on (its link filled with the search's first word, in the board's charset);
a list page built by scripts gives no verdict: the read's own state stands (owner via sa, 14 Nov 2026: "let's fix what we learn").
Case set: 'board-kind' in tools/prompt-cases.json (tools/board-kind-cases.py replays it)."""
import re
import socket
from datetime import datetime, timezone
import urllib.error
import urllib.parse
from html.parser import HTMLParser

from . import board_paths, careers
from ..press import stage

KINDS = ('job board', 'one employer', 'other')
NOT_A_BOARD = ('gone', 'one employer', 'other')   # what is read in place of a board, not as one
TOPIC = 'job site kind'
# Why (14 Nov 2026, owner via sa): both judges left these out as 'not a job board'; one constant, so the two instructions cannot drift (Gitar, #4209)
JOB_BOARD_EXAMPLES = "the job section of a classifieds or marketplace site, a public or municipal employment service's vacancy list"
INSTRUCTIONS = ("Say what this website is, from its home page and the page its job offers are listed on (each: name, description and "
                "the texts of its links). 'job board': it lists job offers from many different employers (a job portal, a job search "
                "site, a staffing agency's list of its clients' jobs, " + JOB_BOARD_EXAMPLES + "). 'one employer': it is one company's "
                "or organisation's own site, even with a careers page. 'other': anything else (a directory, news, a parked or empty domain).")
LINKS = 40   # link texts sent at most
CHROME = ('nav', 'header', 'footer', 'aside')   # the site's own menus, sent after the page's own links


class _Digest(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title, self.meta, self.links, self.menus, self._in, self._chrome = '', {}, [], set(), None, 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'meta' and (attrs.get('name') or attrs.get('property')) in ('description', 'og:site_name', 'og:description'):
            self.meta.setdefault(attrs.get('name') or attrs.get('property'), (attrs.get('content') or '').strip())
        self._chrome += tag in CHROME
        if tag in ('title', 'a'):
            self._in = tag
            if tag == 'a':
                self.links.append('')
                if self._chrome:
                    self.menus.add(len(self.links) - 1)

    def handle_endtag(self, tag):
        if tag in CHROME and self._chrome:
            self._chrome -= 1
        if tag == self._in:
            self._in = None

    def handle_data(self, data):
        if self._in == 'title':
            self.title += data
        elif self._in == 'a' and self.links:
            self.links[-1] += data


def _read(page):
    digest = _Digest()
    with stage.guard('job boards: page parse'):   # a broken page: what was read so far
        digest.feed(page)
    return digest


def digest(page):
    """The page's name, description and link texts, as the AI is asked about it: the page's own links first, the site's menus (CHROME) after."""
    found = _read(page)
    # Why (14 Nov 2026, xa): a classifieds search page's first 40 links were its category menus; its ads came after them and never reached the AI
    ordered = sorted(range(len(found.links)), key=lambda at: at in found.menus)
    links = list(dict.fromkeys(text for text in (' '.join(found.links[at].split()) for at in ordered) if 1 < len(text) < 60))[:LINKS]
    return '\n'.join(part for part in (f"Name: {' '.join(found.title.split())}", f"Site: {found.meta.get('og:site_name', '')}",
                                       f"Description: {found.meta.get('description') or found.meta.get('og:description', '')}",
                                       'Links: ' + ' | '.join(links)) if part.split(': ', 1)[1])


def name_of(page, host):
    """The site's own name (og:site_name, else its title's first part), else its host."""
    found = _read(page)
    title = re.split(r'\s*[|·:]\s+|\s+[\-–—]\s+', ' '.join(found.title.split()))[0]   # "Name: page" / "Name | page" / "Name - page\"
    return found.meta.get('og:site_name') or title or host


def home(board):
    parts = urllib.parse.urlsplit(board['search_url'])
    return f'{parts.scheme}://{parts.netloc}/'


def _quiet(fetch, address):
    """The page at address, or '' when it is not there, refused or failed (the caller then falls back or leaves the board as it is)."""
    try:
        return str(fetch(address) or '')
    except Exception:  # noqa: BLE001 — a refusal or a passing error: no page, the caller's fallback stands
        return ''


def listed(board, term):
    """The page the board's jobs are listed on: its link filled with `term` in the board's learned charset, as the read fills it (a link without
    {role} is that page itself). No place: the judge asks what the site is, and a list for no place is its widest one."""
    return board_paths.forms(board['search_url'], term, '', board.get('charset'))[0]   # Why (#4216, Gitar): a UTF-8 word on a cp1251 board lists other jobs


def shown(front, listing, term):
    """What the AI is shown of a site: the digest of its home page and of the page its jobs are listed on, either alone when the other is not there.
    Why (14 Nov 2026, xa, try 2): the home page alone hid a classifieds site's job section; the list page alone hid that a magazine's search
    showing job ads is a magazine with a job market, and an English word on a local classifieds site listed goods."""
    return '\n'.join(part for part in (f'Home page:\n{front}' if front else '', f"Its list for '{term}':\n{listing}" if listing else '') if part)


def _list_page(board, fetch, term):
    """The list page filled with `term` when it is not the home page itself, else ''."""
    address = listed(board, term)
    return _quiet(fetch, address) if address != home(board) else ''


def _front(board, fetch):
    """(home page, None), or ('', 'gone') when the site has no address or no home page, ('', None) on a refusal or a passing error."""
    try:
        return str(fetch(home(board)) or ''), None
    except urllib.error.HTTPError as error:
        return '', ('gone' if error.code in (404, 410) else None)
    except urllib.error.URLError as error:
        return '', ('gone' if isinstance(error.reason, socket.gaierror) else None)
    except ValueError:   # careers.get_text: the host has no public address
        return '', 'gone'
    except Exception:  # noqa: BLE001 — a refusal or a passing error: the read's own answer stands
        return '', None


def _digests(front, page, term):
    return shown(digest(front) if front.strip() else '', digest(page) if page.strip() else '', term)


def kind(board, fetch, term='', ask=None):
    """(kind, page): kind 'gone', 'job board', 'one employer', 'other'; None when unknown (no AI, a refusal, a passing error, a list page
    built by scripts or a short one, careers._shell: it says nothing of what the site lists; no home page: a list page alone is too little). The AI is
    shown the home page and the list page filled with `term` (shown); page: the home page, else the list page."""
    if careers.READER is None:   # the AI page reader is off (tests, a user who keeps pages from the AI): no check at all
        return None, ''
    page = _list_page(board, fetch, term)
    front, lost = _front(board, fetch)
    if not front.strip():   # Why (#4205, #4216, Gitar): gone only when the list page gave nothing too; a list page alone is too weak for 30 days
        return ('gone' if lost == 'gone' and not page.strip() else None), page
    if page.strip() and careers._shell(page):   # Why (#4198, Gitar): the read decides what needs a browser; here a frame is no verdict, never a visit
        return None, page
    if ask is None:
        from ..ai import decide
        ask = decide.one
    answer = ask(TOPIC, urllib.parse.urlsplit(home(board)).hostname, _digests(front, page, term), KINDS, INSTRUCTIONS)
    return (answer if answer in KINDS else None), front if front.strip() else page


def checked(board, entry, result, fetch, word, now=None):
    """The read's (jobs, state, route) after the board check, whose verdict is kept in entry['site_kind'] (with 'site_page', 'gone_days').
    Design (owner via sa, 14 Nov 2026; Gitar #4198-#4209), one owner of site_kind, these verdicts only:
    - the read gave jobs: it is a board; a kept 'gone', 'one employer' or 'other' becomes 'job board' (no gone days), no AI ask, the jobs are kept;
    - the read gave jobs, or is 'browser', or the AI page reader is off: nothing else changes;
    - the read gave nothing, and nothing, 'gone', 'one employer' or 'other' is kept: the judge is asked (a kept not-a-board verdict is read only
      on its 30-day retry, board_yield.pick) and its answer is kept; a retry with no answer drops the old verdict, so the next empty read asks;
      an answer that is not a board replaces the read; a kept 'job board' is not asked again.
    word: a function giving the search's first word, called only when the judge is asked."""
    kept = entry.get('site_kind')
    if result[0] and kept in NOT_A_BOARD:   # Why (#4209, #4216, Gitar): jobs read are the proof; a kept 'gone' day must not add up to a drop
        entry['site_kind'], entry['site_page'], entry['gone_days'] = 'job board', '', []
    if result[0] or result[1] == 'browser' or careers.READER is None or kept not in (None, 'gone', 'one employer', 'other'):
        return result
    site, page = kind(board, fetch, word())
    if not site and kept in ('one employer', 'other'):   # Why (14 Nov 2026, owner via sa): a wrong 'other' must not stay for ever
        for key in ('site_kind', 'site_page'):
            entry.pop(key, None)
    if site:
        entry['site_kind'], entry['site_page'] = site, name_of(page, board['host']) if site == 'one employer' else ''
        day = (now or datetime.now(timezone.utc)).date().isoformat()   # gone on two days: a Mac offline for one search keeps its boards
        entry['gone_days'] = sorted({*entry.get('gone_days', []), day})[-2:] if site == 'gone' else []
    return ([], site, None) if site in NOT_A_BOARD else result


FIELD_KINDS = ('field board', 'job board', 'one employer', 'other')
FIELD_TOPIC = 'job site kind for a field'
FIELD_INSTRUCTIONS = ("Say what this website is for the person looking for work given first, from its home page and the page its job "
                      "offers are listed on (each: name, description and the texts of its links). 'field board': it lists job offers from "
                      "many employers in that person's field (a job board of the field, a recruiter's list of many clients' jobs in it, the "
                      "job section of the field's trade press or association). 'job board': it lists job offers from many employers of any "
                      "field (a general job portal, " + JOB_BOARD_EXAMPLES + "). 'one employer': it is one company's or organisation's own "
                      "site, even with a careers page. 'other': anything else (news without job offers, a directory, a shop, a parked or "
                      "empty domain).")


def field_kind(board, fetch, roles, ask=None):
    """'field board', 'job board', 'one employer' or 'other' for this board, for someone looking for work as `roles`, from its home page and the
    page it was found as (a search template: the page it gives for the first role; shown); None when unknown (the page reader off, no home page, a
    list built by scripts, no AI answer): the board then stands as found, its read and check come later."""
    if careers.READER is None:
        return None
    term = roles[0] if roles else ''
    page = _list_page(board, fetch, term)
    if page.strip() and careers._shell(page):   # a list built by scripts says nothing of what it lists: its read tells
        return None
    front = _quiet(fetch, home(board))
    if not front.strip():   # Why (#4205, Gitar): no home page, no verdict from the list page alone; the board stands, its read tells
        return None
    if ask is None:
        from ..ai import decide
        ask = decide.one
    text = f"Looking for work as: {', '.join(roles)}\n" + _digests(front, page, term)
    answer = ask(FIELD_TOPIC, urllib.parse.urlsplit(home(board)).hostname, text, FIELD_KINDS, FIELD_INSTRUCTIONS)
    return answer if answer in FIELD_KINDS else None


COUNTRY_ANSWERS = ('this country', 'several countries or remote', 'another country')
COUNTRY_TOPIC = 'job board country'
COUNTRY_INSTRUCTIONS = ("A job board's page and the country named first. Say where the job offers it lists are: 'this country' when they are in "
                        "that country (a national or local board of it), 'several countries or remote' when they span countries or are remote "
                        "jobs, 'another country' when they are in one other country.")


def lists_country(board, fetch, country_name, ask=None):
    """'this country', 'several countries or remote' or 'another country' for the jobs this board's page lists; None when unknown (no page,
    no AI answer). The central scout counts a board's place-less jobs in a country only on 'this country' (src/scout_boards.py; owner,
    26 Oct 2026, "AI names the board's country"). Tests: tests/unit/sources/test_board_country.py."""
    address = home(board) if '{' in board['search_url'] else board['search_url']
    page = _quiet(fetch, address)   # a refusal or a passing error: unknown
    if not page.strip():
        return None
    if ask is None:
        from ..ai import decide
        ask = decide.one
    answer = ask(COUNTRY_TOPIC, urllib.parse.urlsplit(address).hostname, f'Country: {country_name}\n{digest(page)}', COUNTRY_ANSWERS, COUNTRY_INSTRUCTIONS)
    return answer if answer in COUNTRY_ANSWERS else None
