"""A job board read in the boards' lane goes on past its first-jobs slice: its other search words and its next result pages, while the lane has time.
Why (ab, 14 Nov 2026, c12 Graz electrician, runs 43531583871 / 43531603203 / 43531622998): the lane's slice read a board's first page for 2 words
and left the rest to the full board read (src/sources/boards_ahead.py), which starts after the lane, outside it, at the employer sites' read cut,
and so read nothing ("Time is up (1 min 07 s) for job boards: 1 board read waits for the next search" in all three). A board listing 107 jobs
gave the search the 15 of its first page, and the AI's 4 local words were never asked. The slice itself stays as it was (first jobs never later).
Example names and fake pages only."""
import io
import json
import tempfile
import threading
import time
import unittest
import urllib.error
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from src import time_budget
from src.ai import slots
from src.sources import board_pages, boards, boards_first, careers, found_boards, page_recipes, read_budget

BUDGET = 3   # the app's run, scaled (time_budget.part)
_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER

WORDS = ['fahrer', 'kraftfahrer', 'busfahrer', 'staplerfahrer']
SEARCH = {'jobs_board_search_queries': WORDS, 'role_keywords': ['fahrer'], 'locations': {'top_tier': ['Graz'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Stellen', 'host': 'stellen.example', 'search_url': 'https://stellen.example/jobs/{role}', 'countries': ['Austria'], 'kinds': ['any']}


def _page(word, number, more):
    """One result page of `word`: one driver job in Graz, with a rel=next link to the word's next page when `more`."""
    job = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': f'{word.title()} {number}', 'url': f'https://stellen.example/job/{word}-{number}',
           'hiringOrganization': {'@type': 'Organization', 'name': 'Spedition'},
           'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Graz', 'addressCountry': 'AT'}}}
    nav = f'<link rel="next" href="/jobs/{word}/{number + 1}">' if more else ''
    return f'<html><head>{nav}</head><body><script type="application/ld+json">{json.dumps(job)}</script></body></html>'


PAGES = {f'https://stellen.example/jobs/{word}' + ('' if n == 1 else f'/{n}'): _page(word, n, n < 3) for word in WORDS for n in (1, 2, 3)}


def relevant(jobs):   # the role and place judges, without the AI triage
    return [job for job in jobs if 'fahrer' in job['title'].lower()]


def inside_the_lane_with_time_left(after=None):
    """The clock 100 s into the app's 180 s: past the employer sites' read cut (90 s), before the run's end; the lane reads to that end.
    after(read_on, name): where a board hands its read-on (the lane's Beside.go_on); None: a lane that takes none."""
    time_budget.start(BUDGET, now=time.monotonic() - BUDGET * 100 / time_budget.PLANNED)
    return slots.in_lane(read_budget.run_end(), after)


