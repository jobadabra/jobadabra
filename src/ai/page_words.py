"""What a careers page's links, hosts and titles mean, decided by AI first (audit PR 7 of 7, owner 26 Oct 2026: "we should AI as much as needed
and possible to decice on things"). The 11 'page-words' keyword answers (config/meanings_schema.json) used to decide first; now:
- link-kind: a same-site link's text + path (careers_link, strong_jobs, job_path, not_jobs, job_host, board_careers_link, job_list, not_a_list);
- title-kind: whether a found entry is a job title or a page heading (job_title, not_a_job);
- the AI page reader: whether a page says it has no open jobs (no_jobs; src/ai/page_reader.py).
Each wording is asked once (decide.py: kept on this computer, then the meanings pack, then a batch of 50), so the code that reads links stays
synchronous. Past the call cap or on a failure a wording is unknown (None) and its link is skipped this run, never a keyword's guess; with no AI
at all (`ai_on()` false) the old words answer, as the offline floor. Structure that stays: same site or not, file endings, job-system
addresses, an id at the end of a path, paging numbers. Tests: tests/unit/ai/test_page_words.py."""
import os
import re
from typing import NamedTuple

from . import decide, meanings_pack

LINK, TITLE = 'link-kind', 'title-kind'
LINK_ANSWERS = ('job_list', 'careers_page', 'job_page', 'not_jobs', 'other')
TITLE_ANSWERS = ('job_title', 'heading')
ONLY = {'board_careers_link': 'weak', 'job_list': 'weak', 'not_a_list': 'not_jobs'}   # which Words field an old list stands for when a caller used it alone
MAX_WORDINGS = 300   # distinct link wordings judged in one call site
# Why (13 Nov 2026, owner, asked via AskUserQuestion by sa: "Sample per shape, AI decides (Recommended)": "For a shape with 3+ links the AI is
# asked about 3 of them. If all 3 get the same answer, it holds for the rest of that shape on that page; if they differ, every link of the shape
# is asked as today. Single links (contact, companies) are always asked one by one."): one Madrid results page asked 315 link wordings, most of
# them city links of one shape (239 paths), and three boards' 502 wordings took 11 calls (c04, run 43473395249: "job links 82 s"); by shape, 120 (3 calls).
# Why (13 Nov 2026, owner, asked via AskUserQuestion by sa: "Only job verdicts spread (Recommended)": "A shape whose 3 samples all say "job"
# gives that to the rest. A shape whose samples say "not a job" is asked link by link."; issue #4038): a site's menu sections under one parent
# are one shape, and 3 non-job samples gave "not jobs" to the section that lists jobs (19 job links on 3 of 37 boards, 76 pages); spreading
# only a job verdict lost none, at 4,224 wordings against 3,671 (5,219 asked link by link). Gitar's finding on #4022 was right.
SAMPLE = 3
SPREAD = ('job_list', 'job_page', 'careers_page')   # the only verdicts a shape's samples give its other links

# Where every 'page-words' answer lives now; tests/unit/ai/test_page_words.py fails when an answer is missing here (a new one must be placed).
PLACED = {'careers_link': LINK, 'strong_jobs': LINK, 'job_path': LINK, 'not_jobs': LINK, 'job_host': LINK, 'board_careers_link': LINK,
          'job_list': LINK, 'not_a_list': LINK, 'job_title': TITLE, 'not_a_job': TITLE, 'no_jobs': 'page-reader'}

LINK_TASK = ('One link on an employer\'s website or a job site: its visible text and its address path (numbers shown as 0), or "site address:" and a '
             'host name. job_list: leads to the list of all open jobs; careers_page: the careers, vacancies or work-with-us page; job_page: one '
             'job\'s own page; not_jobs: not about open jobs (news, blog, press, privacy, contact, benefits, events, login, alerts, articles, '
             'apprenticeship, internship or study places); other: anything else. For a site address: job_list or careers_page when the host is '
             'named for jobs or careers, else other.')
TITLE_TASK = ('The text of one entry on an employer\'s careers page. job_title: the title of one open job or role, in any language; heading: a '
              'menu entry, section or page heading that is not a job (careers, benefits, culture, students, search, life at the company).')


