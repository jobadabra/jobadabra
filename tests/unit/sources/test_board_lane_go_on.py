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
from src.sources import board_pages, boards, careers, found_boards, page_recipes, read_budget

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


def inside_the_lane_with_time_left():
    """The clock 100 s into the app's 180 s: past the employer sites' read cut (90 s), before the run's end; the lane reads to that end."""
    time_budget.start(BUDGET, now=time.monotonic() - BUDGET * 100 / time_budget.PLANNED)
    return slots.in_lane(read_budget.run_end())


class TheLaneGoesOn(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.addCleanup(time_budget.start, 0)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={}),
                      mock.patch.object(board_pages, 'PAUSE_S', 0), mock.patch('src.sources.board_yield.is_relevant', relevant),
                      mock.patch.object(boards, 'board_queries', return_value=[])):
            patch.start()
            self.addCleanup(patch.stop)
        self.asked, self.rounds = [], []

    def fetch(self, url):
        self.asked.append(url)
        if url not in PAGES:
            raise urllib.error.HTTPError(url, 404, 'Not Found', None, None)
        return PAGES[url]

    def read(self, lane):
        told = lambda url: self.fetch(url)   # noqa: E731 — a fetch the search listens on (board_rounds.ended), as found_boards.read's
        told.on_round = self.rounds.append
        out = io.StringIO()
        with redirect_stdout(out), (inside_the_lane_with_time_left() if lane else mock.patch.object(time_budget, 'DEADLINE', None)):
            jobs, state, _ = found_boards.read_board(BOARD, SEARCH, fetch=told, early=True)
        return jobs, state, [url for url in self.asked if not url.endswith('robots.txt')], out.getvalue()

    def test_a_board_read_in_the_lane_with_time_left_asks_its_other_words_and_next_pages(self):
        jobs, state, asked, log = self.read(lane=True)
        self.assertEqual(state, 'ok')
        self.assertEqual(asked[:2], ['https://stellen.example/jobs/fahrer', 'https://stellen.example/jobs/kraftfahrer'],
                         'the slice first, as before: page 1 of its 2 words, before any next page or other word')
        self.assertEqual(sorted(asked), sorted(PAGES), 'then every word and its next pages, each page fetched once')
        self.assertEqual(len(jobs), len(PAGES))
        self.assertEqual([job['url'] for job in self.rounds[0]], ['https://stellen.example/job/fahrer-1'], 'the first round is handed with its first page only')
        self.assertIn('Job boards: Stellen: first jobs handed; the read goes on with its other words and next pages', log)
        self.assertIn("round 'busfahrer': 1 job(s) on the page (3 with its next pages)", log, 'a word asked by the read that goes on is paged')

    def test_outside_a_lane_the_slice_reads_page_one_of_two_words_and_says_why_not_more(self):
        jobs, _, asked, log = self.read(lane=False)
        self.assertEqual(asked, ['https://stellen.example/jobs/fahrer', 'https://stellen.example/jobs/kraftfahrer'])
        self.assertEqual(len(jobs), 2)
        self.assertIn('next pages and other words not asked (the first jobs\' read, outside the boards\' lane)', log)

    def test_the_lane_at_its_end_does_not_go_on_and_says_so(self):
        with mock.patch.object(read_budget, 'past_cut', return_value=True):
            jobs, _, asked, log = self.read(lane=True)
        self.assertEqual(len(asked), 2)
        self.assertEqual(len(jobs), 2)
        self.assertIn('next pages and other words not asked (time is up)', log)

    def test_a_failure_on_the_way_on_keeps_the_slices_jobs_and_says_so(self):
        real = found_boards._read

        def failing_on(board, search, fetch, route, early, *rest):   # the slice reads as usual; the read that goes on fails
            if not early:
                raise RuntimeError('a page the layout could not read')
            return real(board, search, fetch, route, early, *rest)
        with mock.patch.object(found_boards, '_read', side_effect=failing_on):
            jobs, state, asked, log = self.read(lane=True)
        self.assertEqual((len(jobs), state, len(asked)), (2, 'ok', 2))
        self.assertIn('Warning: Stellen: its read did not go on: RuntimeError: a page the layout could not read', log)

    def test_the_read_on_queues_behind_the_first_jobs_title_sorting(self):
        """sa, 14 Nov 2026, from pair 1 of #4180 (d01: the first-jobs step closed at 129 s against 81 s): the read that goes on is background
        work; its AI calls queue at the lane's later level (NORMAL, as the known boards' read), never at the slice boards' FIRST, so with one
        slot busy a title batch asked together with a read-on link question is served first."""
        levels = {}

        def fetch(url):
            levels[url] = slots.level()   # the level this thread's AI calls (link questions, the page reader) queue at
            return self.fetch(url)
        fetch.on_round = None
        with slots.priority(slots.FIRST), redirect_stdout(io.StringIO()), inside_the_lane_with_time_left():
            found_boards.read_board(BOARD, SEARCH, fetch=fetch, early=True)
        self.assertEqual(levels['https://stellen.example/jobs/fahrer'], slots.FIRST, 'the slice keeps its level')
        read_on = levels['https://stellen.example/jobs/busfahrer']
        self.assertEqual(read_on, slots.NORMAL)
        one, served = slots.Slots(1), []

        def ask(name, at):
            with slots.priority(at), one:
                served.append(name)
        with one:   # the one slot busy; the read-on call asks first, the title batch after it
            waiting = []
            for name, at in (('read on', read_on), ('title batch', slots.TITLES)):
                waiting.append(threading.Thread(target=ask, args=(name, at)))
                waiting[-1].start()
                while one.waiting() < len(waiting):   # wait for the state (both queued), never a fixed time
                    time.sleep(0.001)
        for thread in waiting:
            thread.join(5)
        self.assertEqual(served, ['title batch', 'read on'])

    def test_a_round_whose_page_links_no_next_page_says_so(self):
        """c12 Graz's board: a scripted "load more" button and no link to page 2; its round line said nothing about the next pages."""
        pages = {url: page.replace('rel="next"', 'rel="nofollow"') for url, page in PAGES.items()}
        with mock.patch.dict(PAGES, pages), redirect_stdout(io.StringIO()) as out:
            found_boards.read_board(BOARD, {**SEARCH, 'jobs_board_search_queries': WORDS[:1]}, fetch=self.fetch)
        self.assertIn("round 'fahrer': 1 job(s) on the page, 1 new, next pages: none linked on the page", out.getvalue())


