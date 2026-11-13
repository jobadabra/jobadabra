"""Whether a page a listing links to is one job posting a person can apply to, judged by the AI before it is kept as a job (26 Oct 2026: a
proof run stored irishjobs' "3,531 Assistant Psychology jobs" and "565 HR jobs" categories and itjobswatch's pages as new jobs, 9 of its 10;
the rules pick a board's category, salary-filter and salary-statistics links like job links). Only pages with no JobPosting data are asked: their title is just the page's heading (careers.job_from_page), so a site's
own page or a category page looks like a job to the title filter. Fixed answers through src/ai/decide.py, kept per address (asked once).
A failed, busy or capped AI leaves a page unjudged: not kept this time, asked again next read. With no AI page reader (no AI at all, or
switched off: careers.reader() is None) nothing is asked and the pages stand, as before (the offline floor), except in board discovery's
pass (pass_allowance): it judges its pages on its own calls, so discovery and installs count the same job pages. At most MAX_ASKS calls per run:
decide's call cap is shared with title sorting and kinds of work, which a run cannot do without.
Tests: tests/unit/sources/test_one_posting.py, tests/unit/sources/test_scout_board_postings.py."""
from contextlib import closing, contextmanager
import sqlite3
import threading

TOPIC = 'one-posting'
POSTINGS = 'job pages'   # board discovery's own allowance for this question (src/scout_boards.py POSTING_CALLS)
ANSWERS = ('one_posting', 'other')
MAX_ASKS = 20   # model calls per process for this question (one per listing page whose linked pages carry no job data)
_asks = {'n': 0}   # this process's calls; past MAX_ASKS only answers kept earlier count, the rest stay unjudged (not kept) for the next run
TEXT = 450   # characters of the page's own text sent with its heading and address
TASK = ('A page a job site links to from its list, read as a possible job: its heading, its address and the start of its text. one_posting: '
        'the page is one open position a person can apply to (one role at one employer, even when it names several places or levels). '
        "other: anything else: the site's own pages (about the site, contact, privacy, terms, help, sign-in), a category, search or list "
        'of many jobs (often a count of jobs), an article or guide, a company profile, a salary or market statistics page.')


def _text(job):
    return f"Heading: {job['title']}\nAddress: {job['url']}\nText: {(job.get('description') or '')[:TEXT]}"


def is_one(job):
    """True when the AI judged this page, as it reads now, one open posting; False for any other answer and for no answer (no AI, busy): not judged =
    not read on a guess. Why (5 Nov 2026, review): asked at an Apply press beside a running search, so its answer is kept nowhere: a prepare run leaves
    the job cache alone (src/__main__.py), and a page that closed or came back is judged afresh."""
    from ..ai import decide
    with closing(sqlite3.connect(':memory:')) as db:
        return decide.one(TOPIC, job['url'], _text(job), ANSWERS, TASK, db=db) == 'one_posting'


@contextmanager
def pass_allowance(n):
    """Board discovery's read in this thread judges its job pages with the page reader off, on `n` calls of their own (POSTINGS).
    Why (13 Nov 2026, sa; lab run 43432640838): with no reader every linked page stood as a job, so a board's filter pages counted as 25 of its
    39 jobs and blocked its layout, and another board's redirect stubs counted as 20 local jobs, where an install judging them counts none.
    Invariant: a spent allowance leaves a page unjudged and not kept (never the reader-off keep-all); only this thread draws from it."""
    thread = threading.current_thread()
    before = getattr(thread, 'posting_calls', None)
    thread.posting_calls = n
    try:
        yield
    finally:
        thread.posting_calls = before


def kept(jobs, reader_on, judge=None):
    """The jobs among `jobs` the AI judged one posting; all of them with no AI page reader, unless this thread is board discovery's read
    (pass_allowance), which asks on its own calls. `judge` (tests): decide.decide's stand-in."""
    calls = getattr(threading.current_thread(), 'posting_calls', None)
    if not jobs or (not reader_on and calls is None):
        return list(jobs)
    from ..ai import decide
    if not reader_on:
        with decide.own_allowance(POSTINGS, calls):   # the pass's own pool, not the run's cap, MAX_ASKS or its page-words allowance
            answers = (judge or decide.decide)(TOPIC, {job['url']: _text(job) for job in jobs}, ANSWERS, TASK) or {}
        return [job for job in jobs if answers.get(job['url']) == 'one_posting']
    before = decide._calls['n']
    answers = (judge or decide.decide)(TOPIC, {job['url']: _text(job) for job in jobs}, ANSWERS, TASK, ask=_asks['n'] < MAX_ASKS) or {}
    _asks['n'] += decide._calls['n'] - before   # model calls only: a page judged before costs nothing (other topics' calls meanwhile count too)
    return [job for job in jobs if answers.get(job['url']) == 'one_posting']
