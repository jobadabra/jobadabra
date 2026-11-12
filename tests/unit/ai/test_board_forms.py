"""A job board's own search link from the search form on its home page (src/sources/board_forms.py), tried when the proposed link gave no
relevant job: kept and used from then on when it gives relevant ones (18 Oct 2026: a finance search's boards ignored the guessed links and
listed warehouse jobs, or German student jobs, for "financial analyst" in Amsterdam)."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.sources import board_forms, board_pages, careers, found_boards

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


HOME = 'https://vacatures.example/'


def form(body, action='/zoeken', method='get'):
    return f'<html><body><form action="{action}" method="{method}">{body}<button>Zoek</button></form></body></html>'


class TemplateTests(unittest.TestCase):
    def test_a_get_form_with_two_text_boxes_gives_role_and_place(self):
        page = form('<input name="wat" type="text"><input name="waar"><input type="hidden" name="lang" value="nl">')
        self.assertEqual(board_forms.templates(page, HOME), ['https://vacatures.example/zoeken?lang=nl&wat={role}&waar={place}'])

    def test_one_text_box_gives_the_role_only(self):
        self.assertEqual(board_forms.templates(form('<input type="search" name="q">'), HOME), ['https://vacatures.example/zoeken?q={role}'])

    def test_a_form_that_posts_or_asks_a_password_is_never_used(self):
        self.assertEqual(board_forms.templates(form('<input name="q">', method='post'), HOME), [])
        self.assertEqual(board_forms.templates(form('<input name="user"><input type="password" name="pw">'), HOME), [])

    def test_a_form_that_sends_to_another_site_is_left_alone(self):
        self.assertEqual(board_forms.templates(form('<input name="q">', action='https://elsewhere.example/s'), HOME), [])

    def test_a_subdomain_of_the_board_is_its_own(self):
        self.assertEqual(board_forms.templates(form('<input name="q">', action='https://www.vacatures.example/s'), HOME),
                         ['https://www.vacatures.example/s?q={role}'])

    def test_an_action_with_its_own_query_keeps_it(self):
        self.assertEqual(board_forms.templates(form('<input name="q">', action='/s?src=home'), HOME), ['https://vacatures.example/s?src=home&q={role}'])

    def test_a_page_with_no_form_gives_nothing(self):
        self.assertEqual(board_forms.templates('<html><body><a href="/x">Jobs</a></body></html>', HOME), [])


class PostedFormTests(unittest.TestCase):
    """A search form sent by POST (12 Nov 2026, ch: a Swiss board's search form is a POST naming the field SearchWhat; its list page answers ?SearchWhat= and ignored the guessed ?keywords=)."""
    LIST = 'https://vacatures.example/jobs/?keywords={role}&location={place}'

    def test_a_posted_form_is_asked_as_a_get_link_at_the_search_page_not_its_action(self):
        token = 'ut0l3J0cZL6u3-7fFhdFrDgkORZ-8ySXMgVeHvexpJC8CMZVgKCBwf'
        page = form(f'<input type="hidden" name="SearchWhere" value=""><input type="hidden" name="lang" value="de">'
                    f'<input type="hidden" name="__token" value="{token}"><input name="SearchWhat" type="text">', action='/search/', method='post')
        self.assertEqual(board_forms.templates(page, HOME, self.LIST), ['https://vacatures.example/jobs/?SearchWhere=&lang=de&SearchWhat={role}'],
                         'a short constant stays as the form sends it; a token never goes into the kept link')
        self.assertEqual(board_forms.templates(page, HOME), [], 'with no search page to ask, a POST form is still never used')

    def test_a_posted_form_with_a_password_or_to_another_site_is_still_left_alone(self):
        self.assertEqual(board_forms.templates(form('<input name="u"><input type="password" name="p">', method='post'), HOME, self.LIST), [])
        self.assertEqual(board_forms.templates(form('<input name="q">', action='https://elsewhere.example/s', method='post'), HOME, self.LIST), [])

    def test_a_board_whose_home_form_posts_is_read_through_its_field_names(self):
        board = {**BOARD, 'search_url': 'https://vacatures.example/jobs/?keywords={role}&location={place}'}
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)

        def fetch(url):
            if 'SearchWhat=' in url:
                return posting('Financial Analyst', 1)
            if url == HOME:
                return form('<input name="SearchWhat">', action='/search/', method='post')
            return posting('Magazijnmedewerker', 2)   # the guessed link: its words ignored
        relevant = lambda jobs: [job for job in jobs if 'Financial' in job['title']]
        with mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={}):
            jobs = found_boards.read(SEARCH, [board], fetch=fetch, is_relevant=relevant, dead=set())
        self.assertEqual([job['title'] for job in jobs], ['Financial Analyst'])


    def test_a_list_that_gave_only_a_few_relevant_jobs_is_read_through_its_form_when_that_gives_more(self):
        """The guessed link is ignored and the unfiltered list holds 1 relevant job by chance (12 Nov 2026: JobScout24, 2 of 45): the form's list has 3."""
        board = {**BOARD, 'search_url': 'https://vacatures.example/jobs/?keywords={role}&location={place}'}
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)

        def many(titles):
            jobs = [{'@context': 'https://schema.org', '@type': 'JobPosting', 'title': title, 'url': f'https://vacatures.example/v/{n}-{title[:3]}',
                     'hiringOrganization': {'@type': 'Organization', 'name': 'Acme'}, 'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Amsterdam', 'addressCountry': 'NL'}}}
                    for n, title in enumerate(titles)]
            return '<html>' + ''.join(f'<script type="application/ld+json">{json.dumps(job)}</script>' for job in jobs) + '<body>x</body></html>'

        def fetch(url):
            if 'SearchWhat=' in url:
                return many(['Financial Analyst', 'Financial Controller', 'Financial Planner'])
            if url == HOME:
                return form('<input name="SearchWhat">', action='/search/', method='post')
            return many(['Financial Analyst', 'Magazijnmedewerker', 'Chauffeur', 'Kok', 'Bakker', 'Schilder'])
        relevant = lambda jobs: [job for job in jobs if 'Financial' in job['title']]
        with mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={}), \
                mock.patch.object(found_boards.board_sections, 'read', return_value=([], None, False)):
            jobs = found_boards.read(SEARCH, [board], fetch=fetch, is_relevant=relevant, dead=set())
        self.assertEqual(sorted(job['title'] for job in jobs if 'Financial' in job['title']), ['Financial Analyst', 'Financial Controller', 'Financial Planner'])


    def test_a_read_cut_before_the_form_leaves_the_few_list_and_lets_the_next_search_try(self):
        entry = {'few_for': 'x'}
        before = ([{'title': 'Financial Analyst'}], 'ok', [{'title': 'Financial Analyst'}])
        with mock.patch.object(found_boards.board_forms, 'home', return_value=(HOME, form('<input name="SearchWhat">', method='post'))), \
                mock.patch.object(found_boards.read_budget, 'past_cut', return_value=True), \
                mock.patch.object(found_boards, '_section', side_effect=AssertionError('no page past the cut')):
            got = found_boards._fuller_section({**BOARD, 'search_url': self.LIST}, entry, self.LIST, SEARCH, lambda url: '', lambda jobs: jobs, before)
        self.assertEqual(got, before)
        self.assertNotIn('few_for', entry, 'not marked as tried: the next search tries its form')


