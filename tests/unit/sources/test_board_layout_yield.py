"""A board layout is kept only while reading through it gives what the usual read gives, and only where board discovery runs (src/sources/board_layout.py).
Why (14 Nov 2026, owner via sa: "In the Scout only (Recommended)"; eo's #4139): a `links` layout with an empty prefix names every one-segment link of a page, the reader takes the first 40 (navigation first),
and nothing compared what that gave with what the page holds. The shapes here are real: Jobeka's page (58 links named, the first 40 hold 8 postings, the usual read 20 jobs) and alo.bg's root layout (as
the served index has it: {'links', prefix ''}; its page shape is assumed from that layout, not saved). edutalent.es is NOT one: its served layout names 4 links and the usual read finds the same 4 jobs."""
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

    def test_jobekas_root_layout_is_not_learned(self):
        """Learn time: the layout derived from the usual read's 20 jobs would read 8 of them (58 named, 40 read): not kept, and the pass says why."""
        jobs, said, notes = self.scout({}, self.jobeka())
        self.assertEqual(len(jobs), 20)
        self.assertNotIn('layout', notes)
        self.assertEqual(notes['why'], 'its one shape names links that are not jobs', 'the share rule answers first: 26 of 58 links are jobs')

    def test_a_root_layout_on_the_page_the_scout_reads_is_refused_for_naming_links_that_are_not_jobs(self):
        """What bp's local Scout run saw (14 Nov 2026): the page it learns from has 28 links (8 navigation, 20 jobs), all read, so reading through the layout gives all 20 jobs; the count alone would keep it
        and the Madrid page (58 links, 40 read) would read 8. A layout with no structure must name at least MATCH_SHARE jobs."""
        jobs, said, notes = self.scout({}, _listing(8, 20))
        self.assertEqual(len(jobs), 20)
        self.assertNotIn('layout', notes)
        self.assertEqual(notes['why'], 'its one shape names links that are not jobs')

    def test_a_served_root_layout_that_reads_fewer_jobs_is_dropped_at_the_re_read(self):
        """alo.bg's root layout, re-read by the Scout: the usual read finds more (30 navigation links first, 13 jobs, 43 named, 40 read): dropped, the fact goes out without it."""
        jobs, said, notes = self.scout({'layout': ROOT}, _listing(30, 13))
        self.assertEqual(len(jobs), 13, 'the usual read decides')
        self.assertEqual(len(said), 1, said)
        self.assertRegex(said[0], r'layout not kept: reading through it gave 10 jobs on .* where the usual read found 13')
        self.assertEqual(notes['layout'], {'kind': 'tag', 'tag': 'div', 'class': 'card'}, 'replaced by the one the usual read\'s jobs give, which reads all 13: never the root layout again')

    def test_a_drop_on_a_later_page_beats_an_earlier_keep(self):
        """Gitar on #4161: a board's pages share one Layout; page 1 holds and notes the layout, page 2 reads fewer jobs than the usual read: the fact must not keep the layout."""
        listing = lambda url: _listing(0, 13) if 'q=developer' in url else _listing(30, 13)
        jobs, said, notes = self.scout({'layout': ROOT}, listing, words=('developer', 'engineer'))
        self.assertEqual(len(said), 1, said)
        self.assertNotEqual(notes['layout'], ROOT, 'the second page dropped it, whatever the first page said')

    def test_a_layout_that_reads_nothing_on_a_later_page_is_dropped_from_the_fact_too(self):
        """sa's class check on #4161: the older drop (a kept layout reads nothing where the usual read finds jobs, #3982) wrote through `_note` too: page 1 holds, page 2 names no link: the fact must not keep it."""
        listing = lambda url: _listing(0, 13) if 'q=developer' in url else _listing(0, 13, folder='/job')
        jobs, said, notes = self.scout({'layout': ROOT}, listing, words=('developer', 'engineer'))
        self.assertEqual(len(said), 1, said)
        self.assertIn('read nothing', said[0])
        self.assertNotEqual(notes['layout'], ROOT)

    def test_a_layout_derived_from_the_ai_readers_jobs_is_checked_through_the_reads_fetch(self):
        """Gitar on #4161: found_boards reads a page with Layout.read, then asks the AI reader and calls learn(page, url, jobs): reading through the derived layout must give those jobs."""
        from src.sources import board_layout
        notes = {}
        layout = board_layout.Layout({**BOARD, 'learn': notes})
        fetch = lambda url: _page(url, _listing(36, 38, folder='/job'))
        url = 'https://jobs.example/search?q=developer'
        layout.read('<html><body><p>No results.</p></body></html>', url, fetch)
        ai_jobs = [{'url': f'https://jobs.example/job/python-developer-{n}', 'title': f'Python Developer {n}'} for n in range(38)]
        with mock.patch('src.sources.page_recipes.derive', return_value={'kind': 'links', 'prefix': '/job'}):
            layout.learn(_listing(36, 38, folder='/job'), url, ai_jobs)
        self.assertNotIn('layout', notes, 'the layout reads 4 of the AI reader\'s 38 jobs')
        self.assertEqual(notes['why'], 'its layout reads fewer jobs than the usual read found')

    def test_a_dropped_layout_with_no_replacement_leaves_the_fact(self):
        """The same re-read where no one shape reads the cards: the layout is noted stale (False), so the next publish carries none."""
        with mock.patch('src.sources.page_recipes.derive', return_value=None):
            jobs, said, notes = self.scout({'layout': ROOT}, _listing(30, 13))
        self.assertEqual(len(jobs), 13)
        self.assertIs(notes['layout'], False)

    def test_a_layout_that_reads_as_many_jobs_stays_and_a_tie_keeps_it(self):
        """A page that names 33 links (all read) gives all 13 jobs: the layout is as good as the usual read."""
        jobs, said, notes = self.scout({'layout': ROOT}, _listing(20, 13))
        self.assertEqual((len(jobs), said, notes['layout']), (13, [], ROOT))

    def test_a_posting_judge_that_answers_nothing_never_drops_a_layout(self):
        """A busy judge leaves every page unjudged in both reads: nothing shows the layout worse, so it is kept."""
        with mock.patch.object(one_posting, 'kept', return_value=[]):
            jobs, said, notes = self.scout({'layout': ROOT}, _listing(36, 38), plain=True)
        self.assertEqual((jobs, said, notes['layout']), ([], [], ROOT))

    def test_a_job_page_is_asked_once_for_the_layout_read_and_the_comparison(self):
        """A 403 is a refusal never asked again and a timeout is not asked a second time by the usual read: each address is requested once per read, a failed one included (Gitar on #4154, sa)."""
        import collections
        import urllib.error
        asked = collections.Counter()
        listing = _listing(36, 38)

        def failing(url):
            asked[url] += 1
            if url.endswith('/python-developer-3'):
                raise urllib.error.HTTPError(url, 403, 'Forbidden', {}, None)
            if url.endswith('/python-developer-5') or url.endswith('/section-2'):
                raise OSError('timed out')
            return _page(url, listing)
        with redirect_stdout(io.StringIO()):
            jobs, _, _ = found_boards.read_board({**BOARD, 'layout': ROOT, 'learn': {}}, SEARCH, fetch=failing)
        self.assertEqual(max(asked.values()), 1, f'an address asked twice: {[u for u, n in asked.items() if n > 1]}')
        self.assertTrue(any(u.endswith('/python-developer-3') for u in asked) and any(u.endswith('/python-developer-5') for u in asked), 'both failing pages were asked once')
        self.assertEqual(len(jobs), 36, 'only those two job pages are lost')

    def test_a_job_page_linked_from_two_listing_pages_is_asked_once_across_the_read(self):
        """Gitar on #4163 + sa: the cache spans the board read, not one listing page: a normal job page and a refused one (403), both linked from the pages of two search words, are asked once."""
        import collections
        import urllib.error
        asked = collections.Counter()
        listing = _listing(36, 38)

        def fetching(url):
            asked[url] += 1
            if url.endswith('/python-developer-3'):
                raise urllib.error.HTTPError(url, 403, 'Forbidden', {}, None)
            return _page(url, listing)
        with redirect_stdout(io.StringIO()):
            found_boards.read_board({**BOARD, 'layout': ROOT, 'learn': {}}, {**SEARCH, 'jobs_board_search_queries': ['developer', 'engineer']}, fetch=fetching)
        job_pages = {u: n for u, n in asked.items() if '/python-developer-' in u or '/section-' in u}
        self.assertTrue(job_pages)
        self.assertEqual(max(job_pages.values()), 1, f'asked more than once across two listing pages: {[u for u, n in job_pages.items() if n > 1]}')
        self.assertEqual(asked[[u for u in asked if u.endswith('/python-developer-3')][0]], 1, 'the refused page is asked once, not once a page')

    def test_a_learned_layout_is_checked_by_reading_through_it_once(self):
        """Learn time shares the usual read's fetched pages: no job page is requested twice."""
        fetched = []
        listing = _listing(8, 20, folder='/job')

        def counting(url):
            fetched.append(url)
            return _page(url, listing)
        notes = {}
        with redirect_stdout(io.StringIO()):
            found_boards.read_board({**BOARD, 'learn': notes}, SEARCH, fetch=counting)
        self.assertEqual(notes.get('layout'), {'kind': 'links', 'prefix': '/job'})
        self.assertEqual(len(fetched), len(set(fetched)))

    def test_a_folder_layout_that_reads_every_job_is_learned_and_an_all_jobs_root_layout_too(self):
        jobs, said, notes = self.scout({}, _listing(8, 20, folder='/job'))
        self.assertEqual((len(jobs), notes.get('layout')), (20, {'kind': 'links', 'prefix': '/job'}))
        jobs, said, notes = self.scout({}, _listing(0, 20))
        self.assertEqual((len(jobs), notes.get('layout')), (20, ROOT))

    def test_a_folder_layout_that_reads_too_few_is_refused(self):
        """36 navigation links then 38 jobs under one folder: the first 40 hold 4 postings."""
        jobs, said, notes = self.scout({}, _listing(36, 38, folder='/job'))
        self.assertEqual(len(jobs), 38)
        self.assertNotIn('layout', notes)

    # ---- a search's own read (no board['learn']) never compares

    def test_a_search_reads_a_served_layout_with_no_check_and_no_second_read(self):
        """The owner's rule: no new seconds in a person's first minute. A served layout that reads 4 of 38 gives 4, with no question, one fetch per job page, no line (the Scout drops it, not the search)."""
        fetched = []
        listing = _listing(36, 38)

        def counting(url):
            fetched.append(url)
            return _page(url, listing)
        out = io.StringIO()
        with redirect_stdout(out):
            jobs, _, _ = found_boards.read_board({**BOARD, 'layout': ROOT}, SEARCH, fetch=counting)
        self.assertEqual(len(jobs), 4)
        self.assertEqual((self.asked, [line for line in out.getvalue().splitlines() if 'layout' in line]), ([], []))
        self.assertEqual(len(fetched), 1 + 40, 'the page and the first 40 links the layout names, once each')


if __name__ == '__main__':
    unittest.main()