class Words(NamedTuple):
    """What the old keyword lists answered for one link, now from the AI's kind of it."""
    strong: bool      # the list of open jobs
    weak: bool        # a careers or job page
    not_jobs: bool
    job_path: bool    # a job-ish address
    weak_text: bool = False   # the link's own text names the careers page (the old rule for a job-system link)


WORDS = 'page words'   # the own allowance (decide.own_allowance) under which the AI judges page words while the page reader is off


def ai_on():
    """The AI may judge page words in this thread: the page reader is on (not the tests' None, not a fixture run), or the thread is inside the
    WORDS allowance, and an AI is ready.
    Why (13 Nov 2026, sa; Portugal trial 43425606888): board discovery's first read keeps the page reader off, so it judged a board's links with
    the word lists only ("30 links, 0 the AI called job pages, 30 not judged") while every install asks the AI about them, and learned no layout.
    The pass opens WORDS for that read: its link, host and title questions are asked, each on that allowance; past it a link stays unjudged."""
    if os.getenv('JOBADABRA_FIXTURE_DIR'):
        return False
    from ..sources import careers
    from . import decide
    if careers.READER != 'auto' and decide.own_scope() != WORDS:
        return False
    from . import page_reader
    return page_reader.usable()


def _shape(path):
    return re.sub(r'\d+', '0', str(path or '').split('?')[0].lower())[:120]


def _wording(text, path):
    return f'link text: {re.sub(chr(32) + "+", " ", str(text or "")).strip()[:80]} | path: {_shape(path)}'.lower()


def _floor_matchers():
    return {answer: meanings_pack.matcher('page-words', answer) for answer in PLACED}


def floor_words(text, path, only=None):
    """The old lists' answers for one link (the offline floor, used only with no AI at all). only: the one old list a caller used on its own
    (boards.py's board_careers_link, searched in the text and the address together)."""
    m = _floor_matchers()
    if only:
        hit = bool(m[only].search(f'{text} {path}'))
        return Words(False, hit and ONLY[only] == 'weak', hit and ONLY[only] == 'not_jobs', False)
    path = str(path or '')
    strong = bool(m['strong_jobs'].search(text) or m['strong_jobs'].search(path))
    weak = bool(m['careers_link'].search(text) or m['careers_link'].search(path))
    return Words(strong, weak, bool(m['not_jobs'].search(path)), bool(m['job_path'].search(path)), bool(m['careers_link'].search(text)))


def from_kind(kind):
    if kind == 'job_list':
        return Words(True, True, False, True, True)
    if kind in ('careers_page', 'job_page'):
        return Words(False, True, False, True, True)
    return Words(False, False, kind == 'not_jobs', False)


def _kinds(topic, items, answers, task):
    """{key: answer} for the wordings the AI has judged (kept here) or the site's pack knows; the AI is asked about the rest only when it is on."""
    if ai_on():
        return decide.decide(topic, items, answers, task, floor=False) or {}
    found = decide.kept(topic, items)
    for key, text in items.items():
        if key not in found and (known := meanings_pack.first(topic, text, patterns=False)):
            found[key] = known
    return found


def _family(path):
    """The shape a link shares with its siblings on one page: the path with numbers as 0 and its last part as *, for a path of 2+ parts
    ('/ofertas/0/*'); None for a 1-part path (/contacto, /empresas): those are always asked one by one."""
    parts = [part for part in _shape(path).split('/') if part]
    return '/' + '/'.join(parts[:-1]) + '/*' if len(parts) >= 2 else None


