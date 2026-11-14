"""Acceptance: "First Officer · Europe" on an install with old state gets First Officer jobs from the boards its web search found, on screen
before any employer site (src/sources/boards_first.py; owner, 26 Oct 2026: "START A JOB SEARCH WITH SEARCHING ON GOOGLE!"). Old state = the
boards rested less than 6 h ago, an old board list read for another search. Offline: the web search's answer is a fixed fake, the boards are
fixture pages in two shapes seen on real boards (job links by id, job cards by slug), fake jobs only; no model, no network.
The role kind on old state ("First Officer" -> aviation_transport): tests/unit/ai/test_kind_seed_floor.py AnInstallWithStateTests."""
import io
import json
import sqlite3
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src import time_budget
from src.sources import aggregators, board_web, boards_ahead, boards_first, careers, feeds, found_boards, read_budget

SEARCH = {'role_keywords': ['first officer'], 'jobs_board_search_queries': ['first officer'], 'locations': {'top_tier': ['europe']}}
ASKED = ('k-pilot', ['Austria', 'Germany'], ['first officer'], ['any'], ['europe'])
_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


INTRO = ('<p>Every flying job on one page: airlines, charter and business aviation across Europe, updated each day by our team. Filter by aircraft '
         'type, base and contract, or read the rules of each operator before you apply. Type rating, hours and licence are listed on every post.</p>')
FOOTER = '<footer><p>About us · Contact · Privacy · Terms · Cookie settings · Advertise a job · Newsletter for pilots and cabin crew</p></footer>'


def by_id(n, first=0, more=''):   # a list of job links by id (a crew board); more: its next page's link
    rows = ''.join(f'<li class="job-row"><a href="/site/de/job/show/id/{100 + i}">First Officer A320 (m/w/d) {i}</a> <span class="company">Example Air {i}</span> '
                   f'<span class="place">Vienna, Austria</span> <span class="date">posted 2 days ago</span> <span class="type">full time, base Vienna</span></li>'
                   for i in range(first, first + n))
    nav = f'<a rel="next" href="{more}">Next page</a>' if more else ''
    return f'<html><body><header><nav>Jobs · Companies · Pilot career</nav></header><h1>Pilot jobs</h1>{INTRO}<ul class="jobs">{rows}</ul>{nav}{FOOTER}</body></html>'


def by_card(n):   # job cards with a slug link each (an aviation CV board)
    cards = ''.join(f'<div class="job-teaser"><div class="job-teaser-title"><a href="/job/b737-first-officer-{200 + i}">B737 First Officer {i}</a></div>'
                    f'<div class="job-teaser-company">Example Air {i}</div><div class="job-teaser-place">Berlin, Germany</div>'
                    f'<div class="job-teaser-info">Permanent contract, 500 hours on type, valid EASA licence</div></div>' for i in range(n))
    return f'<html><body><header><nav>Aviation jobs · Employers · CV</nav></header><h1>Aviation jobs</h1>{INTRO}<section>{cards}</section>{FOOTER}</body></html>'


PAGE_TWO = 'https://crew-board.test/jobs?q=first+officer&page=2'
PAGES = {'crew-board.test': by_id(8, more=PAGE_TWO), 'cv-board.test': by_card(6), 'quiet-board.test': f'<html><body><h1>Jobs</h1>{INTRO}<p>No jobs today.</p>{FOOTER}</body></html>'}
BAD = {'boards': [{'name': host, 'search_url': f'https://{host}/jobs?q={{role}}', 'countries': ['Austria'], 'kinds': ['any'], 'source_kind': 'sector'}
                  for host in ('quiet-board.test', 'refusing-board.test')]}   # the owner's 01:45 run: 2 boards, no job
ANSWER = {'boards': [{'name': host, 'search_url': f'https://{host}/jobs?q={{role}}', 'countries': ['Austria'], 'kinds': ['any'], 'source_kind': 'sector'}
                     for host in PAGES]}


