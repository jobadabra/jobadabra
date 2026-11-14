"""A served or learned board layout must give what the usual read gives (src/sources/board_layout.py).
Why (14 Nov 2026, owner via sa: "Why not fixing right away?"; eo's #4139: a board read through its layout gave fewer jobs than the usual read on 18 of 76 hosts,
edutalent.es 4 vs 38): a `links` layout with an empty prefix named every one-segment link of a page, the reader took the first 40 (navigation first), and nothing
compared what that gave with what the page holds. These tests play that page and the Scout's learning of one."""
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
    return listing


class LayoutYieldTests(unittest.TestCase):
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

    def read(self, board, listing, plain=False):
        out = io.StringIO()
        with redirect_stdout(out):
            jobs, state, _ = found_boards.read_board(board, SEARCH, fetch=lambda url: _page(url, listing, plain))
        self.out = out.getvalue().splitlines()
        return jobs, [line for line in self.out if 'layout' in line]

    # ---- (b) read time: what a served layout gave is compared with the links it named

    def test_a_served_layout_that_names_navigation_first_reads_the_usual_way(self):
        """edutalent.es: 36 navigation links then 38 jobs on one page, served {'links', prefix ''}: the first 40 held 4 postings (4 jobs vs the usual read's 38)."""
        jobs, said = self.read({**BOARD, 'layout': ROOT}, _listing(36, 38))
        self.assertEqual(len(jobs), 38, 'the usual read finds every job; the layout gave 4')
        self.assertEqual(len(said), 1, f'one line for the read, not one per page: {said}')
        self.assertIn('named 74 links', said[0])
        self.assertIn('4 gave a posting', said[0])
        self.assertTrue(self.asked, 'the link questions are back for this read')

    def test_below_one_third_postings_the_usual_read_decides_and_a_tie_keeps_the_layout(self):
        """The bound is the one a layout passed at learn time (page_recipes.MAX_FACTOR: it may name at most 3x the jobs): postings x 3 < pages read asks the usual read."""
        jobs, said = self.read({**BOARD, 'layout': ROOT}, _listing(5, 3))   # 8 links, 3 postings: 3 x 3 = 9 >= 8
        self.assertEqual((len(jobs), said, self.asked), (3, [], []), 'at the bound the layout holds, with no link question')
        jobs, said = self.read({**BOARD, 'layout': ROOT}, _listing(6, 2))   # 8 links, 2 postings: 2 x 3 = 6 < 8
        self.assertEqual((len(jobs), said), (2, []), 'the usual read found the same 2: the layout is no worse, it stays')
        self.assertTrue(self.asked, 'the usual read was asked, once')

    def test_a_posting_judge_that_answers_nothing_never_makes_a_layout_stale(self):
        """A busy judge leaves every page unjudged in both reads: nothing shows the layout worse, so it is kept (board discovery would otherwise publish none)."""
        notes = {}
        with mock.patch.object(one_posting, 'kept', return_value=[]):
            jobs, said = self.read({**BOARD, 'layout': ROOT, 'learn': notes}, _listing(36, 38), plain=True)
        self.assertEqual((jobs, said), ([], []))
        self.assertEqual(notes.get('layout'), ROOT)

    def test_a_layout_that_gives_the_postings_it_named_stays_with_no_question(self):
        """The control: a page whose root links are all jobs keeps the same layout and asks the AI nothing."""
        jobs, said = self.read({**BOARD, 'layout': ROOT}, _listing(0, 12))
        self.assertEqual((len(jobs), said, self.asked), (12, [], []))

    # ---- (a) learn time: board discovery keeps a layout only if it reads what the usual read found

    def learned(self, listing, folder=''):
        notes = {}
        jobs, _ = self.read({**BOARD, 'learn': notes}, listing)
        return jobs, notes

    def test_a_root_layout_naming_links_that_are_not_jobs_is_not_learned(self):
        """Jobeka (bp's local Scout run): the search page's 28 root links, the usual read finds 20 jobs, and {'links', prefix ''} was learned: 8 links are not jobs."""
        jobs, notes = self.learned(_listing(8, 20))
        self.assertEqual(len(jobs), 20)
        self.assertNotIn('layout', notes, 'a root layout has no structure to tell a job from a link: it must give 80% jobs')
        self.assertEqual(notes['why'], 'its one shape names links that are not jobs')

    def test_a_root_layout_whose_links_are_all_jobs_is_learned(self):
        jobs, notes = self.learned(_listing(0, 20))
        self.assertEqual((len(jobs), notes.get('layout')), (20, ROOT))

    def test_a_folder_layout_is_refused_when_the_links_it_reads_are_mostly_navigation(self):
        """Under a folder the structure helps, so the bound is the read's own: 1 posting in 3 links. 36 navigation links first leave 4 jobs in the first 40."""
        jobs, notes = self.learned(_listing(36, 38, folder='/job'))
        self.assertEqual(len(jobs), 38)
        self.assertNotIn('layout', notes)

    def test_a_folder_layout_with_some_navigation_is_learned(self):
        jobs, notes = self.learned(_listing(8, 20, folder='/job'))
        self.assertEqual((len(jobs), notes.get('layout')), (20, {'kind': 'links', 'prefix': '/job'}))


if __name__ == '__main__':
    unittest.main()