def _sampled(pairs):
    """{wording: answer} for one page's links, asking the AI about SAMPLE links of each family of SAMPLE+ links (first, middle and last in page
    order) and every other link; a family whose samples all got one job answer (SPREAD) takes it for its other links, else they are asked one by one.
    Design (issue #4038, the 3rd change to this rule this week): a shape is job-agreed (its 3 samples got one SPREAD answer: the rest take it)
    or not (they differ, one is unanswered, or they agree on not_jobs/other: every link is asked); the samples' answer is never kept.
    -> (answers, wordings asked, links answered by their family, families that disagreed)."""
    families = {}
    for text, path in pairs:
        families.setdefault(_family(path), []).append(_wording(text, path))
    families = {key: list(dict.fromkeys(words)) for key, words in families.items()}
    wide = {key: words for key, words in families.items() if key and len(words) >= SAMPLE}
    picks = {key: [words[0], words[len(words) // 2], words[-1]] for key, words in wide.items()}
    first = {w: w for key, words in families.items() for w in (picks[key] if key in picks else words)}
    found = _kinds(LINK, first, LINK_ANSWERS, LINK_TASK)
    split = [key for key in wide if len({found.get(w) for w in picks[key]}) != 1 or found.get(picks[key][0]) not in SPREAD]
    rest = {w: w for key in split for w in wide[key] if w not in first} if found else {}   # nothing answered (cap, failure): never asked twice
    if rest:
        found.update(_kinds(LINK, rest, LINK_ANSWERS, LINK_TASK))
    shared = 0
    for key in set(wide) - set(split):
        for w in wide[key]:
            if w not in found:
                found[w], shared = found[picks[key][0]], shared + 1   # never kept: the AI judged the samples, not this link (one page, one read)
    return found, len(first) + len(rest), shared, len(split)


def link_words(pairs, floor=None):
    """{(text, path): Words or None}: None = not judged yet (the AI is on but past its cap or failed), the link is skipped this run. With no AI
    at all, the old words; a wording kept earlier or learned by the site still answers. With the AI, a family of SAMPLE+ links of one shape
    is asked through SAMPLE of them (_sampled)."""
    pairs = list(dict.fromkeys((str(t or ''), str(p or '')) for t, p in pairs))
    judged = pairs[:MAX_WORDINGS]   # a site map of slugs is thousands: the rest is left for a later run
    no_ai = not ai_on()
    if not judged:
        found = {}
    elif no_ai:
        found = _kinds(LINK, {_wording(t, p): _wording(t, p) for t, p in judged}, LINK_ANSWERS, LINK_TASK)
    else:
        found, asked, shared, split = _sampled(judged)
        if shared or split:
            print(f'Link questions: {asked} wording(s) asked for {len(judged)} link(s); {shared} judged by their shape, '
                  f'{split} shape(s) asked link by link', flush=True)
    return {(t, p): (from_kind(found[_wording(t, p)]) if _wording(t, p) in found else floor_words(t, p, floor) if no_ai else None) for t, p in pairs}


def kept_link_words(pairs):
    """{(text, path): Words or None}: the verdicts link_words already kept for these links (no AI call); None = not judged (past MAX_WORDINGS,
    the cap, a failure, or the AI was off and the word lists answered). Why (#3987, Gitar): a log reads the verdicts through link_words' own key."""
    from . import decide
    pairs = list(dict.fromkeys((str(t or ''), str(p or '')) for t, p in pairs))
    found = decide.kept(LINK, {_wording(t, p) for t, p in pairs[:MAX_WORDINGS]})
    return {(t, p): (from_kind(found[_wording(t, p)]) if _wording(t, p) in found else None) for t, p in pairs}


def host_named(hosts):
    """{host: True/False/None}: is this host named for jobs or careers (jobs.acme.com, stellen.lu.ch)? None = not judged yet."""
    hosts = list(dict.fromkeys(str(h or '').lower() for h in hosts if h))
    items = {f'site address: {h}': f'site address: {h}' for h in hosts}
    found = _kinds(LINK, items, LINK_ANSWERS, LINK_TASK) if items else {}
    floor = not ai_on()
    return {h: (found[f'site address: {h}'] in ('job_list', 'careers_page') if f'site address: {h}' in found
                else bool(meanings_pack.matcher('page-words', 'job_host').search(h)) if floor else None) for h in hosts}


def title_kinds(titles):
    """{title: 'job_title' | 'heading' | None}: None = not judged, or (floor) a title neither list names."""
    titles = list(dict.fromkeys(str(t or '').strip() for t in titles if str(t or '').strip()))
    items = {t.lower(): t for t in titles}
    found = _kinds(TITLE, items, TITLE_ANSWERS, TITLE_TASK) if items else {}
    floor = not ai_on()
    like, notjob = meanings_pack.matcher('page-words', 'job_title'), meanings_pack.matcher('page-words', 'not_a_job')
    out = {}
    for t in titles:
        if t.lower() in found:
            out[t] = found[t.lower()]
        elif floor:
            out[t] = 'job_title' if like.search(t) else 'heading' if notjob.search(t) else None
        else:
            out[t] = None
    return out
