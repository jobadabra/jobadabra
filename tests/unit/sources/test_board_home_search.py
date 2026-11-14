"""A board the AI names with no search link is read in the person's own Find jobs through its home page's own plain GET search (src/sources/board_home_search.py;
14 Nov 2026, owner: "yes" on sa's row "Board named without a link, never read"; measured by hand: Sofia +12-15 right jobs, Amsterdam +5, Ljubljana 0).
By construction only a GET form with text boxes and nothing personal is ever used: never a POST, an e-mail/phone/file/password box, a free-text box or a bot check.
Fake pages only; the AI page reader is off."""
import contextlib
import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from src.ai import board_ideas
from src.sources import board_forms, board_home_search, careers, found_boards

_READER = careers.READER
HOME = 'https://named.example/'
BOARD = {'name': 'Named', 'host': 'named.example', 'search_url': HOME, 'countries': ['Bulgaria'], 'kinds': ['any'], 'source_kind': 'general', 'home': True}
SEARCH = {'jobs_board_search_queries': ['welder'], 'role_keywords': ['welder'], 'locations': {'top_tier': ['sofia'], 'country_wide': [], 'abroad': []}}


def setUpModule():
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def posting(title, n):
    job = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': title, 'url': f'https://named.example/job/{n}',
           'hiringOrganization': {'@type': 'Organization', 'name': 'Acme'},
           'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Sofia', 'addressCountry': 'BG'}}}
    return f'<html><script type="application/ld+json">{json.dumps(job)}</script><body>x</body></html>'


def page(form, head=''):
    return f'<html><head>{head}</head><body>{form}</body></html>'


GET_FORM = page('<form action="/iskanje" method="get"><input name="q"><button>Search</button></form>')


class HomeSearch(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={}),
                      mock.patch.object(found_boards.board_yield, 'pick', lambda boards, *a, **k: boards),
                      mock.patch.object(found_boards, '_retry_due', return_value=True)):
            patch.start()
            self.addCleanup(patch.stop)
        found_boards._early.clear()
        self.addCleanup(found_boards._early.clear)
        self.asked, self.home, self.answer = [], GET_FORM, posting('Welder', 1)

    def fetch(self, url):
        self.asked.append(url)
        if url.endswith('/robots.txt'):
            return ''
        if url == HOME:
            if isinstance(self.home, Exception):
                raise self.home
            return self.home
        if '/kurs?' in url:
            return posting('Cooking course', 4)   # another search of the same page (courses): listed, none relevant
        if '/iskanje?' in url or '/search?' in url:
            return self.answer
        return posting('Production worker', 2)   # what the home page itself would give as a list: never read for a named board

    def read(self, board=BOARD, search=SEARCH):
        relevant = lambda jobs: [job for job in jobs if 'elder' in job['title']]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            jobs = found_boards.read(search, [board], fetch=self.fetch, is_relevant=relevant, dead=set())
        return [job['title'] for job in jobs], out.getvalue()

    def searched(self):
        return [url for url in self.asked if url != HOME and not url.endswith('/robots.txt')]

    def test_a_get_search_form_is_found_and_asked_with_the_role_word(self):
        titles, log = self.read()
        self.assertEqual(titles, ['Welder'])
        self.assertEqual(self.searched(), ['https://named.example/iskanje?q=welder'])
        self.assertIn('named without a search link: found its own search', log)
        self.assertIn('1 job(s) read', log)

    def test_a_second_text_box_takes_the_place(self):
        self.home = page('<form action="/search" method="get"><input name="what"><input name="where"></form>')
        self.read()
        self.assertEqual(self.searched(), ['https://named.example/search?what=welder&where=sofia'])

    def test_a_windows_1251_board_is_asked_in_its_own_charset(self):
        self.home = page('<form action="/search" method="get"><input name="kw"></form>', '<meta http-equiv="Content-Type" content="text/html; charset=windows-1251">')
        found = {**SEARCH, 'jobs_board_search_queries': ['шофьор'], 'role_keywords': ['шофьор']}
        self.read(BOARD, found)
        self.assertEqual(board_ideas.load()['boards']['named.example'].get('charset'), 'cp1251')   # kept for the board's next searches
        self.assertEqual(self.searched(), ['https://named.example/search?kw=%F8%EE%F4%FC%EE%F0'])   # cp1251 bytes, not the UTF-8 ones

    def test_a_post_only_form_is_skipped_and_the_home_page_is_not_read_as_a_list(self):
        self.home = page('<form action="/iskanje" method="post"><input name="q"></form>')
        titles, log = self.read()
        self.assertEqual((titles, self.searched()), ([], []))
        self.assertIn('no plain GET search on its home page', log)

    def test_a_form_with_no_method_is_a_get_form_but_one_with_a_personal_box_is_not_a_search(self):
        for personal in ('<input type="email" name="mail">', '<input type="tel" name="phone">', '<input type="file" name="cv">', '<input type="password" name="pw">'):
            with self.subTest(personal=personal):
                self.asked.clear()
                self.home = page(f'<form action="/iskanje"><input name="q">{personal}</form>')
                self.assertEqual(self.read()[0], [])
                self.assertEqual(self.searched(), [])

    def test_a_contact_form_with_a_free_text_box_or_a_bot_check_is_never_filled(self):
        for form in ('<form action="/kontakt" method="get"><input name="name"><textarea name="message"></textarea></form>',
                     '<form action="/kontakt" method="get"><input name="name"><input name="captcha_code"></form>',
                     '<form action="/kontakt" method="get"><input name="name"><div class="g-recaptcha"></div></form>'):
            with self.subTest(form=form[:60]):
                self.asked.clear()
                self.home = page(form)
                self.assertEqual(self.read()[0], [])
                self.assertEqual(self.searched(), [])

    def test_a_page_with_a_contact_form_and_a_search_form_uses_only_the_search_form(self):
        self.home = page('<form action="/kontakt" method="get"><input name="name"><textarea name="m"></textarea></form>'
                         '<form action="/iskanje" method="get"><input name="q"></form>')
        self.assertEqual(self.read()[0], ['Welder'])
        self.assertEqual(self.searched(), ['https://named.example/iskanje?q=welder'])

    def test_a_refused_home_page_is_asked_once_and_never_retried(self):
        self.home = urllib.error.HTTPError(HOME, 403, 'Forbidden', {}, None)
        titles, log = self.read()
        self.assertEqual(titles, [])
        self.assertEqual(self.asked.count(HOME), 1)
        self.assertEqual(self.searched(), [])
        self.assertIn('HTTP 403', log)

    def test_no_form_says_why_and_reads_nothing(self):
        self.home = page('<p>Jobs</p>')
        titles, log = self.read()
        self.assertEqual((titles, self.searched()), ([], []))
        self.assertIn('no plain GET search on its home page', log)

    def test_a_search_with_no_relevant_job_does_not_go_up_the_ladder(self):
        self.home = page('<form action="/kontakt" method="post"><input name="n"></form><form action="/iskanje" method="get"><input name="q"></form>')
        self.answer = posting('Cook', 3)   # the search answers, with no relevant job: the ladder (a POST form, a section, its feed, its list) would be next for any other board
        titles, _ = self.read()
        self.assertEqual(titles, ['Cook'])
        self.assertEqual(self.searched(), ['https://named.example/iskanje?q=welder'])

    def test_the_next_form_is_asked_when_the_first_gives_no_relevant_job(self):
        self.home = page('<form action="/kurs" method="get"><input name="q"><input name="from"><input name="to"></form><form action="/iskanje" method="get"><input name="q"></form>')
        titles, log = self.read()
        self.assertEqual(titles, ['Welder'])   # a courses search sorts first (more boxes): its listing is not the answer
        self.assertEqual(self.searched(), ['https://named.example/kurs?q=welder&from=sofia', 'https://named.example/iskanje?q=welder'])
        self.assertIn('found its own search (https://named.example/iskanje?q={role}), 1 job(s) read, 1 relevant', log)
        self.assertEqual(board_ideas.load()['boards']['named.example'].get('form_url'), 'https://named.example/iskanje?q={role}')

    def test_when_no_form_gives_a_relevant_job_the_fullest_listing_is_returned(self):
        self.home = page('<form action="/kurs" method="get"><input name="q"><input name="from"></form><form action="/iskanje" method="get"><input name="q"></form>')
        self.answer = posting('Cook', 3)
        titles, _ = self.read()
        self.assertEqual(len(self.searched()), 2)
        self.assertEqual(len(titles), 1)

    def test_the_form_is_remembered_for_the_next_search(self):
        board = dict(BOARD)
        self.read(board)
        entry = board_ideas.load()['boards']['named.example']
        self.assertEqual(entry.get('form_url'), 'https://named.example/iskanje?q={role}')