def job_page(url):   # each job's own page: its heading is the title, as on the real boards
    import re
    slug = url.rstrip('/').rsplit('/', 1)[-1]
    number = int(re.findall(r'\d+', slug)[-1])
    title = f'First Officer A320 (m/w/d) {number - 100}' if '/show/id/' in url else f'B737 First Officer {number - 200}'
    return (f'<html><body><h1>{title}</h1><p>Example Air is hiring a {title} for its European bases. Valid EASA licence, type rating and 500 hours '
            f'on type. Full time, permanent contract.</p>{INTRO}{FOOTER}</body></html>')


FETCHED = []


def fetch(url):
    FETCHED.append(url)
    host = url.split('/')[2]
    if host not in PAGES:
        raise OSError(f'not a fixture: {url}')
    return job_page(url) if '/job/' in url else by_id(3, first=50) if url == PAGE_TWO else PAGES[host]


class FakeClient:
    """The web search's model. With a `gate`, it answers only when the test lets it (an event), never after a time: Why (E2b, 8 Nov 2026): the
    order "boards on screen before the web search answers" was asserted with a 2 s sleep against a 1.5 s bound, and "still searching" with a 1 s sleep
    against a 0.2 s wait; a loaded runner moves a sleep and a bound by seconds, an event does not move."""
    def __init__(self, gate=None, answer=None):
        self.gate, self.answer = gate, answer or ANSWER
        self.answered = threading.Event()   # set when the model's answer is given: what the code could have seen, not what the test allowed

    @property
    def messages(self):
        return self

    def create(self, **kwargs):
        if self.gate is not None:
            assert self.gate.wait(30), 'the test never let the web search answer'   # a hang guard, not a measure of speed
        self.answered.set()
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(self.answer))], usage=None)


