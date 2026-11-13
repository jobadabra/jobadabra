"""A job board's read says what each round asked and found (src/sources/board_round_log.py): one line per search word and place, with the
page's jobs, the new ones and how the page was read, or why it was not read. Benchmark 13 Nov 2026: alo.bg gave 25 jobs in one run and 0 in the
next on the same code and the log could not say which round gave what. No AI call and no live site here."""
import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from src.sources import board_round_log, careers, found_boards

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'jobs_board_search_queries': ['menuisier', 'charpentier'], 'role_keywords': ['carpenter'],
          'locations': {'top_tier': ['Brussels'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Board 1', 'host': 'b1.example', 'search_url': 'https://b1.example/?q={role}', 'countries': ['Belgium'],
         'kinds': ['any'], 'source_kind': 'general'}


def page(*urls):
    postings = [{'@context': 'https://schema.org', '@type': 'JobPosting', 'title': 'Menuisier', 'url': url,
                 'hiringOrganization': {'@type': 'Organization', 'name': 'Atelier'},
                 'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Brussels', 'addressCountry': 'BE'}}} for url in urls]
    return f'<html><script type="application/ld+json">{json.dumps(postings)}</script><body>x</body></html>'


class EachRoundSaysWhatItFound(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)

    def lines(self, fetch):
        with mock.patch('builtins.print') as said:
            jobs, state, _ = found_boards.read_board(BOARD, SEARCH, fetch=fetch, early=True)
        return jobs, state, [str(c.args[0]) for c in said.call_args_list if c.args and ' round ' in str(c.args[0])]

    def test_each_round_names_its_words_and_counts_its_jobs(self):
        pages = {'menuisier': page('https://b1.example/1', 'https://b1.example/2'), 'charpentier': page('https://b1.example/2', 'https://b1.example/3')}
        jobs, state, lines = self.lines(lambda url: pages[url.split('q=')[1]])
        self.assertEqual(state, 'ok')
        self.assertEqual(len(jobs), 3, 'positive control: the read itself is unchanged')
        self.assertEqual(len(lines), 2, lines)
        self.assertRegex(lines[0], r"^Job boards: Board 1 round 'menuisier': 2 job\(s\) on the page, 2 new, \d+ s · https://b1\.example/\S*menuisier\S*$")
        self.assertRegex(lines[1], r"^Job boards: Board 1 round 'charpentier': 2 job\(s\) on the page, 1 new, \d+ s · https://b1\.example/\S*charpentier\S*$")

    def test_a_round_whose_page_was_not_read_says_why(self):
        def fetch(url):
            if 'menuisier' in url:
                raise urllib.error.HTTPError(url, 404, 'Not Found', {}, None)
            return page('https://b1.example/3')
        jobs, _, lines = self.lines(fetch)
        self.assertEqual([job['url'] for job in jobs], ['https://b1.example/3'])
        self.assertRegex(lines[0], r"^Job boards: Board 1 round 'menuisier': page not read \(HTTP 404\), \d+ s · https://b1\.example/\S*menuisier\S*$")
        self.assertRegex(lines[1], r"^Job boards: Board 1 round 'charpentier': 1 job\(s\) on the page, 1 new, \d+ s · https://b1\.example/\S*charpentier\S*$")


    def test_the_full_reads_next_pages_are_counted_apart_from_the_page(self):
        """The full read adds the next result pages to the round (board_pages.more): "on the page" stays the first page's count (Gitar, #3952)."""
        more = [{'id': f'https://b1.example/p2-{k}', 'title': 'Menuisier', 'url': f'https://b1.example/p2-{k}', 'employer': 'Atelier', 'location': 'Brussels'}
                for k in range(3)]   # the page reader's raw shape, before _shaped
        with mock.patch.object(found_boards.board_pages, 'more', side_effect=lambda *a, **k: more) as next_pages:
            _, _, lines = self.lines_full(lambda url: page('https://b1.example/1', 'https://b1.example/2'))
        self.assertTrue(next_pages.called, 'positive control: the full read asked for the next pages')
        self.assertRegex(lines[0], r"^Job boards: Board 1 round 'menuisier': 2 job\(s\) on the page \(5 with its next pages\), 5 new, \d+ s · https://b1\.example/\S*menuisier\S*$")

    def lines_full(self, fetch):
        with mock.patch('builtins.print') as said:
            jobs, state, _ = found_boards.read_board(BOARD, SEARCH, fetch=fetch, early=False)
        return jobs, state, [str(c.args[0]) for c in said.call_args_list if c.args and ' round ' in str(c.args[0])]


