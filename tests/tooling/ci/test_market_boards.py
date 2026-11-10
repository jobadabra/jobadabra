"""Guard: data + safety — the market count's national boards (tools/persona-search/market_boards.py) are the yardstick for six people EURES has nothing for: a board that refused
(401/403/429) or whose page no longer shows cards where its row says must read "not counted", never 0 jobs, and a refusal ends that board for the run with no retry (CLAUDE.md);
every request names itself honestly. Fakes only: no board is called here."""
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import market_boards as mb  # noqa: E402
from gate import PERSONAS  # noqa: E402

CARDS = {'card': {'class': 'job'}, 'skip': {'class': 'job--old'},
         'title': {'in': {'tag': 'h2'}}, 'company': {'in': {'tag': 'li', 'has': {'class': 'icon-work'}}},
         'location': {'in': {'attr': {'data-at': 'place'}}}, 'url': {'in': {'tag': 'a'}, 'take': '@href'}}


def card(i, old=False):
    return (f'<div class="job{" job--old" if old else ""}"><h2><a href="/j/{i}">Nurse {i}</a></h2><ul><li><i class="icon-work"></i> Clinic {i}</li>'
            f'<li data-at="place">Dublin</li></ul><img src="x.png"></div>')


def page(*cards_):
    return '<html><body><p>Results<br></p>' + ''.join(cards_) + '<script>var x = "<div class=job>";</script></body></html>'


class Cards(unittest.TestCase):
    def test_a_card_gives_title_employer_place_and_an_absolute_link_and_an_expired_card_is_skipped(self):
        rows = mb.cards(page(card(1), card(2, old=True), card(3)), CARDS, 'https://board.example/search?q=nurse')
        self.assertEqual(rows, [{'title': 'Nurse 1', 'company': 'Clinic 1', 'location': 'Dublin', 'url': 'https://board.example/j/1'},
                                {'title': 'Nurse 3', 'company': 'Clinic 3', 'location': 'Dublin', 'url': 'https://board.example/j/3'}])

    def test_a_page_state_gives_rows_from_its_path(self):
        state = {'list': {'results': [{'headline': 'Ingeniør', 'company': {'name': 'A/S'}, 'area': 'København', 'url': '/c?t=1'}, {'headline': ''}]}}
        shape = {'state': {'after': 'var Stash = ', 'path': 'list.results'}, 'title': 'headline', 'company': 'company.name', 'location': 'area', 'url': 'url'}
        rows = mb.cards(f'<script>var Stash = {json.dumps(state)};</script>', shape, 'https://board.example/')
        self.assertEqual(rows, [{'title': 'Ingeniør', 'company': 'A/S', 'location': 'København', 'url': 'https://board.example/c?t=1'}])

    def test_every_board_row_has_a_known_shape_and_serves_existing_people_once(self):
        served = [p for b in mb.BOARDS for p in b['people']]
        self.assertEqual(len(served), len(set(served)), 'one board per person')
        for board in mb.BOARDS:
            self.assertTrue(set(board['people']) <= {str(n) for n in range(1, len(PERSONAS) + 1)}, board['board'])
            self.assertIn('{role', board['search'])
            self.assertTrue(board['shape'].get('state') or board['shape'].get('card'), board['board'])


class Reading(unittest.TestCase):
    N = 7
    BOARD = {'board': 'board.example', 'people': {'7': 'dublin'}, 'search': 'https://board.example/jobs?q={role}&in={place}&page={page}', 'shape': CARDS}

    def setUp(self):
        patcher = mock.patch.object(mb, 'board_for', lambda n: self.BOARD if str(n) in self.BOARD['people'] else None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_with(self, answers):
        calls = []

        def fetch(url):
            calls.append(url)
            return answers[min(len(calls), len(answers)) - 1]
        got = mb.read(self.N, ['nurse', 'staff nurse'], fetch=fetch, sleep=lambda s: None)
        return got, calls

    def test_a_refusal_ends_the_board_for_the_run_unretried_and_is_not_counted(self):
        for code in (401, 403, 429):
            got, calls = self.run_with([(200, page(card(1))), (code, '')])
            self.assertEqual((got['status'], got['rows'], len(calls)), (f'not counted: refused {code}', [], 2))

    def test_a_page_without_cards_is_not_counted_never_zero(self):
        got, _ = self.run_with([(200, '<html><body>a changed page</body></html>')])
        self.assertEqual((got['status'], got['rows']), ('not counted: no cards', []))

    def test_no_answer_is_not_counted(self):
        got, calls = self.run_with([(0, '')])
        self.assertEqual((got['status'], len(calls)), ('not counted: no answer', 1))

    def test_pages_stop_at_the_cap_and_when_a_page_adds_nothing_new(self):
        pages = [(200, page(*[card(i) for i in range(p * 25, p * 25 + 25)])) for p in range(6)]
        got, calls = self.run_with(pages)
        self.assertEqual((got['status'], len(got['rows']), len(calls)), ('counted', mb.CAP, 4))
        got, calls = self.run_with([(200, page(card(1), card(2)))])
        self.assertEqual((len(got['rows']), len(calls)), (2, 3), 'page 2 repeats page 1: next word, which repeats too')

    def test_a_person_with_no_board_is_none_not_zero(self):
        self.assertEqual(mb.read(3, ['menuisier'], fetch=lambda url: self.fail('no board, no request'))['status'], 'none (no board)')


class Request(unittest.TestCase):
    def test_every_request_names_itself_and_carries_no_cookie(self):
        seen = []

        class Answer:
            status = 200
            headers = None

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return b'<meta charset="utf-8"><p>ok</p>'

        def opener(request, timeout):
            seen.append(request)
            return Answer()
        self.assertEqual(mb.fetch('https://board.example/', opener=opener), (200, '<meta charset="utf-8"><p>ok</p>'))
        self.assertEqual(seen[0].get_header('User-agent'), 'jobadabra-reference')
        self.assertIsNone(seen[0].get_header('Cookie'))

    def test_the_address_fills_role_place_and_page(self):
        board = {'search': 'https://b.example/jobs/{role_slug}/in-{place}?q={role}&page={page}', 'first_page': 1}
        self.assertEqual(mb.address(board, 'Staff Nurse', 'dublin', 1), 'https://b.example/jobs/staff-nurse/in-dublin?q=Staff+Nurse&page=2')
        self.assertEqual(mb.slug('Értékesítő munkatárs'), 'értékesítő-munkatárs')


if __name__ == '__main__':
    unittest.main()