class TheLaneGoesOn(unittest.TestCase):
    """read_board in the boards' lane: the slice, then its read-on handed to the lane (here run at once, as after the first-jobs step)."""
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.addCleanup(time_budget.start, 0)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={}),
                      mock.patch.object(board_pages, 'PAUSE_S', 0), mock.patch('src.sources.board_yield.is_relevant', relevant),
                      mock.patch.object(boards, 'board_queries', return_value=[])):
            patch.start()
            self.addCleanup(patch.stop)
        self.asked, self.rounds, self.more, self.handed = [], [], [], []

    def fetch(self, url):
        self.asked.append(url)
        if url not in PAGES:
            raise urllib.error.HTTPError(url, 404, 'Not Found', None, None)
        return PAGES[url]

    def go_on(self, read_on, name):
        """The lane, at once: the read-on runs now and its rounds and jobs are kept apart from the slice's."""
        self.handed.append(name)
        self.more.extend(read_on(self.rounds.append))

    def read(self, lane):
        told = lambda url: self.fetch(url)   # noqa: E731 — a fetch the search listens on (board_rounds.ended), as found_boards.read's
        told.on_round = self.rounds.append
        out = io.StringIO()
        with redirect_stdout(out), (inside_the_lane_with_time_left(self.go_on) if lane else mock.patch.object(time_budget, 'DEADLINE', None)):
            jobs, state, _ = found_boards.read_board(BOARD, SEARCH, fetch=told, early=True)
        return jobs, state, [url for url in self.asked if not url.endswith('robots.txt')], out.getvalue()

    def test_a_board_read_in_the_lane_with_time_left_asks_its_other_words_and_next_pages(self):
        jobs, state, asked, log = self.read(lane=True)
        self.assertEqual(state, 'ok')
        self.assertEqual(asked[:2], ['https://stellen.example/jobs/fahrer', 'https://stellen.example/jobs/kraftfahrer'],
                         'the slice first, as before: page 1 of its 2 words, before any next page or other word')
        self.assertEqual(sorted(asked), sorted(PAGES), 'then every word and its next pages, each page fetched once')
        self.assertEqual(len(jobs), 2, 'the board\'s own read ends with its slice (Gitar, #4200)')
        self.assertEqual(len({job['url'] for job in jobs + self.more}), len(PAGES), 'the read-on gives the rest, to the lane')
        self.assertEqual([job['url'] for job in self.rounds[0]], ['https://stellen.example/job/fahrer-1'], 'the first round is handed with its first page only')
        self.assertIn('Job boards: Stellen: first jobs handed; its other words and next pages are read after the first-jobs step', log)
        self.assertIn("round 'busfahrer': 1 job(s) on the page (3 with its next pages)", log, 'a word asked by the read-on is paged')

    def test_outside_a_lane_the_slice_reads_page_one_of_two_words_and_says_why_not_more(self):
        jobs, _, asked, log = self.read(lane=False)
        self.assertEqual(asked, ['https://stellen.example/jobs/fahrer', 'https://stellen.example/jobs/kraftfahrer'])
        self.assertEqual((len(jobs), self.handed), (2, []))
        self.assertIn('next pages and other words not asked (the first jobs\' read, outside the boards\' lane)', log)

    def test_the_lane_at_its_end_does_not_go_on_and_says_so(self):
        with mock.patch.object(read_budget, 'past_cut', return_value=True):
            jobs, _, asked, log = self.read(lane=True)
        self.assertEqual((len(asked), len(jobs), self.handed), (2, 2, []))
        self.assertIn('next pages and other words not asked (time is up)', log)

    def test_a_round_whose_page_links_no_next_page_says_so(self):
        """c12 Graz's board: a scripted "load more" button and no link to page 2; its round line said nothing about the next pages."""
        pages = {url: page.replace('rel="next"', 'rel="nofollow"') for url, page in PAGES.items()}
        with mock.patch.dict(PAGES, pages), redirect_stdout(io.StringIO()) as out:
            found_boards.read_board(BOARD, {**SEARCH, 'jobs_board_search_queries': WORDS[:1]}, fetch=self.fetch)
        self.assertIn("round 'fahrer': 1 job(s) on the page, 1 new, next pages: none linked on the page", out.getvalue())


