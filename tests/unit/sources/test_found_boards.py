"""Reading the boards found for the user's countries (src/sources/found_boards.py): a public search page read like a careers page, its
employer taken from the page's own job data, a refusing board marked for a visit and never fetched again, an empty one dropped after 3."""
import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src.sources import found_boards  # noqa: E402
from src.sources import careers  # noqa: E402

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'jobs_board_search_queries': ['programador'], 'role_keywords': ['developer'],
          'locations': {'top_tier': ['Lisboa'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Empregos', 'host': 'empregos.example', 'search_url': 'https://empregos.example/procura?q={role}&local={place}',
         'countries': ['Portugal'], 'kinds': ['any']}
JOB = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': 'Programador Python', 'url': 'https://empregos.example/oferta/1',
       'hiringOrganization': {'@type': 'Organization', 'name': 'Acme Lda'},
       'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Lisboa', 'addressCountry': 'PT'}}, 'datePosted': '2026-10-07'}
PAGE = f'<html><script type="application/ld+json">{json.dumps(JOB)}</script><body>Programador</body></html>'


class FoundBoardsTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)

    def test_a_board_is_read_with_your_own_search_and_place_and_its_employer(self):
        asked = []
        jobs = found_boards.read(SEARCH, [BOARD], fetch=lambda url: asked.append(url) or PAGE)
        self.assertEqual(asked, ['https://empregos.example/procura?q=programador&local=Lisboa', 'https://empregos.example/', 'https://empregos.example/robots.txt'],
                         'no job in your roles: its own search form, then its own job list, looked for once (found_boards._another_way)')
        self.assertEqual([(j['title'], j['company'], j['url']) for j in jobs], [('Programador Python', 'Acme Lda', 'https://empregos.example/oferta/1')])

    def _page_for(self, title):
        job = {**JOB, 'title': title, 'url': 'https://empregos.example/oferta/' + title.replace(' ', '-')}
        return f'<html><script type="application/ld+json">{json.dumps(job)}</script><body>x</body></html>'

    def test_the_full_read_asks_every_query_but_the_first_jobs_slice_only_two(self):
        """18 Oct 2026: a driver's board read used 2 of the 5 queries its strategy has and found 3 jobs."""
        search = {**SEARCH, 'jobs_board_search_queries': ['um', 'dois', 'tres', 'quatro', 'cinco', 'seis']}
        asked = []
        pages = lambda url: asked.append(url) or self._page_for(url.split('q=')[1].split('&')[0])
        found_boards.read_board(BOARD, search, fetch=pages, early=True)
        self.assertEqual(len(asked), found_boards.MAX_SEARCHES)
        asked.clear()
        jobs, _, _ = found_boards.read_board(BOARD, search, fetch=pages)
        self.assertEqual((len(asked), len(jobs)), (found_boards.FULL_SEARCHES, found_boards.FULL_SEARCHES))

    def test_a_board_that_stops_adding_jobs_is_not_asked_every_query(self):
        search = {**SEARCH, 'jobs_board_search_queries': ['um', 'dois', 'tres', 'quatro', 'cinco']}
        asked = []
        jobs, _, _ = found_boards.read_board(BOARD, search, fetch=lambda url: asked.append(url) or PAGE)   # the same job for every query
        self.assertEqual((len(asked), len(jobs)), (found_boards.MAX_SEARCHES + found_boards.IDLE_STOP - 1, 1))

    def test_the_words_a_board_was_searched_with_are_told_to_the_scout_in_its_notes(self):
        """13 Nov 2026 (bp): the Scout counts a role family on a board only when the board was asked that family's own word; an idle board stops before its later words."""
        search = {**SEARCH, 'jobs_board_search_queries': ['Um', 'dois', 'tres', 'quatro', 'cinco']}
        notes = {}
        found_boards.read_board({**BOARD, 'learn': notes}, search, fetch=lambda url: PAGE)   # the same job for every query: the read stops early
        self.assertEqual(notes['terms'], ['um', 'dois', 'tres'])

    def test_a_list_read_through_a_declared_feed_forgets_the_words_it_asked(self):
        """Gitar on #4027: the feed's whole list is not what a word gave, so the Scout reads it as a list (every asked family measured); no notes is no error."""
        board = {**BOARD, 'learn': {}}
        found_boards._told(board, 'Um')
        found_boards._told(board, 'dois')
        self.assertEqual(board['learn']['terms'], ['um', 'dois'])
        found_boards._told(board)
        self.assertNotIn('terms', board['learn'])
        found_boards._told(BOARD, 'um')   # an install's read has no notes: nothing is written
        self.assertNotIn('learn', BOARD)

    def test_a_refusing_board_becomes_a_visit_and_is_never_fetched_again(self):
        def refuse(url):
            raise urllib.error.HTTPError(url, 403, 'Forbidden', None, None)
        self.assertEqual(found_boards.read(SEARCH, [BOARD], fetch=refuse), [])
        asked = []
        found_boards.read(SEARCH, [BOARD], fetch=lambda url: asked.append(url) or PAGE)
        self.assertEqual(asked, [])
        from src.ai import board_ideas
        self.assertEqual(board_ideas.load()['boards']['empregos.example']['state'], 'browser')

    def test_a_board_that_finds_nothing_three_searches_running_is_dropped(self):
        # Its history is the job cache's source_yield rows (one copy, PR 6 of 2026-10-18-search-learns-sources.md), as daily_search keeps them.
        from datetime import datetime, timedelta, timezone
        from src import paths, source_yield, store
        empty = lambda url: '<html><body><p>Sem resultados para a sua pesquisa. ' + 'Experimente outras palavras ou outra zona. ' * 30 + '</p></body></html>'
        with store.connect(paths.DATA / 'jobs.sqlite') as db:
            for run in range(3):
                now = datetime(2026, 10, 18, tzinfo=timezone.utc) + timedelta(hours=run)
                found_boards.read(SEARCH, [BOARD], fetch=empty, now=now)
                source_yield.run(db, now.isoformat(timespec='seconds'), read=found_boards.read_since(now.isoformat(timespec='seconds')))
        asked = []
        found_boards.read(SEARCH, [BOARD], fetch=lambda url: asked.append(url) or empty(url))
        self.assertEqual(asked, [], 'dropped: not read a 4th time')


    def test_a_board_that_refuses_mid_read_counts_each_job_once(self):
        """18 Oct 2026: a driver's board gave the same jobs to several queries, then refused; the log said 111 jobs, 99 relevant, for 47 jobs."""
        search = {**SEARCH, 'jobs_board_search_queries': ['um', 'dois', 'tres']}
        for code in (403, 'Refused'):
            def pages(url, code=code):
                if 'q=tres' in url:
                    if code == 403:
                        raise urllib.error.HTTPError(url, 403, 'Forbidden', None, None)
                    raise type('Refused', (OSError,), {})('robots')
                return PAGE   # the same job for every query
            jobs, state, _ = found_boards.read_board(BOARD, search, fetch=pages)
            self.assertEqual((state, len(jobs)), ('browser', 1), code)

    def test_boards_are_read_at_once_and_each_reported_when_it_ends(self):
        """18 Oct 2026: Chisinau's 2 slice boards gave nothing and its useful ones came 4th and 8th, each read after the one before. The list's
        order was never the requirement (#3892): a board is reported as soon as it ends, so the first board, ending last, comes last."""
        import threading
        boards = [{**BOARD, 'name': f'Board {n}', 'host': f'b{n}.example', 'search_url': f'https://b{n}.example/q?q={{role}}&l={{place}}'}
                  for n in range(1, found_boards.BOARD_WORKERS + 1)]
        all_reading = threading.Barrier(found_boards.BOARD_WORKERS, timeout=60)   # one after the other: the first never gets past it; 60 s is a hang guard (a 5 s one broke on a loaded runner, 10 Nov 2026)
        first = set()
        others_reported = threading.Event()
        board_lines = []
        def say(*args, **kwargs):
            if args and str(args[0]).startswith('Job boards found:'):
                board_lines.append(args[0])
                if len(board_lines) == found_boards.BOARD_WORKERS - 1:
                    others_reported.set()
        def pages(url):
            host = url.split('//')[1].split('/')[0]
            if host not in first:   # each board's first page waits until every board has asked for its own
                first.add(host)
                all_reading.wait()
            if url.startswith('https://b1.'):   # the first board ends last
                # Why (xc, 14 Nov 2026, #4183 run 43600640609): a 0.2 s sleep lost to the other boards on a loaded runner ('4' != '1');
                # the first board now ends after every other board was reported, and 30 s is only a hang guard (a reader that holds them back fails).
                others_reported.wait(30)
            return self._page_for(url.split('//')[1].split('.')[0])
        with mock.patch('builtins.print', side_effect=say) as said:
            jobs = found_boards.read(SEARCH, boards, fetch=pages, is_relevant=lambda found: found)
        self.assertEqual(len(jobs), found_boards.BOARD_WORKERS)
        lines = [call.args[0] for call in said.call_args_list if str(call.args[0]).startswith('Job boards found:')]
        reported = [line.split()[4] for line in lines]
        self.assertEqual(sorted(reported), [str(n) for n in range(1, found_boards.BOARD_WORKERS + 1)], 'each board reported once')
        self.assertEqual(reported[-1], '1', 'the first board ended last and did not hold back the others')
        self.assertEqual([job['title'] for job in jobs][0], 'b1', 'the jobs come back in the list\'s order')

    def test_a_board_that_only_a_browser_reads_is_offered_as_a_visit(self):
        from src.sources import visits_portals
        from src.sources import host_pace
        def busy(url):   # a site asking us to slow down (429) is paced, not a site only a browser reads (owner, 20 Oct 2026)
            raise host_pace.Busy(url, 0)
        found_boards.read(SEARCH, [BOARD], fetch=busy)
        self.assertEqual([p for p in visits_portals.portals(SEARCH) if p['key'].startswith('board:')], [])

        def refuse(url):
            raise urllib.error.HTTPError(url, 403, 'Forbidden', None, None)
        found_boards.read(SEARCH, [BOARD], fetch=refuse)
        offered = [p for p in visits_portals.portals(SEARCH) if p['key'].startswith('board:')]
        self.assertEqual([(p['name'], p['url']) for p in offered], [('Empregos', 'https://empregos.example/procura?q=developer&local=Lisboa')])   # the first role word, as LinkedIn and Indeed

    def test_a_readable_page_with_no_jobs_still_tries_what_the_board_declares(self):
        """A page full of text whose job cards come from scripts is not a 'shell': its declared sitemap must still be tried."""
        text = '<html><body>' + '<p>Vacatures zoeken en solliciteren bij werkgevers in jouw regio, vergelijk salarissen.</p>' * 20 + '</body></html>'
        listing = '<urlset><url><loc>https://empregos.example/vaga/26051135-programador-python</loc></url></urlset>'
        pages = {'https://empregos.example/procura?q=programador&local=Lisboa': text,
                 'https://empregos.example/robots.txt': 'Sitemap: https://empregos.example/sitemap.xml',
                 'https://empregos.example/sitemap.xml': listing, 'https://empregos.example/vaga/26051135-programador-python': PAGE}
        jobs, state, route = found_boards.read_board(BOARD, SEARCH, fetch=lambda url: pages.get(url, ''))
        self.assertEqual((state, route['kind'], [j['title'] for j in jobs]), ('ok', 'sitemap', ['Programador Python']))

    def test_a_readable_page_with_no_jobs_and_no_routes_is_empty_not_a_visit(self):
        text = '<html><body>' + '<p>Vacatures zoeken en solliciteren bij werkgevers in jouw regio, vergelijk salarissen.</p>' * 20 + '</body></html>'
        jobs, state, route = found_boards.read_board(BOARD, SEARCH, fetch=lambda url: text if 'procura' in url else '')
        self.assertEqual((jobs, state, route), ([], 'empty', None))

    def test_the_kind_of_route_that_gave_the_jobs_is_kept_for_the_source_queue(self):
        state = json.dumps({'r': [{'title': f'Programador {i}', 'url': f'/vaga/{i}0001/p', 'company': 'Acme', 'city': 'Lisboa'} for i in range(3)]})
        page = '<html><body><script>window.__S__ = ' + state + ';</script></body></html>'
        found_boards.read(SEARCH, [BOARD], fetch=lambda url: page)
        from src.ai import board_ideas
        self.assertEqual(board_ideas.load()['boards'][BOARD['host']]['route_kind'], 'state')

    def test_a_readable_page_with_embedded_state_is_read_from_it(self):
        state = json.dumps({'r': [{'title': f'Programador {i}', 'url': f'/vaga/{i}0001/p', 'company': 'Acme', 'city': 'Lisboa'} for i in range(3)]})
        page = '<html><body>' + '<p>Vacatures zoeken en solliciteren bij werkgevers in jouw regio.</p>' * 40 + '<script>window.__S__ = ' + state + ';</script></body></html>'
        jobs, found_state, route = found_boards.read_board(BOARD, SEARCH, fetch=lambda url: page)
        self.assertEqual((found_state, route['kind'], len(jobs)), ('ok', 'state', 3))

    def _company(self, hiring):
        page = f'<html><script type="application/ld+json">{json.dumps({**JOB, "hiringOrganization": hiring})}</script><body>x</body></html>'
        jobs, _, _ = found_boards.read_board(BOARD, SEARCH, fetch=lambda url: page, early=True)
        return [job['company'] for job in jobs]

    def test_a_job_naming_its_employer_and_the_recruiter_that_posted_it_keeps_the_employer_only(self):
        """#3581 (8 Nov 2026): a board job's company was two names in one, employer and recruiter, so a cover letter could name the wrong company."""
        employer, recruiter = {'@type': 'Organization', 'name': 'Example Jets GmbH'}, {'@type': 'Organization', 'name': 'Example Recruiting GmbH & Co.KG'}
        self.assertEqual(self._company([employer, recruiter]), ['Example Jets GmbH'])
        agency = {'@type': 'EmploymentAgency', 'name': 'Example Recruiting GmbH & Co.KG'}
        self.assertEqual(self._company([agency, employer]), ['Example Jets GmbH'], 'the one schema.org marks as an agency is not the employer')
        self.assertEqual(self._company(['Example Jets GmbH', 'Example Recruiting GmbH & Co.KG']), ['Example Jets GmbH'])

    def test_a_job_with_one_company_keeps_it_unchanged(self):
        self.assertEqual(self._company({'@type': 'Organization', 'name': 'Example Recruiting GmbH & Co.KG'}), ['Example Recruiting GmbH & Co.KG'])
        self.assertEqual(self._company([{'@type': 'EmploymentAgency', 'name': 'Example Personal GmbH'}]), ['Example Personal GmbH'], 'an agency alone is all the page names')