class Templates(unittest.TestCase):
    def test_plain_leaves_out_forms_that_are_not_a_search(self):
        for form in ('<form action="/x"><input name="q"><textarea name="t"></textarea></form>', '<form action="/x"><input name="q"><input name="recaptcha_response"></form>'):
            self.assertEqual(board_forms.templates(page(form), HOME, None, True, True), [])
            self.assertNotEqual(board_forms.templates(page(form), HOME), [])   # as before for every other reader (the app's own read, the Scout)

    def test_the_wanted_flag_is_only_for_a_named_board_with_no_role_in_its_link(self):
        self.assertTrue(board_home_search.wanted(BOARD))
        self.assertFalse(board_home_search.wanted({**BOARD, 'search_url': 'https://named.example/?q={role}'}))
        self.assertFalse(board_home_search.wanted({k: v for k, v in BOARD.items() if k != 'home'}))


class NamedBoards(unittest.TestCase):
    def test_the_proposal_hands_its_named_boards_to_the_person_s_search_only_when_asked(self):
        found = [{'name': 'Linked', 'host': 'linked.example', 'search_url': 'https://linked.example/?q={role}', 'countries': ['Bulgaria'], 'kinds': ['any'], 'source_kind': 'general'}]
        named = [{'name': 'Named', 'host': 'named.example', 'search_url': HOME, 'countries': ['Bulgaria'], 'kinds': ['any'], 'source_kind': 'general', 'home': True}]
        with mock.patch.object(board_ideas, 'slices', return_value=[('k', ['Bulgaria'])]), mock.patch.object(board_ideas, 'served', return_value=[]), \
                mock.patch.object(board_ideas, '_proposal', return_value=found), mock.patch.object(board_ideas, 'homes', return_value=named):
            self.assertEqual([b['host'] for b in board_ideas.ideas({}, field=False)], ['linked.example'])   # the Scout's call: unchanged
            self.assertEqual([b['host'] for b in board_ideas.ideas({}, field=False, named=True)], ['linked.example', 'named.example'])


if __name__ == '__main__':
    unittest.main()