class TheLaneReadsOnAfterTheFirstJobsStep(unittest.TestCase):
    """A real boards' lane (boards_first.Beside) whose listed board is read by read_board. Why (sa, 14 Nov 2026, pairs 1-2 of #4180: c12's
    first-jobs step closed at 71 s against 46 s, a 6-title batch waiting 21 s behind read-on calls already in a slot; Gitar, #4200: a read-on
    inside the board's read held a board worker and the board's keep): the board's read ends with its slice; the lane reads on after the step."""
    setUp, fetch = TheLaneGoesOn.setUp, TheLaneGoesOn.fetch

    def lane(self, read_on=None):
        """A first run's lane with one listed board (Stellen) and no known board; returns (lane, the slice's read_board results)."""
        for patch in (mock.patch('src.sources.board_reader.read', return_value=iter(())), mock.patch('src.sources.feeds.triage')):
            patch.start()
            self.addCleanup(patch.stop)
        if read_on is not None:
            real = found_boards._read
            patch = mock.patch.object(found_boards, '_read', side_effect=lambda board, search, fetch, route, early, *rest:
                                      real(board, search, fetch, route, early, *rest) if early else read_on())
            patch.start()
            self.addCleanup(patch.stop)
        sliced = []

        def listed(on_board):   # the first-jobs step's board list: read_board's slice, kept by on_board as found_boards.read keeps it
            told = lambda url: self.fetch(url)   # noqa: E731
            told.on_round = None
            jobs = found_boards.read_board(BOARD, SEARCH, fetch=told, early=True)[0]
            sliced.append(([job['url'] for job in jobs], list(self.asked)))
            on_board(jobs)
            return jobs
        time_budget.start(BUDGET, now=time.monotonic() - BUDGET * 100 / time_budget.PLANNED)
        return boards_first.Beside(SEARCH, listed=listed), sliced

    def until(self, state):
        for _ in range(5000):   # a state, never a fixed time (hang guard: 5 s)
            if state():
                return True
            time.sleep(0.001)
        return False

    def test_the_boards_read_ends_with_its_slice_and_the_lane_reads_on_after_the_step(self):
        with redirect_stdout(io.StringIO()):
            lane, sliced = self.lane()
            self.assertTrue(self.until(lambda: sliced and lane.left == 1), 'the slice ended; its read-on waits in the lane')
            self.assertEqual(sliced[0], (['https://stellen.example/job/fahrer-1', 'https://stellen.example/job/kraftfahrer-1'],
                                         ['https://stellen.example/jobs/fahrer', 'https://stellen.example/jobs/kraftfahrer']),
                             'read_board returned its slice (the board is kept, its worker free) with no read-on page fetched')
            self.assertEqual(len(self.asked), 2, 'nothing more is fetched while the first-jobs step runs')
            self.assertFalse(lane.done.is_set(), 'the lane stays open for its read-on')
            lane.step_ended.set()
            self.assertTrue(lane.done.wait(5))
        self.assertEqual(sorted(set(self.asked)), sorted(PAGES), 'after the step: every word and its next pages')
        self.assertEqual(lane.urls, {f'https://stellen.example/job/{word}-{n}' for word in WORDS for n in (1, 2, 3)}, 'every job handed to the lane once')
        lane.order = ['https://stellen.example/job/kraftfahrer-1']   # a group's list order, as a known board's group gives it
        came = [{'url': url} for url in ('https://stellen.example/job/busfahrer-2', 'https://stellen.example/job/fahrer-3', 'https://stellen.example/job/kraftfahrer-1')]
        self.assertEqual([job['url'] for job in lane._in_list_order(came)],
                         ['https://stellen.example/job/kraftfahrer-1', 'https://stellen.example/job/busfahrer-2', 'https://stellen.example/job/fahrer-3'],
                         "a group's jobs in its list order first; read-on jobs (in no group) after them, in the order they came (Gitar, #4215)")

    def test_the_steps_last_title_batch_is_not_behind_a_read_on_call(self):
        one, served, release = slots.Slots(1), [], threading.Event()

        def read_on_holds_a_slot():   # a read-on AI call (a link question) that keeps its slot a while
            with one:
                served.append(('read on', slots.level()))
                release.wait(5)   # hang guard only
            return [], 'ok', None
        with redirect_stdout(io.StringIO()):
            lane, sliced = self.lane(read_on_holds_a_slot)
            self.assertTrue(self.until(lambda: sliced and lane.left == 1))
            with slots.priority(slots.TITLES), one:   # the step's last title batch, the read-on waiting for the step
                served.append(('title batch', slots.level()))
            lane.step_ended.set()
            self.assertTrue(self.until(lambda: len(served) == 2))
            release.set()
            self.assertTrue(lane.done.wait(5))
        self.assertEqual(served, [('title batch', slots.TITLES), ('read on', slots.NORMAL)],
                         'the title batch took the slot at once; the read-on came after, at the known boards\' level, not the slice\'s FIRST')

    def test_a_failure_on_the_way_on_keeps_the_slices_jobs_and_says_so(self):
        def failing():
            raise RuntimeError('a page the layout could not read')
        with redirect_stdout(io.StringIO()) as out:   # the whole process's output: the lane's threads print after the step
            lane, sliced = self.lane(failing)
            self.assertTrue(self.until(lambda: sliced and lane.left == 1))
            lane.step_ended.set()
            self.assertTrue(lane.done.wait(5))
        self.assertEqual(lane.urls, {'https://stellen.example/job/fahrer-1', 'https://stellen.example/job/kraftfahrer-1'})
        self.assertIn('Warning: Stellen: its read did not go on: RuntimeError: a page the layout could not read', out.getvalue())

    def test_a_lane_whose_end_comes_first_reads_nothing_more_and_says_so(self):
        with redirect_stdout(io.StringIO()) as out:
            lane, sliced = self.lane()
            self.assertTrue(self.until(lambda: sliced and lane.left == 1))
            with mock.patch.object(read_budget, 'past_cut', return_value=True):
                lane.step_ended.set()
                self.assertTrue(lane.done.wait(5))
        self.assertEqual(len(self.asked), 2)
        self.assertIn('Job boards: Stellen: next pages and other words not asked (time is up)', out.getvalue())


class TheLaneThatHasEnded(unittest.TestCase):
    def test_a_read_on_handed_after_the_lanes_end_says_it_is_not_read(self):
        """Gitar, #4210: read_board says the read-on comes after the step; a lane already ended dropped it without a word."""
        with mock.patch('src.sources.board_reader.read', return_value=iter(())), mock.patch('src.sources.feeds.triage'), \
                redirect_stdout(io.StringIO()) as out:
            time_budget.start(BUDGET, now=time.monotonic() - BUDGET * 100 / time_budget.PLANNED)
            self.addCleanup(time_budget.start, 0)
            lane = boards_first.Beside(SEARCH)
            self.assertTrue(lane.done.wait(5))
            asked = []
            lane.go_on(lambda on_round: asked.append('read') or [], 'Stellen')
        self.assertEqual(asked, [])
        self.assertIn("Job boards: Stellen: next pages and other words not asked (the boards' lane has ended)", out.getvalue())