class TwoReadsAtOnceTests(unittest.TestCase):
    """One press runs two board reads at once (the first-jobs slice, src/first_jobs.py board_jobs, and the boards the web search found,
    src/sources/board_reader.py _fetch). Night 43313523472: each saved the whole board memory at its end and the later save dropped the
    other's boards: p1's Jobs.bg (403) and p3's Jobat, StepStone and Constructjobs (403) were gone after the press."""
    OTHER = {**BOARD, 'name': 'Vagas', 'host': 'vagas.example', 'search_url': 'https://vagas.example/procura?q={role}'}

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)

    def _both(self):
        """Read A (a readable board) loads the memory, then waits in its first page; read B (a board that answers 403) runs and saves; then A ends and saves."""
        import threading
        b_saved = threading.Event()

        def slow(url):
            b_saved.wait(60)   # a hang guard only: B always sets it
            return PAGE

        def refuse(url):
            raise urllib.error.HTTPError(url, 403, 'Forbidden', None, None)
        a = threading.Thread(target=found_boards.read, args=(SEARCH, [BOARD]), kwargs={'fetch': slow, 'web': False})
        a.start()
        try:
            found_boards.read(SEARCH, [self.OTHER], fetch=refuse, web=False)
        finally:
            b_saved.set()
            a.join(60)
        self.assertFalse(a.is_alive())
        from src.ai import board_ideas
        return board_ideas.load().get('boards') or {}

    def test_two_reads_at_once_keep_both_boards_states(self):
        boards = self._both()
        self.assertEqual({host: boards.get(host, {}).get('state') for host in ('empregos.example', 'vagas.example')},
                         {'empregos.example': 'ok', 'vagas.example': 'browser'})

    def test_a_403_kept_by_one_read_is_still_stopped_after_the_other_saves(self):
        self._both()
        asked = []
        found_boards.read(SEARCH, [self.OTHER], fetch=lambda url: asked.append(url) or PAGE, web=False)
        self.assertEqual(asked, [], 'a board that answered 403 is not asked again by the plain reader (CLAUDE.md: never retry a 401 or 403)')


if __name__ == '__main__':
    unittest.main()
