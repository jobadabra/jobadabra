"""A board round that timed out says which phase stalled, and the search's read cut is not told as a stalled site (src/sources/board_round_log.py).
Why (14 Nov 2026, sa, StepStone: 9 of 12 rounds read from CI printed "page not read (TimeoutError), 20 s"): the word did not say whether the site never
answered, answered and stopped sending, or the search had cut the read; 8 local rounds with the same word took 0 s (the read cut). Real local sockets
stand in for the slow site; no live site and no AI call here."""
import socket
import threading
import unittest
import urllib.error
from unittest import mock

from src.sources import ats, board_round_log, careers, found_boards

BOARD = {'name': 'Slow board', 'host': '127.0.0.1', 'search_url': 'http://127.0.0.1:{port}/jobs/{role}', 'countries': ['Austria'],
         'kinds': ['any'], 'source_kind': 'general'}
SEARCH = {'jobs_board_search_queries': ['elektriker'], 'role_keywords': ['electrician'], 'locations': {'top_tier': [], 'country_wide': [], 'abroad': []}}


class Stalling:
    """A local site that stalls: `mode` 'silent' accepts the connection and never answers; 'half' sends the headers and part of the page, then stops."""

    def __init__(self, mode):
        self.server = socket.socket()
        self.server.bind(('127.0.0.1', 0))
        self.server.listen(5)
        self.port, self.mode, self.held = self.server.getsockname()[1], mode, []
        threading.Thread(target=self.serve, daemon=True).start()

    def serve(self):
        while True:
            try:
                conn, _ = self.server.accept()
            except OSError:
                return
            self.held.append(conn)   # kept open and unanswered, so the reader's own socket timeout is what ends the wait
            if self.mode == 'half':
                conn.recv(4096)
                conn.sendall(b'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 100000\r\n\r\n<html>only the start')

    def close(self):
        self.server.close()
        for conn in self.held:
            conn.close()


class ARoundSaysWhichPhaseStalled(unittest.TestCase):
    def setUp(self):
        for patch in (mock.patch.object(careers, '_public', return_value=True), mock.patch.object(ats, 'TIMEOUT', 0.4)):
            patch.start()
            self.addCleanup(patch.stop)

    def round_line(self, fetch, board=BOARD):
        with mock.patch('builtins.print') as said:
            found_boards.read_board(board, SEARCH, fetch=fetch, early=True)
        return [str(c.args[0]) for c in said.call_args_list if c.args and ' round ' in str(c.args[0])]

    def stalled_site(self, mode):
        site = Stalling(mode)
        self.addCleanup(site.close)
        return {**BOARD, 'search_url': BOARD['search_url'].replace('{port}', str(site.port))}

    def test_a_site_that_never_answers_is_told_as_waiting_for_the_answer(self):
        lines = self.round_line(careers.get_text, self.stalled_site('silent'))
        self.assertEqual(len(lines), 1, lines)
        self.assertRegex(lines[0], r"page not read \(timed out waiting for the answer \(0\.4 s\)\)")

    def test_a_site_that_stops_sending_is_told_as_reading_the_page(self):
        lines = self.round_line(careers.get_text, self.stalled_site('half'))
        self.assertEqual(len(lines), 1, lines)
        self.assertRegex(lines[0], r"page not read \(timed out reading the page \(0\.4 s\)\)")

    def test_a_connection_that_is_never_made_is_told_as_connecting(self):
        def never_connects(request, timeout=15, **kwargs):
            raise urllib.error.URLError(TimeoutError('timed out'))
        with mock.patch.object(careers.host_pace, 'open', side_effect=never_connects):
            lines = self.round_line(careers.get_text)
        self.assertRegex(lines[0], r"page not read \(timed out connecting \(0\.4 s\)\)")

    def test_the_searchs_read_cut_is_not_told_as_a_stalled_site(self):
        """positive control: the cut still ends the read at once, with no page asked; only its word changed."""
        asked = []
        with mock.patch.object(found_boards.read_budget, 'past_cut', return_value=True):
            until = found_boards._until_cut(lambda url: asked.append(url))
            with self.assertRaises(TimeoutError) as raised:
                until('http://127.0.0.1/x')
        self.assertEqual(asked, [], 'no page is asked past the cut')
        self.assertEqual(board_round_log.why(raised.exception), "not asked, past the search's read cut")

    def test_a_stall_still_reads_as_a_timeout_and_a_url_error_to_every_caller(self):
        """The new word is a subclass of both, so a caller that catches either keeps working (positive control for the class)."""
        error = board_round_log.Stalled('waiting for the answer', 20)
        self.assertIsInstance(error, TimeoutError)
        self.assertIsInstance(error, urllib.error.URLError)
        self.assertEqual(board_round_log.why(ValueError('x')), 'ValueError')


if __name__ == '__main__':
    unittest.main()
