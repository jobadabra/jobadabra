"""A failed EURES page (src/sources/eures.py _pages, _ends_the_read): a timeout, a passing server error or a broken answer costs that page only and the read
goes on (#3689: sa's Lyon run listed 44 jobs where five runs of the same search listed 157-204, after "EURES: a page failed (TimeoutError), keeping the 50 read"
at 51 s); a refusal, a slow-down, a rejected request, an unreachable portal or a second failed page in a row ends the read and asks nothing again. Moved here from
tests/unit/sources/test_eures.py (500-line rule), with its fixture borrowed from there. No network."""
import http.client
import io
import unittest
import urllib.error
from unittest import mock

from src.sources import eures, host_pace
from tests.unit.sources import test_eures as fixture   # the module, not its EuresTest class: its own tests run in their own file
from tests.unit.sources.test_eures import jv, setUpModule, tearDownModule  # noqa: F401 (the page reader stays off)


class EuresPageFailureTest(unittest.TestCase):
    setUp = fixture.EuresTest.setUp   # temp stores, Eurostat's table, places resolved without the AI
    _read = fixture.EuresTest._read   # eures() with fixed region answers; `get` sees (location code, word, page)

    def read(self, get, wanted, **kwargs):
        """_read with the run log captured: (jobs, log)."""
        with mock.patch('sys.stdout', new_callable=io.StringIO) as out:
            found = self._read(get, wanted, **kwargs)
        return found, out.getvalue()

    def test_one_slow_page_costs_that_page_and_the_next_pages_and_areas_are_still_read(self):
        # #3689: a full page read, then a page times out; before, every page and area left was given up.
        asked = []

        def get(area, word, page):
            asked.append((area, page))
            if (area, page) == ('bg41', 2):
                raise TimeoutError('The read operation timed out')
            if area == 'bg41' and page == 1:   # a full page: 50 read before the slow one
                return {'jvs': [jv(f'near{n}', 'Teacher', 'BG411') for n in range(eures.PAGE_SIZE)]}
            return {'jvs': [jv(f'{area}{page}', 'Teacher', 'BG412')] if page == 3 or area == 'bg' else []}
        found, log = self.read(get, {'Sofia': ['BG41']}, words=('teacher',))
        self.assertEqual(asked, [('bg41', 1), ('bg41', 2), ('bg41', 3), ('bg', 1)], 'the page after the slow one and the next area are still asked')
        self.assertEqual(len(found), eures.PAGE_SIZE + 2, 'the 50 read before, the next page\'s job and the next area\'s')
        self.assertTrue(eures.CUT[0], 'a page was not read: the read waits for the next search, not marked read')
        self.assertIn('EURES: 1 page(s) failed (TimeoutError), keeping the 52 read; the others were read', log)

    def test_a_passing_server_error_or_a_broken_answer_costs_that_page_only(self):
        for failure in (urllib.error.HTTPError(eures.URL, 502, 'Bad Gateway', {}, None), ValueError('Expecting value'), http.client.IncompleteRead(b'')):
            def get(area, word, page):
                if (area, page) == ('bg41', 1):
                    raise failure
                return {'jvs': [jv('a', 'Teacher', 'BG411')] if area == 'bg' else []}
            with self.subTest(type(failure).__name__):
                found, _ = self.read(get, {'Sofia': ['BG41']})
                self.assertEqual(([job['id'] for job in found], eures.CUT[0]), (['eures:a'], True))

    def test_two_failed_pages_in_a_row_end_the_read(self):
        asked = []

        def get(area, word, page):
            asked.append((area, word))
            raise TimeoutError('The read operation timed out')
        found, log = self.read(get, {'Sofia': ['BG41']}, words=('one', 'two', 'three'))
        self.assertEqual(asked, [('bg41', 'one'), ('bg41', 'two')], 'a portal that hangs is not asked again and again until the stop time')
        self.assertEqual((found, eures.CUT[0]), ([], True), 'only timeouts: the read waits for the next search')
        self.assertIn('EURES: 2 page(s) failed (TimeoutError), keeping the 0 read; nothing more asked', log)

    def test_a_read_that_got_nothing_raises_its_first_failure_that_was_not_a_timeout(self):
        failures = iter([urllib.error.HTTPError(eures.URL, 502, 'Bad Gateway', {}, None), TimeoutError('slow')])

        def get(area, word, page):
            raise next(failures)
        with self.assertRaises(urllib.error.HTTPError):   # the source is reported as failed, never a silent 0
            self.read(get, {'Sofia': ['BG41']}, words=('one', 'two'))

    def test_a_refusal_a_slow_down_a_rejected_request_or_an_unreachable_portal_ends_the_read_with_no_retry(self):
        for refusal in (urllib.error.HTTPError(eures.URL, 401, 'Unauthorized', {}, None), urllib.error.HTTPError(eures.URL, 429, 'Too Many Requests', {}, None),
                        urllib.error.HTTPError(eures.URL, 503, 'Service Unavailable', {}, None), urllib.error.HTTPError(eures.URL, 400, 'Bad Request', {}, None),
                        host_pace.Busy(eures.URL, 0), urllib.error.URLError(ConnectionRefusedError('refused'))):
            asked = []

            def get(area, word, page):
                asked.append(area)
                if area == 'bg41':
                    raise refusal
                return {'jvs': [jv('a', 'Teacher', 'BG411')]}
            with self.subTest(f'{type(refusal).__name__} {getattr(refusal, "code", "")}'), self.assertRaises(type(refusal)):
                self.read(get, {'Sofia': ['BG41']}, words=('one', 'two'))
            self.assertEqual(asked, ['bg41'], 'nothing is asked after it')

    def test_a_refusal_after_jobs_were_read_keeps_them_and_asks_nothing_more(self):
        asked = []

        def get(area, word, page):
            asked.append(area)
            if area == 'bg':
                raise refusal
            return {'jvs': [jv('a', 'Teacher', 'BG411')]}
        for refusal in (urllib.error.HTTPError(eures.URL, 403, 'Forbidden', {}, None), host_pace.Busy(eures.URL, 0)):   # Busy: what a 429 past host_pace's own wait reaches a reader as
            asked.clear()
            found, log = self.read(get, {'Sofia': ['BG41']}, words=('one', 'two'))
            self.assertEqual((len(found), eures.CUT[0], asked), (1, True, ['bg41', 'bg41', 'bg']), 'the read ends on the refusal')
            self.assertIn('keeping the 1 read; nothing more asked', log)

    def test_a_page_that_times_out_while_connecting_keeps_what_was_read(self):
        def get(area, word, page):
            if area == 'bg':
                raise urllib.error.URLError(TimeoutError('timed out'))
            return {'jvs': [jv('a', 'Teacher', 'BG411')]}
        found, _ = self.read(get, {'Sofia': ['BG41']})
        self.assertEqual((len(found), eures.CUT[0]), (1, True))

    def test_a_first_page_that_times_out_waits_for_the_next_search(self):
        def get(area, word, page):
            raise TimeoutError('The read operation timed out')
        found, _ = self.read(get, {'Sofia': ['BG41']})
        self.assertEqual((found, eures.CUT[0]), ([], True))

    def test_a_read_that_reaches_its_most_after_a_failed_page_is_complete(self):
        def get(area, word, page):
            if area == 'bg41' and page == 1 and word == 'one':
                raise TimeoutError('slow')
            return {'jvs': [jv(f'{area}{word}{page}{n}', 'Teacher', 'BG411') for n in range(eures.PAGE_SIZE)]}
        found, _ = self.read(get, {'Sofia': ['BG41'], 'Plovdiv': ['BG42'], 'Varna': ['BG43']}, words=('one', 'two'))
        self.assertEqual((len(found), eures.CUT[0]), (eures.MOST, False), 'enough read: marked read, not queued again')


if __name__ == '__main__':
    unittest.main()