class OldState(unittest.TestCase):
    """The owner's install as his pilot runs found it: boards read 37 minutes ago for an older search, no search key kept."""

    def setUp(self):
        self.addCleanup(self.no_search_thread_left)   # runs last
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.data = Path(tmp.name)
        read = (datetime.now(timezone.utc) - timedelta(minutes=37)).isoformat(timespec='seconds')
        (self.data / 'found_boards.json').write_text(json.dumps({'boards': {
            'jobber.test': {'name': 'jobber.test', 'last_read': read, 'state': 'ok', 'relevant': 0},
            'rabota.test': {'name': 'rabota.test', 'last_read': read, 'state': 'ok', 'relevant': 0}}, 'ideas': {}, 'web': {}}))
        self.db = sqlite3.connect(':memory:')
        self.db.execute('CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))')
        self.db.execute(aggregators.TABLE)
        self.db.execute('INSERT INTO aggregator_runs VALUES (?, ?)', (boards_ahead.NAME, read))
        wanted = lambda title: 'first officer' in str(title or '').lower()
        fake_careers = SimpleNamespace(READER=object(), get_text=fetch)
        aviation = {'aviation_transport'}   # "First Officer"'s kind (tests/unit/ai/test_kind_seed_floor.py)   # the web search's own check only; the page reader stays off
        for patch in (mock.patch('src.paths.DATA', self.data), mock.patch('src.ai.board_ideas.asked_for', return_value=ASKED),
                      mock.patch.object(board_web, 'careers', fake_careers), mock.patch.object(board_web, 'disabled', return_value=False),
                      mock.patch('src.ai.cost.side'), mock.patch.object(found_boards.careers, 'get_text', fetch),
                      mock.patch.object(feeds, 'wanted_title', wanted), mock.patch.object(feeds, 'wanted_location', lambda job: True),
                      mock.patch('src.role_kinds.of_search', side_effect=lambda search: set(aviation)),
                      mock.patch('src.places.countries', return_value=['Austria', 'Germany']),
                      mock.patch.object(found_boards.board_employers, 'note'), mock.patch.object(aggregators.board_employers, 'note'),
                      mock.patch.object(aggregators.board_employers, 'fill_missing'), mock.patch.dict('os.environ', {'JOBADABRA_FIXTURE_DIR': ''})):
            patch.start()
            self.addCleanup(patch.stop)
        board_web._early.clear()
        self.addCleanup(board_web._early.clear)
        found_boards._early.clear()
        self.addCleanup(found_boards._early.clear)
        FETCHED.clear()
        self.addCleanup(read_budget.short, False)
        self.addCleanup(time_budget.start, 0)
        time_budget.start(180)

    def no_search_thread_left(self):
        """No web search thread outlives its test (26 Oct 2026: one printed into test_desktop_tracker_commands' output on CI)."""
        for thread in [t for t in threading.enumerate() if t.name.startswith('board-web')]:
            thread.join(2)   # a worker ends just after its last answer
        left = [thread.name for thread in threading.enumerate() if thread.name.startswith('board-web') and thread.is_alive()]
        self.assertEqual(left, [], 'a web search thread outlived its test')

    def run_first(self, gate=None, release_after_show=False, wait=boards_first.WEB_WAIT, answer=None):
        """gate: the web search answers when it is set (release_after_show: as soon as the first boards are on screen; else when the run has left it).
        `shown` holds (seconds, jobs, whether the web search had already ANSWERED when they were shown: its answer given, not the gate opened)."""
        shown = []

        def on_jobs(jobs):
            shown.append((time.monotonic() - began, jobs, client.answered.is_set()))
            if release_after_show:
                gate.set()
        client = FakeClient(gate, answer)
        with mock.patch.object(board_web, '_searcher', return_value=client):
            began = time.monotonic()
            with redirect_stdout(io.StringIO()) as out:
                searching = board_web.early(SEARCH, fetch=fetch)
                matched = self.lane(on_jobs, wait=wait)
            if gate is not None:
                gate.set()   # a web search still searching answers now, inside this test
            with redirect_stdout(io.StringIO()):   # a web search still searching ends inside this test: its line never lands in another test's output
                searching.exception(timeout=10)
        return matched, shown, out.getvalue()

    def lane(self, on_jobs, wait=None):
        """The boards' lane of a run (Beside), taken to its end by the thread that owns the job cache: the jobs it kept."""
        from src.ai import batch_scope
        with batch_scope.concurrent():
            return boards_first.Beside(SEARCH, wait=wait).take(self.db, on_jobs)

    def test_first_officer_jobs_from_the_found_boards_are_on_screen_first(self):
        matched, shown, log = self.run_first()
        titles = [job['title'] for job in matched]
        self.assertTrue(any('First Officer' in title for title in titles), log)
        self.assertEqual(len(matched), 17, 'both board shapes read: 8 links by id, 6 cards; then crew-board\'s page 2 (3), its read gone on')
        self.assertTrue(shown and shown[0][0] < 60, 'on screen within 60 s')
        self.assertIn('Job boards first: reading the 3 the web search found, beside the employer sites', log)

    def test_enough_jobs_from_the_boards_keep_the_employer_read_to_its_best_sites(self):
        self.run_first()
        self.assertEqual(read_budget.deadline(now=50.0), 50.0, 'no employer site past the floor')

    def test_the_full_board_read_reads_their_next_pages_from_the_pages_fetched_first(self):
        """Page 1 first (on screen at once), the next pages beside the employer sites: the owner's pilot run read one board's 5 pages, each
        judged by the AI before the next, and showed its jobs at 163 s. The full read runs within the boards' 6-hour rest (since)."""
        matched, shown, _ = self.run_first()
        self.assertNotIn('First Officer A320 (m/w/d) 50', [job['title'] for job in shown[0][1]], 'page 2 is not read before the jobs are shown')
        self.assertIn('First Officer A320 (m/w/d) 50', [job['title'] for job in matched], 'then the lane\'s read goes on to it (ab, 14 Nov 2026)')
        page_one = [url for url in FETCHED if url.startswith('https://crew-board.test/jobs')]
        with mock.patch.object(board_web, 'start', return_value=None), redirect_stdout(io.StringIO()):
            jobs = found_boards.read(SEARCH, [{'name': h, 'host': h, 'search_url': f'https://{h}/jobs?q={{role}}'} for h in PAGES],
                                     fetch=fetch, dead=set(), since=datetime.now(timezone.utc) - timedelta(hours=6))
        self.assertIn('First Officer A320 (m/w/d) 50', [job['title'] for job in jobs], 'the full read reads page 2')
        self.assertEqual([url for url in FETCHED if url.startswith('https://crew-board.test/jobs')], page_one, 'no page the lane read is fetched again')

    def test_the_boards_that_worked_are_on_screen_before_the_web_search_answers(self):
        self.run_first()
        self.search_again()
        matched, shown, log = self.run_first(gate=threading.Event(), release_after_show=True, answer=BAD)
        self.assertTrue(shown and not shown[0][2], 'the boards that worked were shown only after the web search answered')
        self.assertIn('a web search found', log, 'the web search never answered inside the run: the boards that worked were not shown before it')
        self.assertLess(log.index('that gave you jobs in this field before'), log.index('a web search found'))

    def test_a_web_search_still_searching_is_left_to_the_full_read(self):
        matched, shown, log = self.run_first(gate=threading.Event(), wait=0.2)
        self.assertEqual(matched, [])
        self.assertIn('the web search is still searching', log)
        self.assertEqual(len(board_web._early), 1, 'the full read takes it')

    def test_no_web_search_this_run_and_no_working_board_reads_nothing_first(self):
        shown = []
        with redirect_stdout(io.StringIO()):
            self.assertEqual(self.lane(shown.append), [])
        self.assertEqual(shown, [])

    def search_again(self):
        """A later run: the web search is due again (its stamp gone) and the board scan's rest has passed."""
        data = json.loads((self.data / 'found_boards.json').read_text())
        data['web'] = {}
        data['boards']['itjobs.test'] = {'name': 'IT Jobs Moldova', 'search_url': 'https://itjobs.test/?q={role}', 'state': 'ok', 'relevant': 9,
                                         'countries': ['Moldova'], 'kinds': ['software_it'], 'paid_for': ['software_it']}   # an earlier search's board
        (self.data / 'found_boards.json').write_text(json.dumps(data))
        self.db.execute('DELETE FROM feed_jobs')
        time_budget.start(180)   # a new run: its own search clock (one web search per run, src/sources/board_web.py _run)

    def test_a_second_run_reads_the_boards_that_worked_when_its_web_search_finds_only_bad_ones(self):
        """The owner's 01:45 run (26 Oct 2026): the web search found 2 boards that give no job; the boards that list First Officer jobs were
        never read again. Fails on the old code: it read only what that run's web search found (0 jobs)."""
        self.run_first()
        self.search_again()
        matched, shown, log = self.run_first(answer=BAD)
        self.assertEqual(len(matched), 17, log)   # 14 first-page jobs, then crew-board's page 2 (its read goes on in the lane)
        self.assertTrue(shown and shown[0][0] < 60, 'on screen within 60 s')
        self.assertIn('that gave you jobs in this field before', log)
        self.assertNotIn('IT Jobs Moldova', log, "an earlier search's board is never read for this one (owner: in sync with the current search)")

    def test_without_a_web_search_the_boards_that_worked_are_read_first(self):
        self.run_first()
        self.search_again()
        board_web._early.clear()
        shown = []
        with redirect_stdout(io.StringIO()) as out:
            matched = self.lane(shown.append)
        self.assertEqual(len(matched), 17, out.getvalue())   # 14 first-page jobs, then crew-board's page 2 (its read goes on in the lane)
        self.assertTrue(shown)

    def test_a_repeat_run_reads_the_employer_sites_while_a_slow_board_is_read(self):
        """L36 · ps E2a-2 (owner, 8 Nov 2026: "Both: no waits + background (Recommended)", "the boards still start first"): run 42451932088, p7, one
        board read 55-165 s in front of the employer sites and 0 of 13 were read. The boards start first; the employer sites read while the web
        search is still answering (held by an event until the employer read has begun); their jobs are kept and shown in the thread that owns the job cache."""
        from src.ai import batch_scope
        from src.jobs_so_far import SoFar
        shown, at_sites, during, owner, gate = [], [], [], threading.get_ident(), threading.Event()

        class Shown(SoFar):   # the job cache: what the boards' jobs reach, in which thread
            def listener(self, where):
                return lambda jobs: shown.append((where, threading.get_ident(), len(jobs)))

        def employer_sites(sources, db, on_jobs, on_read):   # as feed_scan: on_jobs only for a site with sure jobs, on_read after every site
            at_sites.append(first.done.is_set())
            gate.set()   # the web search answers now: the boards can be read, while this read goes on
            for _ in range(200):   # sites with no sure job read one after another while the boards are read (10 s hang guard)
                if first.done.wait(0.05):
                    break
                on_read()
            on_read()   # the next site: the boards' jobs reach the list now, while the employer read still runs
            during.extend(shown)
            return {'jobs': [], 'sources': []}
        with mock.patch.object(board_web, '_searcher', return_value=FakeClient(gate, None)), redirect_stdout(io.StringIO()) as out:
            searching = board_web.early(SEARCH, fetch=fetch)
            with batch_scope.concurrent():
                first = boards_first.Beside(SEARCH)
                boards_ahead.scan_beside([], self.db, SEARCH, Shown(self.db), due=False, scan=employer_sites, first=first)
                matched = first.take(self.db, Shown(self.db).listener('job boards'))
            searching.exception(timeout=10)
        self.assertEqual(at_sites, [False], 'the employer sites were read while the boards were still being read')
        self.assertEqual(len(matched), 17, out.getvalue())   # 14 first-page jobs, then crew-board's page 2 (its read goes on in the lane, ab 14 Nov 2026)
        self.assertTrue(shown and all(thread == owner for _, thread, _ in shown), 'kept and shown in the thread that owns the job cache')
        self.assertEqual(sum(count for _, _, count in during), 17, 'shown during the employer read, though no employer site had a sure job')
        self.assertIn('Job boards first: reading the 3 the web search found, beside the employer sites', out.getvalue())
        self.assertEqual(read_budget.over(at=10**9, index=read_budget.READ_FLOOR, now=0.0), True,
                         'they gave enough: from now no employer site past the floor, though the read took its deadline before')

    def test_a_failure_keeping_the_boards_never_stops_the_employer_read(self):
        # Gitar on #3606: deliver runs inside the employer read (feeds.scan on_read); before, a failing board read before the slice only warned.
        with mock.patch('src.sources.board_reader._groups', return_value=iter([('the 1 that worked before', [{'name': 'Board'}])])), \
                mock.patch('src.sources.board_reader._fetch', return_value=[{'url': 'https://example.test/1', 'title': 'Nurse'}]), \
                mock.patch('src.sources.feeds.triage'), \
                mock.patch('src.sources.aggregators.kept', side_effect=sqlite3.OperationalError('database is locked')), \
                redirect_stdout(io.StringIO()) as out:
            first = boards_first.Beside(SEARCH)
            first.wait()
            first.deliver(self.db, lambda jobs: None)   # raises nothing: the employer read goes on
            self.assertEqual(first.take(self.db, lambda jobs: None), [])
        self.assertIn('Warning: job boards first skipped: OperationalError: database is locked', out.getvalue())

    def test_a_board_that_worked_for_another_field_is_not_read_first(self):
        self.run_first()
        self.search_again()
        board_web._early.clear()
        with mock.patch('src.role_kinds.of_search', return_value={'health_care'}), redirect_stdout(io.StringIO()):
            self.assertEqual(self.lane(lambda jobs: None), [])


if __name__ == '__main__':
    unittest.main()
