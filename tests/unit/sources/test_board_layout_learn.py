"""Board discovery learns a layout with no structure only when it names the jobs (src/sources/board_layout.py `_names_jobs`).
Why (14 Nov 2026, owner via sa: "In the Scout only"; eo's #4139, bp's local Scout run on Jobeka): a `links` layout with an empty prefix names every one-segment link of a page, navigation included, and the reader
takes the first 40 in page order. Jobeka's page (28 links, 20 jobs) was learned from the usual read's 20 jobs; its Madrid page names 58 links, the first 40 hold 8 postings. Only the learn is judged here: a search's own read
never is (no fetch, no cache, no extra call)."""
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src.ai import decide, page_words  # noqa: E402
from src.sources import careers, found_boards, one_posting  # noqa: E402

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'jobs_board_search_queries': ['developer'], 'role_keywords': ['developer'],
          'locations': {'top_tier': ['Lisboa'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Jobs Example', 'host': 'jobs.example', 'search_url': 'https://jobs.example/search?q={role}', 'countries': ['Portugal'], 'kinds': ['any']}
FOOTER = '<footer><p>' + 'Jobs Example lists open positions from employers across the country, updated every day. ' * 12 + '</p></footer>'
ROOT = {'kind': 'links', 'prefix': ''}


def _is_job(path):
    return path.startswith('/python-developer-') or path.startswith('/job/python-developer-')


def _listing(nav, jobs, folder=''):
    """Navigation links first, then the job cards: `folder` is where the job links sit ('' = the root, as on edutalent.es)."""
    navs = ''.join(f'<a href="{folder}/section-{n}">Section {n} of the site</a>' for n in range(nav))
    cards = ''.join(f'<div class="card"><a href="{folder}/python-developer-{n}">Python Developer {n}</a></div>' for n in range(jobs))
    return f'<html><body>{navs}{cards}{FOOTER}</body></html>'


def _page(url, listing, plain=False):
    """The listing for the search page, a JSON-LD posting for a job link (a page with no data of its own when `plain`: only the AI's verdict says it is a posting), a plain page for a navigation link."""
    slug = url.rsplit('/', 1)[1]
    if _is_job('/' + url.split('/', 3)[3]) and plain:
        return f'<html><body><h1>{slug.replace("-", " ").title()}</h1><p>Lisboa. Python work for a small team.</p>{FOOTER}</body></html>'
    if _is_job('/' + url.split('/', 3)[3]):
        job = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': slug.replace('-', ' ').title(), 'url': url,
               'hiringOrganization': {'@type': 'Organization', 'name': 'Acme Lda'},
               'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Lisboa', 'addressCountry': 'PT'}}, 'datePosted': '2026-11-14'}
        return f'<html><script type="application/ld+json">{json.dumps(job)}</script><body>x</body></html>'
    if '/section-' in url:
        return f'<html><body><h1>{slug}</h1><p>About the site.</p>{FOOTER}</body></html>'
    return listing(url) if callable(listing) else listing


class LayoutLearnTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={}),
                      mock.patch('src.sources.board_yield.is_relevant', side_effect=list),
                      # The AI's "is this page one posting" verdict, faked as the link words are: a navigation page is not a posting.
                      mock.patch.object(one_posting, 'kept', side_effect=lambda jobs, reader_on, judge=None: [j for j in jobs if 'python developer' in j['title'].lower()])):
            patch.start()
            self.addCleanup(patch.stop)
        self.asked = []

        def link_words(pairs, floor=None):
            pairs = list(pairs)
            self.asked.extend(pairs)
            verdict = {(str(t), str(p)): _is_job(str(p)) for t, p in pairs}
            decide.remember(page_words.LINK, {page_words._wording(t, p): 'job_page' if yes else 'not_jobs' for (t, p), yes in verdict.items()}, page_words.LINK_ANSWERS)
            return {pair: page_words.Words(False, False, False, yes) for pair, yes in verdict.items()}
        patch = mock.patch.object(page_words, 'link_words', side_effect=link_words)
        patch.start()
        self.addCleanup(patch.stop)

    def read(self, board, listing, plain=False, words=('developer',)):
        out = io.StringIO()
        with redirect_stdout(out):
            jobs, state, _ = found_boards.read_board(board, {**SEARCH, 'jobs_board_search_queries': list(words)}, fetch=lambda url: _page(url, listing, plain))
        self.out = out.getvalue().splitlines()
        return jobs, [line for line in self.out if 'layout' in line]

    # ---- board discovery (board['learn'] set): a layout is kept only while it reads what the usual read reads

    def scout(self, board, listing, words=('developer',), plain=False):
        notes = {}
        jobs, said = self.read({**BOARD, **board, 'learn': notes}, listing, plain=plain, words=words)
        return jobs, said, notes


    @staticmethod
    def jobeka():
        """Jobeka's Madrid page: 32 navigation links, the 20 job cards, then 6 more navigation links: 58 named, the first 40 hold 8 postings."""
        navs = lambda start, count: ''.join(f'<a href="/section-{n}">Section {n} of the site</a>' for n in range(start, start + count))
        cards = ''.join(f'<div class="card"><a href="/python-developer-{n}">Python Developer {n}</a></div>' for n in range(20))
        return f'<html><body>{navs(0, 32)}{cards}{navs(32, 6)}{FOOTER}</body></html>'

    def test_a_root_layout_on_a_page_whose_links_are_mostly_navigation_is_not_learned(self):
        """The page bp's local Scout run learned from: 28 links (8 navigation, 20 jobs), all read; the count alone gives all 20 jobs, the share (20 of 28) is under MATCH_SHARE."""
        jobs, said, notes = self.scout({}, _listing(8, 20))
        self.assertEqual(len(jobs), 20)
        self.assertNotIn('layout', notes)
        self.assertEqual(notes['why'], 'its one shape names links that are not jobs')

    def test_jobekas_madrid_page_is_not_learned_either(self):
        jobs, said, notes = self.scout({}, self.jobeka())
        self.assertEqual(len(jobs), 20)
        self.assertNotIn('layout', notes)
        self.assertEqual(notes['why'], 'its one shape names links that are not jobs')

    def test_a_root_layout_on_a_page_of_nothing_but_jobs_is_learned(self):
        jobs, said, notes = self.scout({}, _listing(0, 20))
        self.assertEqual(len(jobs), 20)
        self.assertTrue(notes.get('layout'), notes)

    def test_a_root_layout_that_names_as_many_jobs_as_the_share_asks_is_learned(self):
        """4 navigation links and 20 jobs: 20 of 24 named, over MATCH_SHARE (0.8): the boundary holds."""
        jobs, said, notes = self.scout({}, _listing(4, 20))
        self.assertEqual(notes.get('layout'), {'kind': 'links', 'prefix': ''})

    def test_a_layout_with_a_folder_is_learned_whatever_else_the_page_links(self):
        """Structure (a prefix) tells job links apart from navigation: the share rule is only for a layout with none."""
        jobs, said, notes = self.scout({}, _listing(30, 20, folder='/job'))
        self.assertEqual(len(jobs), 20)
        self.assertTrue(notes.get('layout'), notes)

    def test_a_search_never_judges_a_layout(self):
        """No board['learn'] (a person's search): nothing is noted and the read is the same."""
        jobs, said = self.read(BOARD, self.jobeka())
        self.assertEqual((len(jobs), said), (20, []))

    def test_a_posting_whose_own_address_differs_from_its_link_still_counts_by_its_title(self):
        """Gitar on #4167: a job's address is the posting's own (JSON-LD `url`), not always the link it was read through; `_fits` also counts a title match, so does the share."""
        from src.sources import board_layout
        page = _listing(0, 20)
        found = [{'url': f'https://other.example/p/{n}', 'title': f'Python Developer {n}'} for n in range(20)]
        self.assertTrue(board_layout._names_jobs(ROOT, page, 'https://jobs.example/search?q=developer', found))
        self.assertFalse(board_layout._names_jobs(ROOT, page, 'https://jobs.example/search?q=developer', [{'url': 'https://other.example/x', 'title': 'Cook'}]))

    def test_addresses_are_compared_without_a_fragment_or_a_trailing_slash(self):
        from src.sources import board_layout
        found = [{'url': f'https://jobs.example/python-developer-{n}/#apply', 'title': f'Role {n}'} for n in range(20)]
        self.assertTrue(board_layout._names_jobs(ROOT, _listing(0, 20), 'https://jobs.example/search?q=developer', found))

    def test_a_layout_that_names_no_link_is_refused(self):
        from src.sources import board_layout
        found = [{'url': 'https://jobs.example/python-developer-1', 'title': 'Python Developer 1'}]
        self.assertFalse(board_layout._names_jobs(ROOT, '<html><body><p>No links</p></body></html>', 'https://jobs.example/search?q=developer', found))


if __name__ == '__main__':
    unittest.main()