class TheReadOnIsTheLanesReader(TheLaneReadsOnAfterTheFirstJobsStep):
    """Gitar, #4208: the read-on's thread judged its titles and places outside the lane's reader (batch_scope), and queued its groups with no views."""
    def test_the_read_ons_groups_carry_the_lanes_views(self):
        from src.ai import batch_scope
        with redirect_stdout(io.StringIO()), batch_scope.concurrent():
            lane, sliced = self.lane()
            self.assertTrue(self.until(lambda: sliced and lane.left == 1))
            lane.step_ended.set()
            self.assertTrue(lane.done.wait(5))
        groups = []
        while not lane.groups.empty():
            groups.append(lane.groups.get_nowait())
        self.assertGreater(len(groups), 1, 'positive control: the slice\'s group and the read-on\'s')
        self.assertEqual([views is None for _, views in groups], [False] * len(groups), 'every group carries the lane reader\'s views')

    test_the_boards_read_ends_with_its_slice_and_the_lane_reads_on_after_the_step = None   # the parent's own tests run once, in their class
    test_the_steps_last_title_batch_is_not_behind_a_read_on_call = None
    test_a_failure_on_the_way_on_keeps_the_slices_jobs_and_says_so = None
    test_a_lane_whose_end_comes_first_reads_nothing_more_and_says_so = None


class OnePageOneFetch(unittest.TestCase):
    def test_a_read_cut_short_is_not_asked_again_in_the_same_board_read(self):
        """Gitar, #4208: board_pages.once kept only URLError/OSError/ValueError; a page cut short (http.client.IncompleteRead) was asked again."""
        import http.client
        asked = []

        def fetch(url):
            asked.append(url)
            raise http.client.IncompleteRead(b'<html>')
        again = board_pages.once(fetch)
        for _ in range(2):
            with self.assertRaises(http.client.IncompleteRead):
                again('https://stellen.example/jobs/fahrer')
        self.assertEqual(asked, ['https://stellen.example/jobs/fahrer'])


class TheSearchEndsTheStepForTheLane(unittest.TestCase):
    def test_a_first_press_lets_its_lane_go_on_after_the_first_jobs_step_whatever_its_end(self):
        """The wait above ends only if the search ends it: after first_jobs.run, outside its try, so a failed step lets the lane go on too
        (the form of test_first_press_order's L10 check: the search's own order, read from its source)."""
        source = (Path(__file__).resolve().parents[3] / 'src' / 'daily_search.py').read_text()
        body = source[source.index('def search('):]
        step, failed, ended = body.index('first_jobs.run('), body.index("Warning: first jobs skipped"), body.index('first.step_ended.set()')
        self.assertLess(failed, ended, 'after the step and after its failure')
        self.assertLess(step, ended)
        self.assertIn('finally:', body[failed:ended], 'in the step\'s finally: however it ends, a BaseException too (Gitar, #4215)')


class TheAiReaderOncePerPage(unittest.TestCase):
    """Gitar on #4180: the read that goes on asks the slice's words again (to page them); the AI page reader must not read the same page twice."""
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.addCleanup(time_budget.start, 0)
        self.addCleanup(setattr, careers, 'READER', careers.READER)
        careers.READER, self.asked = 'auto', []
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={}),
                      mock.patch.object(board_pages, 'PAUSE_S', 0), mock.patch('src.sources.board_yield.is_relevant', relevant),
                      mock.patch.object(boards, 'board_queries', return_value=[]), mock.patch.object(careers, 'RENDER', None),
                      mock.patch.object(careers, 'reader', return_value=lambda url, markup, **kw: self.asked.append(url) or []),
                      mock.patch.object(page_recipes, 'load', return_value=None), mock.patch.object(page_recipes, 'save'),
                      mock.patch.object(page_recipes, 'mark_broken')):
            patch.start()
            self.addCleanup(patch.stop)

    def test_a_page_the_ai_read_in_the_slice_is_not_read_by_the_ai_again(self):
        prose = '<html><body>' + '<p>Finden Sie Stellen in Ihrer Region und bewerben Sie sich bei den besten Arbeitgebern.</p>' * 20 + '</body></html>'
        pages = {'https://stellen.example/jobs/fahrer': prose, 'https://stellen.example/jobs/kraftfahrer': _page('kraftfahrer', 1, False)}
        went_on = []
        with redirect_stdout(io.StringIO()), inside_the_lane_with_time_left(lambda read_on, name: went_on.append(read_on(None))):
            jobs, state, _ = found_boards.read_board(BOARD, {**SEARCH, 'jobs_board_search_queries': WORDS[:2]}, fetch=lambda url: pages.get(url, ''), early=True)
        self.assertEqual((state, len(jobs), len(went_on)), ('ok', 1, 1), 'positive control: the read went on (in the lane)')
        self.assertEqual(self.asked, ['https://stellen.example/jobs/fahrer'], 'one AI read of that page in the whole board read')


if __name__ == '__main__':
    unittest.main()
