"""A job board's layout, learned once by board discovery and served in its board fact, is replayed before any AI question about its links
(src/sources/board_layout.py). Why (13 Nov 2026, owner: "shouldn't the central scout and board discovery do that... spend those 60-90s ?"): a first
search spent 61-88 s a board page on "job links", one AI question per link wording (src/ai/page_words.py link_words), on boards discovery had measured."""
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src.ai import board_ideas, page_words  # noqa: E402
from src.sources import careers, found_boards  # noqa: E402

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'jobs_board_search_queries': ['developer'], 'role_keywords': ['developer'],
          'locations': {'top_tier': ['Lisboa'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Jobs Example', 'host': 'jobs.example', 'search_url': 'https://jobs.example/search?q={role}', 'countries': ['Portugal'], 'kinds': ['any']}
MENU = '<a href="/about">About us</a><a href="/blog/news">News</a><a href="/employers">For employers</a>'
FOOTER = '<footer><p>' + 'Jobs Example lists open positions from employers across the country, updated every day. ' * 12 + '</p></footer>'   # a real page's text: under 800 characters a page reads as a script shell (careers._shell)


def _list(ids, more=False):
    cards = ''.join(f'<div class="card"><a href="/job/{n}">Python Developer {n}</a></div>' for n in ids)
    return f'<html><body>{MENU}{cards}' + ('<a rel="next" href="/search?q=developer&page=2">Next</a>' if more else '') + f'{FOOTER}</body></html>'


def _posting(n):
    job = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': f'Python Developer {n}', 'url': f'https://jobs.example/job/{n}',
           'hiringOrganization': {'@type': 'Organization', 'name': 'Acme Lda'},
           'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Lisboa', 'addressCountry': 'PT'}}, 'datePosted': '2026-11-13'}
    return f'<html><script type="application/ld+json">{json.dumps(job)}</script><body>x</body></html>'


def fetch(url):
    if '/job/' in url:
        return _posting(url.rsplit('/', 1)[1])
    return _list([201, 202, 203]) if 'page=2' in url else _list([101, 102, 103, 104], more=True)


class BoardLayoutTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.folder = Path(tmp.name)
        for patch in (mock.patch('src.paths.DATA', self.folder), mock.patch('src.places.load', return_value={}),
                      mock.patch('src.sources.board_yield.is_relevant', side_effect=list)):   # every job wanted: the next page is read (relevance is not what this tests)
            patch.start()
            self.addCleanup(patch.stop)
        self.asked = []

        def link_words(pairs, floor=None):   # the AI's verdict on each link, recorded: what this change saves
            pairs = list(pairs)
            self.asked.extend(pairs)
            return {(str(t), str(p)): page_words.Words(False, False, False, str(p).startswith(('/job/', '/vacancy/'))) for t, p in pairs}
        patch = mock.patch.object(page_words, 'link_words', side_effect=link_words)
        patch.start()
        self.addCleanup(patch.stop)

    def test_a_board_with_a_served_layout_is_read_with_no_link_question_on_its_first_and_next_page(self):
        jobs, state, _ = found_boards.read_board({**BOARD, 'layout': {'kind': 'links', 'prefix': '/job'}}, SEARCH, fetch=fetch)
        self.assertEqual(self.asked, [], 'the layout chose the job cards: no AI question about any link')
        self.assertEqual((state, sorted(job['url'].rsplit('/', 1)[1] for job in jobs)), ('ok', ['101', '102', '103', '104', '201', '202', '203']),
                         'page 1 and the next page, each job read from its own page')
        self.assertEqual({job['company'] for job in jobs}, {'Acme Lda'}, "the job page's own data, as the usual read gives")

    def test_without_a_layout_the_same_board_asks_the_ai_about_its_links(self):
        """The control: the same pages without a served layout cost link questions (what 13 Nov's run paid on every board)."""
        jobs, _, _ = found_boards.read_board(BOARD, SEARCH, fetch=fetch)
        self.assertTrue(self.asked)
        self.assertEqual(len(jobs), 7)

    def test_a_layout_that_reads_nothing_falls_back_to_the_usual_read_with_one_line(self):
        out = io.StringIO()
        with redirect_stdout(out):
            jobs, state, _ = found_boards.read_board({**BOARD, 'layout': {'kind': 'links', 'prefix': '/vacancy'}}, SEARCH, fetch=fetch)
        self.assertEqual((state, len(jobs)), ('ok', 7), 'the page is read the usual way')
        self.assertTrue(self.asked, 'the link questions are back for this read')
        said = [line for line in out.getvalue().splitlines() if 'layout' in line]
        self.assertEqual(len(said), 1, f'one line for the read, not one per page: {said}')
        self.assertIn('jobs.example', said[0])

    def _said(self, board, fetch_page, search=SEARCH):
        out = io.StringIO()
        with redirect_stdout(out):
            jobs, state, _ = found_boards.read_board(board, search, fetch=fetch_page)
        return jobs, state, [line for line in out.getvalue().splitlines() if 'layout' in line]

    def test_a_layout_that_holds_on_page_one_and_fails_on_the_next_page_is_dropped_there_only(self):
        """Gitar on #3982: page 1 read by the layout, the next page (other cards) by the usual read through the round's own fetch."""
        def moved(url):
            if 'page=2' in url:
                return f'<html><body>{MENU}' + ''.join(f'<a href="/vacancy/{n}">Python Developer {n}</a>' for n in (201, 202)) + f'{FOOTER}</body></html>'
            return _posting(url.rsplit('/', 1)[1]) if '/vacancy/' in url else fetch(url)
        jobs, state, said = self._said({**BOARD, 'layout': {'kind': 'links', 'prefix': '/job'}}, moved)
        self.assertEqual(len(said), 1, said)
        self.assertFalse([path for _, path in self.asked if path.startswith('/job/')], 'page 1 asked nothing: the layout read it')
        self.assertTrue([path for _, path in self.asked if path.startswith('/vacancy/')], 'the next page was read the usual way')
        self.assertEqual(len(jobs), 6)

    def test_an_empty_results_page_keeps_the_layout_for_the_next_search(self):
        """Gitar on #3982: the first words found nothing on the board; their empty page must not cost the layout for the next words."""
        search = {**SEARCH, 'jobs_board_search_queries': ['nothing', 'developer']}
        empty = lambda url: f'<html><body>{MENU}<p>No jobs match your search.</p>{FOOTER}</body></html>' if 'q=nothing' in url else fetch(url)
        jobs, _, said = self._said({**BOARD, 'layout': {'kind': 'links', 'prefix': '/job'}}, empty, search)
        self.assertEqual(said, [])
        self.assertFalse([path for _, path in self.asked if path.startswith('/job/')], 'the next words were still read by the layout')
        self.assertEqual(len(jobs), 7)

    def test_job_pages_that_fail_never_cost_the_layout(self):
        """Gitar on #3982: the layout found the cards; job pages that fail are those pages' failure (a refusal, a timeout)."""
        search = {**SEARCH, 'jobs_board_search_queries': ['broken', 'developer']}

        def failing(url):
            if 'q=broken' in url:
                return _list([301, 302, 303])
            if '/job/3' in url:
                raise OSError('timed out')
            return fetch(url)
        jobs, _, said = self._said({**BOARD, 'layout': {'kind': 'links', 'prefix': '/job'}}, failing, search)
        self.assertEqual(said, [])
        self.assertFalse([path for _, path in self.asked if path.startswith('/job/')])
        self.assertEqual(len(jobs), 7)

    def test_a_layout_of_titles_with_no_link_reads_the_listing_itself(self):
        page = f'<html><body>{MENU}' + ''.join(f'<h3 class="job-title">Python Developer {n}</h3>' for n in (1, 2, 3)) + f'{FOOTER}</body></html>'
        jobs, state, said = self._said({**BOARD, 'layout': {'kind': 'tag', 'tag': 'h3', 'class': 'job-title'}}, lambda url: page)
        self.assertEqual((self.asked, said), ([], []))
        self.assertEqual(sorted(job['title'] for job in jobs), ['Python Developer 1', 'Python Developer 2', 'Python Developer 3'])

    def test_a_layout_rides_from_the_index_to_the_served_board_only_in_its_fixed_shape(self):
        sites = [{'host': 'laid.example', 'kind': 'board', 'url': 'https://laid.example/?q={role}', 'installs': 1,
                  'recipe': {'countries': ['pt'], 'layout': {'kind': 'links', 'prefix': '/job'}}},
                 {'host': 'odd.example', 'kind': 'board', 'url': 'https://odd.example/?q={role}', 'installs': 1,
                  'recipe': {'countries': ['pt'], 'layout': {'kind': 'links', 'prefix': '/job/(.*)'}}},
                 {'host': 'plain.example', 'kind': 'board', 'url': 'https://plain.example/?q={role}', 'installs': 1, 'recipe': {'countries': ['pt']}}]
        from src import employer_index
        cache = self.folder / 'index.json'
        cache.write_text(json.dumps({'sites': sites}))
        with mock.patch.object(employer_index, 'CACHE', cache):
            served = {board['host']: board.get('layout') for board in board_ideas.served(['Portugal'])}
        self.assertEqual(served, {'laid.example': {'kind': 'links', 'prefix': '/job'}, 'odd.example': None, 'plain.example': None},
                         'a layout the engine would not replay (a pattern, not a path) is dropped; the board stays')


if __name__ == '__main__':
    unittest.main()
