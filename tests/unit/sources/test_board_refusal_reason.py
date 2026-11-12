"""A job board that refuses the plain reader keeps why, in fixed words (src/sources/board_yield.py refusal/record), and the run's "Job boards found"
line says it, so a round counts refusals by reason from the stored state without asking any site again (owner via sa, 12 Nov 2026). A page built
by scripts with no browser here to run them is marked for a visit too: it says so, not a refusal."""
import contextlib
import json
import io
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src.ai import board_ideas  # noqa: E402
from src.sources import board_yield, careers, found_boards  # noqa: E402

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER

SEARCH = {'jobs_board_search_queries': ['programador'], 'role_keywords': ['developer'],
          'locations': {'top_tier': ['Lisboa'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Empregos', 'host': 'empregos.example', 'search_url': 'https://empregos.example/procura?q={role}&local={place}',
         'countries': ['Portugal'], 'kinds': ['any']}
SHELL = '<html><body><div id="app"></div><script src="/app.js"></script></body></html>'   # a page its scripts fill: no job in the HTML
JOB = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': 'Programador Python', 'url': 'https://empregos.example/oferta/1',
       'hiringOrganization': {'@type': 'Organization', 'name': 'Acme Lda'},
       'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Lisboa', 'addressCountry': 'PT'}}, 'datePosted': '2026-11-12'}
DRAWN = f'<html><script type="application/ld+json">{json.dumps(JOB)}</script><body>Programador Python</body></html>'   # the same page after its scripts ran


class RefusalReasonTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={}),
                      mock.patch.object(careers, 'RENDER', None),
                      mock.patch.dict(careers.REFUSALS, clear=True)):
            patch.start()
            self.addCleanup(patch.stop)

    def _read(self, fetch):
        said = io.StringIO()
        with contextlib.redirect_stdout(said):
            found_boards.read(SEARCH, [BOARD], fetch=fetch)
        entry = board_ideas.load()['boards'][BOARD['host']]
        return entry, [line for line in said.getvalue().splitlines() if line.startswith('Job boards found: Empregos ')]

    def test_a_refused_read_keeps_and_says_its_http_status(self):
        for code in (401, 403):
            with self.subTest(code=code):
                careers.REFUSALS.clear()
                board_ideas.save({})
                def refuse(url, code=code):
                    raise urllib.error.HTTPError(url, code, 'Refused', None, None)
                entry, lines = self._read(refuse)
                self.assertEqual((entry['state'], entry['refused']), ('browser', f'HTTP {code}'))
                self.assertIn(f'(refuses automated reading, HTTP {code}: offered as a visit)', lines[-1])

    def test_a_script_built_page_with_no_browser_says_so_and_is_no_refusal(self):
        entry, lines = self._read(lambda url: SHELL)
        self.assertEqual((entry['state'], entry['refused']), ('browser', 'a page built by scripts'))
        self.assertIn('(refuses automated reading, a page built by scripts: offered as a visit)', lines[-1])
        self.assertEqual(careers.REFUSALS, {}, 'never listed with the sites that refused us')

    def test_a_page_read_after_its_scripts_ran_keeps_no_reason(self):
        jobs, state, _ = found_boards.read_board(BOARD, SEARCH, fetch=lambda url: SHELL, show=lambda url: DRAWN)   # a browser here: read, not a visit
        self.assertEqual((state, [job['title'] for job in jobs]), ('ok', ['Programador Python']))

    def test_a_timeout_keeps_no_reason(self):
        def timeout(url):
            raise urllib.error.URLError(TimeoutError('timed out'))
        entry, lines = self._read(timeout)
        self.assertNotEqual(entry['state'], 'browser')
        self.assertNotIn('refused', entry)
        self.assertFalse(any('refuses automated reading' in line for line in lines), lines)

    def test_the_reason_is_the_marking_reads_own_never_an_earlier_one(self):
        """Gitar on #3895: careers.REFUSALS keeps every refusal of the process; an earlier one on this host must not name a later read's reason."""
        careers.REFUSALS[BOARD['host']] = 'HTTP 401'   # e.g. the scout's read of the same host, earlier in this process
        entry, lines = self._read(lambda url: SHELL)
        self.assertEqual(entry['refused'], 'a page built by scripts')

    def test_only_fixed_words_are_kept_and_an_old_board_reads_unknown(self):
        class Refused(Exception):   # a reader's own refusal (src/sources/render.py, describe.py)
            pass
        said = lambda error: board_yield.refused(error).why
        self.assertEqual(said(urllib.error.HTTPError('https://x.example/', 403, 'Forbidden', None, None)), 'HTTP 403')
        self.assertEqual(said(Refused('bot check page')), 'a bot check page')
        self.assertEqual(said(Refused('Access denied by Example Shield <b>ref 1234</b>')), 'unknown', 'never a page\'s or a vendor\'s words')
        self.assertEqual(said(None), 'unknown', 'a stop with no cause kept')
        self.assertEqual(board_yield.scripted(), 'browser', 'every reader of the state sees a plain browser state')
        entry = {'state': 'browser'}   # stored before reasons were kept
        self.assertEqual(board_yield.refused_why(entry), 'unknown')
        board_yield.record(entry, 0, 0, 'browser')   # a step that rebuilt a plain 'browser'
        self.assertEqual(entry['refused'], 'unknown')
        board_yield.record(entry, 3, 1, 'ok')   # it lists jobs now: no reason is left behind
        self.assertNotIn('refused', entry)


if __name__ == '__main__':
    unittest.main()
