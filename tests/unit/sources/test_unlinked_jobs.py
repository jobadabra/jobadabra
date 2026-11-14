"""A job a listing page names with no link of its own keeps its own identity from the read to the Jobs list (src/job_identity.py unlinked_job_url).
Why (xc, 14 Nov 2026, baseline searches 43531583871/43531603203/43531622998): the AI page reader gave every link-less job the page as its address and
the board read keeps one job per address (LisboaUX 22 -> 1, Finance.nl 10 -> 1); a served layout gave `page#title`, whose fragment the store's URL key
dropped, so one row per page took every job and its title was overwritten (the Madrid electrician board 54 kept -> 8 new, prace.cz 56 -> 23).
One loop per path: the AI page reader's answer and a layout's title-only cards, each through the board read and the store."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src import read_methods, store  # noqa: E402
from src.job_identity import unlinked_job_url  # noqa: E402
from src.ai import page_reader  # noqa: E402
from src.sources import board_ai_read, careers, found_boards  # noqa: E402

PAGE = 'https://board.example/ofertas-empleo/electricista-empleos-en-madrid'
BOARD = {'host': 'board.example', 'name': 'Board Example', 'search_url': PAGE, 'countries': ['Spain']}
_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (the AI page reader's answer is given)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


TITLES = [f'Oficial Electricista {n}' for n in range(14)] + [f'Electricista Industrial {n}' for n in range(14)]   # 28 jobs, none with a "/"


def from_ai_reader(titles, employers=None):
    """The AI page reader's answer for a page whose jobs show no link of their own ("" as its schema allows)."""
    answer = [{'name': title, 'place': 'Madrid', 'link': '', 'employer': (employers or {}).get(title, '')} for title in titles]
    return page_reader.clean(answer, PAGE)


def from_layout(titles):
    """A served layout's (or a page recipe's) title-only cards: [(title, None)]."""
    return careers.listed([(title, None) for title in titles], PAGE, '<html><body></body></html>', lambda url: '')


def board_read(found):
    """The board read's way out (found_boards.read_board), its own reading stubbed to give `found` in the board's shape."""
    with mock.patch.object(found_boards, '_read', return_value=(board_ai_read._shaped(BOARD, found), 'ok', None)), \
            mock.patch.object(read_methods, '_finish', lambda *args: None):
        return found_boards.read_board(BOARD, {})[0]


def imported(db, jobs):
    return store.import_watch_report(db, {'jobs': [{**job, 'source': 'Job boards found', 'source_kind': 'job board'} for job in jobs]})


class UnlinkedJobsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = store.connect(os.path.join(self.tmp.name, 'jobs.db'))
        self.addCleanup(self.db.close)

    def test_every_link_less_job_of_a_page_reaches_the_jobs_list_once(self):
        for path, read in (('AI page reader', from_ai_reader), ('layout', from_layout)):
            with self.subTest(path=path):
                jobs = board_read(read(TITLES))
                self.assertEqual(len(jobs), 28, 'the board read keeps one job per address')
                statuses = imported(self.db, jobs)
                self.assertEqual(statuses.count('new'), 28)
                rows = self.db.execute('SELECT title FROM jobs').fetchall()
                self.assertEqual(sorted(row['title'] for row in rows), sorted(TITLES), 'one row per job, each with its own title')
                self.db.execute('DELETE FROM jobs')

    def test_the_same_jobs_read_again_in_another_order_are_the_same_rows(self):
        for path, read in (('AI page reader', from_ai_reader), ('layout', from_layout)):
            with self.subTest(path=path):
                imported(self.db, board_read(read(TITLES)))
                again = imported(self.db, board_read(read(list(reversed(TITLES)))))
                self.assertEqual(again.count('new'), 0, 'a list that reorders must not give the same job a new address')
                rows = self.db.execute('SELECT title, url FROM jobs').fetchall()
                self.assertEqual(len(rows), 28)
                self.assertEqual(sorted(row['title'] for row in rows), sorted(TITLES), 'no title overwritten by another job')
                self.db.execute('DELETE FROM jobs')

    def test_one_title_from_two_employers_on_one_page_is_two_jobs(self):
        employers = {'Electricista (Madrid)': 'Sop Seleccion'}
        one = from_ai_reader(['Electricista (Madrid)'], employers)[0]
        other = from_ai_reader(['Electricista (Madrid)'], {'Electricista (Madrid)': 'Grupo Proteccion'})[0]
        self.assertNotEqual(one['url'], other['url'])
        self.assertEqual(one['url'], from_ai_reader(['Electricista (Madrid)'], employers)[0]['url'], 'the same job, the same address')

    def test_one_title_from_one_employer_in_two_places_is_two_jobs(self):
        """sa, 14 Nov 2026: a staffing site is the employer of every card on its page, and an aggregator's cards carry the board as their company."""
        answer = [{'name': 'Electricista', 'place': town, 'link': '', 'employer': 'Staffing Example'} for town in ('Getafe', 'Alcobendas', 'Getafe')]
        jobs = board_read(page_reader.clean(answer, PAGE))
        self.assertEqual(sorted(job['location'] for job in jobs), ['Alcobendas', 'Getafe'], 'two places, two jobs; the same three values twice, one')
        self.assertEqual(imported(self.db, [{**job, 'company': 'Staffing Example'} for job in jobs]), ['new', 'new'],
                         'store.same_job tells two cities apart too, so the store agrees')

    def test_a_place_worded_two_ways_is_one_job_and_fields_never_run_together(self):
        """Gitar on #4183: the AI words a place freely ('Madrid' one read, 'Madrid, España' the next), and an employer, title and place flattened
        into one word list let the title 'Dev Madrid' be the title 'Dev' in 'Madrid'."""
        self.assertEqual(unlinked_job_url(PAGE, 'Electricista', 'Acme', 'Madrid'), unlinked_job_url(PAGE, 'Electricista', 'Acme', 'Madrid, España'))
        self.assertEqual(unlinked_job_url(PAGE, 'Técnico', '', 'Málaga'), unlinked_job_url(PAGE, 'Tecnico', '', 'malaga'))
        self.assertNotEqual(unlinked_job_url(PAGE, 'Dev Madrid'), unlinked_job_url(PAGE, 'Dev', '', 'Madrid'))
        self.assertNotEqual(unlinked_job_url(PAGE, 'Sales Rep', 'Acme'), unlinked_job_url(PAGE, 'Acme Sales Rep'))

    def test_titles_in_any_script_and_with_symbols_keep_their_own_address(self):
        """xc, 14 Nov 2026: folding accents by dropping every non-ASCII letter gave every Cyrillic, Greek or Chinese title the same empty address
        (`#job:----`), so a Chisinau board's link-less jobs became one again, and 'C++' and 'C#' became 'c'."""
        titles = ['Инженер-программист', 'Бухгалтер', 'Λογιστής', '软件工程师', 'C++ Developer', 'C# Developer', 'C Developer']
        addresses = [unlinked_job_url(PAGE, title, '', 'Кишинёв') for title in titles]
        self.assertEqual(len(set(addresses)), len(titles), 'one address per job, whatever its script')
        self.assertEqual(unlinked_job_url(PAGE, 'Бухгалтер', '', 'Кишинёв'), unlinked_job_url(PAGE, 'бухгалтер', '', 'Кишинев'), 'case and accents still fold')
        self.assertTrue(all(address.isascii() for address in addresses), 'the address stays plain ASCII for every store, log and link')
        self.assertEqual(unlinked_job_url(PAGE, 'Oficial de 1ª Electricista', 'Grupo Proteccion', 'Madrid, España'),
                         f'{PAGE}#job:grupo-proteccion--oficial-de-1a-electricista--madrid', 'a Latin title keeps the address the search pair measured')
        jobs = board_read(page_reader.clean([{'name': title, 'place': 'Кишинёв', 'link': '', 'employer': ''} for title in titles], PAGE))
        self.assertEqual(imported(self.db, jobs).count('new'), len(titles))

    def test_a_job_with_its_own_link_keeps_it(self):
        link = 'https://board.example/oferta/123/oficial-electricista'
        ai = page_reader.clean([{'name': 'Oficial Electricista', 'place': 'Madrid', 'link': link, 'employer': ''}], PAGE)[0]
        self.assertEqual((ai['url'], ai['id']), (link, link))
        with mock.patch.object(careers, 'jsonld_jobs', return_value=[]), mock.patch.object(careers, 'job_from_page', return_value={}):
            layout = careers.listed([('Oficial Electricista', link)], PAGE, '<html></html>', lambda url: '<html></html>')[0]
        self.assertEqual((layout['url'], layout['id']), (link, link))
        self.assertEqual(imported(self.db, board_read([ai])), ['new'])
        self.assertEqual(self.db.execute('SELECT url FROM jobs').fetchone()['url'], link)


if __name__ == '__main__':
    unittest.main()
