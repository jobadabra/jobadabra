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


def _list(ids, more=False):
    cards = ''.join(f'<div class="card"><a href="/job/{n}">Python Developer {n}</a></div>' for n in ids)
    return f'<html><body>{MENU}{cards}' + ('<a rel="next" href="/search?q=developer&page=2">Next</a>' if more else '') + '</body></html>'


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
            return {(str(t), str(p)): page_words.Words(False, False, False, str(p).startswith('/job/')) for t, p in pairs}
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
