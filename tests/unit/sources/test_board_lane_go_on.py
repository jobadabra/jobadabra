"""A job board read in the boards' lane goes on past its first-jobs slice: its other search words and its next result pages, while the lane has time.
Why (ab, 14 Nov 2026, c12 Graz electrician, runs 43531583871 / 43531603203 / 43531622998): the lane's slice read a board's first page for 2 words
and left the rest to the full board read (src/sources/boards_ahead.py), which starts after the lane, outside it, at the employer sites' read cut,
and so read nothing ("Time is up (1 min 07 s) for job boards: 1 board read waits for the next search" in all three). A board listing 107 jobs
gave the search the 15 of its first page, and the AI's 4 local words were never asked. The slice itself stays as it was (first jobs never later).
Example names and fake pages only."""
import io
import json
import tempfile
import time
import unittest
import urllib.error
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from src import time_budget
from src.ai import slots
from src.sources import board_pages, boards, careers, found_boards, read_budget

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

        def failing_on(board, search, fetch, route, early, show=None):   # the slice reads as usual; the read that goes on fails
            if not early:
                raise RuntimeError('a page the layout could not read')
            return real(board, search, fetch, route, early, show)
        with mock.patch.object(found_boards, '_read', side_effect=failing_on):
            jobs, state, asked, log = self.read(lane=True)
        self.assertEqual((len(jobs), state, len(asked)), (2, 'ok', 2))
        self.assertIn('Warning: Stellen: its read did not go on: RuntimeError: a page the layout could not read', log)

    def test_a_round_whose_page_links_no_next_page_says_so(self):
        """c12 Graz's board: a scripted "load more" button and no link to page 2; its round line said nothing about the next pages."""
        pages = {url: page.replace('rel="next"', 'rel="nofollow"') for url, page in PAGES.items()}
        with mock.patch.dict(PAGES, pages), redirect_stdout(io.StringIO()) as out:
            found_boards.read_board(BOARD, {**SEARCH, 'jobs_board_search_queries': WORDS[:1]}, fetch=self.fetch)
        self.assertIn("round 'fahrer': 1 job(s) on the page, 1 new, next pages: none linked on the page", out.getvalue())


if __name__ == '__main__':
    unittest.main()
