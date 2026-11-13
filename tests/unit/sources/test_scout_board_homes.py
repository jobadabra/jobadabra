"""Board discovery's boards the AI named only by their home page (src/scout_board_homes.py): read through their own search form, kept only
when the form link gives local jobs, and a home page that refuses is asked once."""
import sqlite3
import unittest
import urllib.error
from unittest import mock

from src import scout_board_homes, scout_boards, scout_cells
from src.sources import board_forms, careers

FORM = 'https://home.md/find?what={role}'


def home(host='home.md'):
    return {'name': host, 'host': host, 'search_url': f'https://{host}/', 'countries': ['Moldova'], 'kinds': ['any'], 'source_kind': 'general', 'home': True}


def job(place, number=0):
    return {'title': 'Developer', 'location': place, 'url': f'https://x/{place}/{number}'}


class HomeBoardsTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        scout_cells.keep(self.db, [{'countries': [c]} for c in scout_cells.EUROPE if c != 'md' for _ in range(5)])   # Moldova: the thinnest
        self.fetched, self.read, self.templates = [], [], [FORM]
        patches = [mock.patch.object(scout_boards.pool_tags, 'countries_each', lambda texts: ({t: {'md'} if 'Chi' in t else set() for t in texts}, [])),
                   mock.patch.object(scout_boards.pool_tags, 'families_each', lambda titles: ({t: ['software_dev'] for t in titles}, [])),
                   mock.patch.object(careers, 'get_text', self.fetch),
                   mock.patch.object(board_forms, 'home_templates', lambda board, fetch, page=None: list(self.templates))]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def fetch(self, url):
        self.fetched.append(url)
        return '<form></form>'

    def run_pass(self, reads, boards=None):
        out = []

        def read_board(item, search, fetch):
            self.read.append(item['search_url'])
            return reads.get(item['search_url'], ([], 'empty', None))
        got = scout_boards.run(self.db, ideas=lambda search: [], homes=lambda search: boards or [home()], read_board=read_board, out=out.append,
                               google=lambda db, country, kinds, out: [])
        return got, out

    def test_a_home_page_board_is_kept_with_its_form_link_when_that_gives_local_jobs(self):
        got, out = self.run_pass({FORM: ([job('Chisinau', n) for n in range(3)], 'ok', None)})
        self.assertEqual([(f['host'], f['url'], f['local_jobs']) for f in got], [('home.md', FORM, 3)])
        self.assertEqual(self.fetched, ['https://home.md/'], 'the home page is fetched once')
        self.assertIn('Board pass: home.md is read through its own search form', out)

    def test_a_form_link_without_local_jobs_is_not_kept_and_the_page_is_read_as_it_is(self):
        got, _ = self.run_pass({FORM: ([job('Berlin', n) for n in range(9)], 'ok', None)})   # try 1's course search: a form, no local jobs
        self.assertEqual(got, [])
        self.assertEqual(self.read, [FORM, 'https://home.md/'])

    def test_a_home_page_that_lists_local_jobs_itself_is_kept_as_the_page(self):
        self.templates = []
        got, _ = self.run_pass({'https://home.md/': ([job('Chisinau', n) for n in range(4)], 'ok', None)})
        self.assertEqual([(f['url'], f['local_jobs']) for f in got], [('https://home.md/', 4)])

    def test_a_home_page_that_refuses_is_asked_once_and_no_form_link_is_read(self):
        def refuse(url):
            self.fetched.append(url)
            raise urllib.error.HTTPError(url, 403, 'Forbidden', None, None)
        seen = []
        with mock.patch.object(careers, 'get_text', refuse):
            got = scout_boards.run(self.db, ideas=lambda search: [], homes=lambda search: [home()], out=lambda line: None,
                                   read_board=lambda item, search, fetch: self.read.append(item['search_url']) or ([], 'empty', None),
                                   google=lambda db, country, kinds, out: [], browser=lambda board, search: seen.append(board['host']))
        self.assertEqual((got, self.fetched, self.read), ([], ['https://home.md/'], []))
        self.assertEqual(seen, ['home.md'], 'the refusal goes to the pass\'s one browser step, as any refused board does')

    def test_a_form_link_that_refuses_ends_the_plain_read(self):
        from src.sources import board_yield
        self.templates = [FORM, 'https://home.md/other?q={role}']
        self.run_pass({FORM: ([], board_yield.Needs('HTTP 403'), None)})
        self.assertEqual(self.read, [FORM])

    def test_a_fake_proposal_brings_no_kept_home_boards_and_the_default_reads_the_proposals_own(self):
        with mock.patch.object(scout_board_homes.board_ideas, 'homes', lambda search: [home('kept.md')]):
            self.assertEqual(scout_board_homes.named({}, ideas=lambda search: []), [])
            self.assertEqual([b['host'] for b in scout_board_homes.named({})], ['kept.md'])


if __name__ == '__main__':
    unittest.main()