class TheReadOnWaitsForTheFirstJobsStep(unittest.TestCase):
    """sa, 14 Nov 2026, from pair 2 of #4180 (c12: the first-jobs step closed at 71 s against 46 s on main; a 6-title batch asked at 49 s was
    answered at 70 s, at 6 s on main): a read-on call already in an AI slot keeps it, whatever the level. In a first run the read that goes on
    starts only when the first-jobs step has ended (boards_first.Beside.step_ended), so the step's AI calls never wait behind one."""
    setUp, fetch = TheLaneGoesOn.setUp, TheLaneGoesOn.fetch

    def start(self, after):
        """read_board in its own thread, in a lane whose boards go on past their first jobs only through `after`."""
        told = lambda url: self.fetch(url)   # noqa: E731 — a fetch the search listens on, as in TheLaneGoesOn.read
        told.on_round, out = self.rounds.append, {}

        def read():
            with redirect_stdout(io.StringIO()):
                out['jobs'] = found_boards.read_board(BOARD, SEARCH, fetch=told, early=True)[0]
        time_budget.start(BUDGET, now=time.monotonic() - BUDGET * 100 / time_budget.PLANNED)
        with slots.in_lane(read_budget.run_end(), after):
            thread = threading.Thread(target=slots.carry(read))
        thread.start()
        return thread, out

    def test_no_page_of_the_read_on_is_fetched_before_the_first_jobs_step_ends(self):
        step_ended, waiting = threading.Event(), threading.Event()

        def after(seconds):
            waiting.set()
            return step_ended.wait(seconds)
        thread, out = self.start(after)
        self.assertTrue(waiting.wait(5), 'the read reached the wait for the step')   # hang guard only
        self.assertEqual(self.asked, ['https://stellen.example/jobs/fahrer', 'https://stellen.example/jobs/kraftfahrer'],
                         'while the step runs: the slice\'s 2 pages only')
        self.assertEqual(len(self.rounds), 2, 'the slice\'s jobs were handed before the wait')
        step_ended.set()
        thread.join(5)
        self.assertEqual(sorted(set(self.asked)), sorted(PAGES), 'after it: every word and its next pages')
        self.assertEqual(len(out['jobs']), len(PAGES))

    def test_the_steps_last_title_batch_is_not_behind_a_read_on_call(self):
        one, served, step_ended, release, waiting = slots.Slots(1), [], threading.Event(), threading.Event(), threading.Event()
        real = found_boards._read

        def read_on_holds_a_slot(board, search, fetch, route, early, *rest):   # a read-on AI call (a link question) that keeps its slot a while
            if early:
                return real(board, search, fetch, route, early, *rest)
            with one:
                served.append('read on')
                release.wait(5)   # hang guard only
            return [], 'ok', None

        def title_batch():
            with slots.priority(slots.TITLES), one:
                served.append('title batch')
        with mock.patch.object(found_boards, '_read', side_effect=read_on_holds_a_slot):
            thread, _ = self.start(lambda seconds: waiting.set() or step_ended.wait(seconds))
            for _ in range(5000):   # until the read waits for the step, or (without that wait) a read-on call holds the slot: a state, never a fixed time
                if waiting.is_set() or served:
                    break
                time.sleep(0.001)
            batch = threading.Thread(target=title_batch)
            batch.start()
            batch.join(2)   # hang guard: behind a read-on call it would wait for `release`
            self.assertEqual(served, ['title batch'], 'the step\'s title batch took the slot at once; no read-on call held it')
            step_ended.set()
            release.set()
            thread.join(5)
        self.assertEqual(served, ['title batch', 'read on'])


class TheSearchEndsTheStepForTheLane(unittest.TestCase):
    def test_a_first_press_lets_its_lane_go_on_after_the_first_jobs_step_whatever_its_end(self):
        """The wait above ends only if the search ends it: after first_jobs.run, outside its try, so a failed step lets the lane go on too
        (the form of test_first_press_order's L10 check: the search's own order, read from its source)."""
        source = (Path(__file__).resolve().parents[3] / 'src' / 'daily_search.py').read_text()
        body = source[source.index('def search('):]
        step, failed, ended = body.index('first_jobs.run('), body.index("Warning: first jobs skipped"), body.index('first.step_ended.set()')
        self.assertLess(failed, ended, 'after the step and after its failure')
        self.assertLess(step, ended)


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
        with redirect_stdout(io.StringIO()) as out, inside_the_lane_with_time_left():
            jobs, state, _ = found_boards.read_board(BOARD, {**SEARCH, 'jobs_board_search_queries': WORDS[:2]}, fetch=lambda url: pages.get(url, ''), early=True)
        self.assertEqual((state, len(jobs)), ('ok', 1))
        self.assertIn('the read goes on', out.getvalue(), 'positive control: the read went on')
        self.assertEqual(self.asked, ['https://stellen.example/jobs/fahrer'], 'one AI read of that page in the whole board read')


if __name__ == '__main__':
    unittest.main()