if __name__ == '__main__':
    unittest.main()


class TheLineSaysWhereTheSecondsWent(unittest.TestCase):
    """sa, 13 Nov 2026: a board's first page took 18 to 93 s in the benchmark and the line could not say which part took them."""

    def line(self, clock, names):
        from src.sources import board_round_log
        with mock.patch.object(board_round_log.time, 'monotonic', side_effect=clock), mock.patch('builtins.print') as said:
            parts = board_round_log.Parts()
            for name in names:
                with parts.part(name):
                    pass
            board_round_log.said(BOARD, 'menuisier', '', 0.0, [], [], parts=parts)
        return said.call_args[0][0]

    def test_parts_of_a_second_and_more_are_named_in_order_and_short_ones_left_out(self):
        line = self.line([0, 2, 2, 33, 33, 33.4, 40], ['page', '19 job pages', 'postings'])
        self.assertIn(', 40 s (page 2 s · 19 job pages 31 s)', line)
        self.assertNotIn('postings', line)

    def test_a_round_with_no_long_part_ends_at_its_seconds(self):
        self.assertTrue(self.line([5], []).endswith(', 5 s'))

    def test_a_board_read_hands_its_parts_to_the_page_reader(self):
        seen = []
        with mock.patch.object(careers, 'read_page_from', side_effect=lambda markup, url, fetch, part=None: seen.append(part) or []), \
                mock.patch('builtins.print'):
            found_boards.read_board(BOARD, SEARCH, fetch=lambda url: '<html><body><a href="/x">x</a></body></html>', early=True)
        self.assertTrue(seen and all(callable(part) for part in seen))


class EachWayOfTheLadderSaysWhatItListed(unittest.TestCase):
    """Why (13 Nov 2026, sa): the log named only the way that worked; a board that spent 40 s over ways that gave nothing looked like any other."""

    def run_ladder(self, ai_read, clock):
        ladder, said, board = board_round_log.Ladder, [], {**BOARD, 'search_url': 'https://b1.example/?q={role}&sector=7'}   # an extra filter in the link: the bare read runs
        patches = [mock.patch.object(found_boards.board_round_log, 'Ladder', lambda one: ladder(one, clock)),
                   mock.patch('builtins.print', side_effect=lambda *a, **k: said.append(' '.join(map(str, a)))),
                   mock.patch.object(found_boards, 'read_board', lambda *a, **k: ([], 'empty', [])),
                   mock.patch.object(found_boards, '_read_by_ai', return_value=ai_read),
                   mock.patch.object(found_boards.board_forms, 'home', return_value=('', '')),
                   mock.patch.object(found_boards.board_form_read, 'through_forms', return_value=[]),
                   mock.patch.object(found_boards, '_section', return_value=([], None, False)),
                   mock.patch.object(found_boards.board_routes, 'discover', return_value=([], None)),
                   mock.patch.object(found_boards, '_rendered', return_value=None),
                   mock.patch.object(found_boards.read_budget, 'past_cut', return_value=False)]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        found_boards._another_way(board, {}, board['search_url'], SEARCH, lambda *a, **k: '', lambda jobs: [], ([{'title': 'x', 'url': 'u'}], 'ok', []))
        return [line for line in said if "way '" in line]

    def test_every_way_that_ran_says_its_jobs_and_seconds_in_the_order_it_ran(self):
        ticks = iter(range(0, 200, 7))   # each reading of the clock is 7 s after the last
        lines = self.run_ladder([{'title': 'a', 'url': 'a'}], lambda: next(ticks))
        self.assertEqual([line.split("way '")[1].split("'")[0] for line in lines], ['bare link', 'AI page reader', 'search form', 'own section', 'own job list'])
        self.assertIn("way 'bare link': 0 job(s) listed, 7 s (ladder 7 s)", lines[0])
        self.assertIn("way 'AI page reader': 1 job(s) listed, 7 s (ladder 14 s)", lines[1])

    def test_a_way_that_did_not_run_says_nothing(self):
        said = []
        with mock.patch('builtins.print', side_effect=lambda *a, **k: said.append(a)):
            board_round_log.Ladder(BOARD).did('bare link', None)
        self.assertEqual(said, [])