GUESSED = 'https://vacatures.example/vacatures?q={role}&location={place}'
LEARNED = 'https://vacatures.example/zoeken?wat={role}&waar={place}'
SEARCH = {'jobs_board_search_queries': ['financial analyst'], 'role_keywords': ['financial analyst'],
          'locations': {'top_tier': ['amsterdam'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Vacatures', 'host': 'vacatures.example', 'search_url': GUESSED, 'countries': ['Netherlands'], 'kinds': ['any']}


def posting(title, n):
    job = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': title, 'url': f'https://vacatures.example/v/{n}',
           'hiringOrganization': {'@type': 'Organization', 'name': 'Acme'},
           'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Amsterdam', 'addressCountry': 'NL'}}}
    return f'<html><script type="application/ld+json">{json.dumps(job)}</script><body>x</body></html>'


class LearnedLinkTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)
        self.asked = []
        self.robots = ''

    def fetch(self, url):
        self.asked.append(url)
        if url.endswith('/robots.txt'):
            return self.robots
        if url == HOME:
            return form('<input name="wat"><input name="waar">')
        if url.startswith('https://vacatures.example/zoeken?'):
            return posting('Financial Analyst', 1)
        return posting('Magazijnmedewerker', 2)   # the guessed link: the board ignores its words

    def read(self):
        relevant = lambda jobs: [job for job in jobs if 'Financial' in job['title']]
        return found_boards.read(SEARCH, [BOARD], fetch=self.fetch, is_relevant=relevant, dead=set())

    def test_a_board_that_ignores_the_guessed_link_is_read_through_its_own_form_and_keeps_it(self):
        jobs = self.read()
        self.assertEqual([job['title'] for job in jobs], ['Financial Analyst'])
        from src.ai import board_ideas
        entry = board_ideas.load()['boards']['vacatures.example']
        self.assertEqual((entry['search_url'], entry['relevant']), (LEARNED, 1), 'kept: the pool share sends it (src/contribute.py)')
        self.asked.clear()
        with mock.patch.object(found_boards, '_retry_due', return_value=True), mock.patch.object(found_boards.board_yield, 'pick', lambda boards, *a, **k: boards):
            self.read()
        self.assertTrue(self.asked and self.asked[0].startswith('https://vacatures.example/zoeken?'), self.asked)
        self.assertNotIn(HOME, self.asked, 'learned once: the home page is not read again')

    def test_robots_txt_that_disallows_the_form_link_does_not_stop_it(self):
        self.robots = 'User-agent: *\nDisallow: /zoeken'
        self.read()
        self.assertIn('https://vacatures.example/zoeken?wat=financial+analyst&waar=amsterdam', self.asked)

    def test_a_board_with_no_form_is_checked_once_for_this_link(self):
        home = []
        def fetch(url):
            home.append(url) if url == HOME else None
            return '<html><body>none</body></html>' if url == HOME else posting('Magazijnmedewerker', 2)
        self.fetch = fetch
        with mock.patch.object(found_boards, '_retry_due', return_value=True), mock.patch.object(found_boards.board_yield, 'pick', lambda boards, *a, **k: boards):
            self.read()
            self.read()
        self.assertEqual(home, [HOME])

    def test_with_no_form_the_board_s_own_job_sitemap_is_read_and_kept_as_its_route(self):
        """18 Oct 2026: Randstad listed warehouse jobs for "financial analyst" in Amsterdam; its robots.txt names a job sitemap."""
        sitemap = ('<urlset><url><loc>https://vacatures.example/vaga/26051177-magazijnmedewerker</loc></url>'
                   '<url><loc>https://vacatures.example/vaga/26051178-financial-analyst</loc></url></urlset>')
        def fetch(url):
            self.asked.append(url)
            pages = {HOME: '<html><body>no form here</body></html>', 'https://vacatures.example/robots.txt': 'Sitemap: https://vacatures.example/jobs.xml',
                     'https://vacatures.example/jobs.xml': sitemap, 'https://vacatures.example/vaga/26051178-financial-analyst': posting('Financial Analyst', 78)}
            return pages.get(url, posting('Magazijnmedewerker', 2))
        self.fetch = fetch
        self.assertEqual([job['title'] for job in self.read() if 'Financial' in job['title']], ['Financial Analyst'])
        from src.ai import board_ideas
        entry = board_ideas.load()['boards']['vacatures.example']
        self.assertEqual((entry['route_kind'], entry['relevant'], entry['search_url']), ('sitemap', 1, GUESSED))
        self.asked.clear()
        with mock.patch.object(found_boards, '_retry_due', return_value=True), mock.patch.object(found_boards.board_yield, 'pick', lambda boards, *a, **k: boards):
            self.read()
        self.assertEqual(self.asked[0], 'https://vacatures.example/jobs.xml', 'its route is read first from then on')
        self.assertNotIn(HOME, self.asked)

    def test_a_job_list_that_refuses_us_leaves_the_board_readable(self):
        import urllib.error
        def fetch(url):
            if url == 'https://vacatures.example/robots.txt':
                return 'Sitemap: https://vacatures.example/jobs.xml'
            if url == 'https://vacatures.example/jobs.xml':
                raise urllib.error.HTTPError(url, 403, 'Forbidden', None, None)
            return '<html><body>no form</body></html>' if url == HOME else posting('Magazijnmedewerker', 2)
        self.fetch = fetch
        self.read()
        from src.ai import board_ideas
        entry = board_ideas.load()['boards']['vacatures.example']
        self.assertEqual((entry['state'], entry.get('route')), ('ok', None), 'the search page still answers: not marked for a visit')

    def _behind_a_refusal(self, answer):
        """The guessed link is a 404; the board's own search form is refused: the board ends as a visit, not as "0 jobs"."""
        import urllib.error

        def fetch(url):
            if url.endswith('/robots.txt'):
                return ''
            if url == HOME:
                return form('<input name="wat"><input name="waar">')
            if url.startswith('https://vacatures.example/zoeken?'):
                return answer(url)
            raise urllib.error.HTTPError(url, 404, 'Not Found', None, None)
        self.fetch = fetch
        self.read()
        from src.ai import board_ideas
        self.assertEqual(board_ideas.load()['boards']['vacatures.example']['state'], 'browser')

    def test_a_search_form_behind_a_bot_check_page_is_offered_as_a_visit_not_read_as_empty(self):
        """24 Oct 2026: a Luxembourg board's guessed link was a 404 and its own search form answered a "Challenge Validation" page: the ladder
        dropped that and the board showed "0 jobs" instead of "only your browser reads it". Every way up the ladder that is refused counts."""
        self._behind_a_refusal(lambda url: '<html><head><title>Challenge Validation</title><script src="/c.js"></script></head><body><iframe src="/c"></iframe></body></html>')

    def test_a_search_form_that_answers_403_is_offered_as_a_visit_not_read_as_empty(self):
        import urllib.error

        def forbidden(url):
            raise urllib.error.HTTPError(url, 403, 'Forbidden', None, None)
        self._behind_a_refusal(forbidden)

    def test_the_first_jobs_slice_never_reads_a_form(self):
        relevant = lambda jobs: [job for job in jobs if 'Financial' in job['title']]
        found_boards.read(SEARCH, [BOARD], fetch=self.fetch, is_relevant=relevant, dead=set(), early=True)
        self.assertNotIn(HOME, self.asked)


if __name__ == '__main__':
    unittest.main()
