"""A careers page's numbered pages, and its job links over its menu links (src/sources/careers.py; 6 Oct 2026: Migros, 1,335 jobs over 67 pages,
read as 36 menu links: "Trainee", "Nachwuchsprogramme")."""
import unittest
import json
import sqlite3
import tempfile
from types import SimpleNamespace
from pathlib import Path
import sys
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src.sources import careers, careers_parse  # noqa: E402

BASE = 'https://jobs.example.ch/de/offene-stellen'


def listing(page, count=5, pages=4):
    menu = ''.join(f'<a href="/de/karriere/{word}">{word}</a>' for word in ('trainee', 'lehre', 'nachwuchs', 'kultur'))
    jobs = ''.join(f'<a href="/de/job/acme/vendeur/{page:04d}{i:04d}-aaaa-bbbb-cccc-dddddddddddd">Vendeur {page}.{i}</a>' for i in range(count))
    numbers = ''.join(f'<a href="{BASE}?page={n}">{n}</a>' for n in range(2, pages + 1))
    return f'<html><body><nav>{menu}</nav>{jobs}{numbers}</body></html>'


class PagingTests(unittest.TestCase):
    def test_job_links_ending_in_an_id_win_over_the_menu(self):
        links = careers.job_links(listing(1), BASE)
        self.assertEqual(len(links), 5)
        self.assertTrue(all('/job/' in link for link in links))

    def test_numbered_pages_are_read_in_order_until_one_brings_nothing_new(self):
        pages = {BASE: listing(1), f'{BASE}?page=2': listing(2), f'{BASE}?page=3': listing(2), f'{BASE}?page=4': listing(4)}
        def get(url):
            if url in pages:
                return pages[url]
            title = url.rsplit('/', 1)[1]
            return f'<html><head><title>Vendeur {title}</title></head><body><h1>Vendeur {title}</h1></body></html>'
        with mock.patch.object(careers, 'get_text', get), mock.patch.object(careers, 'renderer', lambda: None), \
                mock.patch.object(careers, '_asked', lambda url, markup, jobs, fetch: jobs):
            self.assertEqual(careers.page_links(BASE, listing(1)), [f'{BASE}?page={n}' for n in (2, 3, 4)])
            jobs = careers.fetch(careers.encode(BASE), sleep=lambda s: None)
        self.assertEqual(len(jobs), 10, 'page 1 and 2; page 3 repeats page 2, so page 4 is never asked')

    def test_at_most_max_list_pages(self):
        self.assertEqual(len(careers.page_links(BASE, listing(1, pages=200))), careers.MAX_LIST_PAGES - 1)

    def test_pages_named_by_an_offset_or_a_path_word_are_found_by_their_numbers(self):
        """24 Oct 2026: a Tallinn accountant's finance section (cv.ee, ?offset=20,40,...) and a Zagreb nurse's health section (posao.hr, /stranica/1,2,3...)
        gave their first page only: no name of ours matched the paging link. A run of numbers in one step, from one or two steps off zero, is paging."""
        offset = ''.join(f'<a href="{BASE}?offset={n}">{n}</a>' for n in (20, 40, 60, 80))
        self.assertEqual(careers.page_links(BASE, f'<html>{offset}</html>'), [f'{BASE}?offset={n}' for n in (20, 40, 60, 80)])
        words = ''.join(f'<a href="{BASE}/stranica/{n}">{n}</a>' for n in (1, 2, 3, 34))
        self.assertEqual(careers.page_links(BASE, f'<html>{words}</html>'), [f'{BASE}/stranica/{n}' for n in (2, 3)])

    def test_filters_and_categories_are_not_pages(self):
        menu = ''.join(f'<a href="{BASE}?category={n}">c{n}</a>' for n in (7, 12, 31)) + f'<a href="{BASE}/stranica/9">x</a>'
        self.assertEqual(careers.page_links(BASE, f'<html>{menu}</html>'), [])

    def test_job_links_with_the_id_before_the_employer_and_title_are_all_job_pages(self):
        """24 Oct 2026: a finance section linked 20 jobs as /vacancy/<id>/<employer>/<title>; only the 3 whose title slug was 16+ letters counted as ending in an id."""
        words = ('analyst', 'accountant', 'controller', 'bookkeeper', 'auditor', 'treasurer')
        cards = ''.join(f'<a href="/vacancy/{1660000 + n}/employer-{n}/{word}">{word}</a>' for n, word in enumerate(words))
        menu = '<a href="/jobs">Jobs</a><a href="/vacancy/search">Search</a>'
        found = careers.job_links(f'<html>{menu}{cards}</html>', BASE)
        self.assertEqual(len(found), len(words))
        self.assertTrue(careers_parse.has_job_ids(f'<html>{cards}</html>', BASE))
        self.assertFalse(careers_parse.has_job_ids(f'<html>{menu}</html>', BASE))


class CandidateLinksTests(unittest.TestCase):
    """Id-shaped candidates still need the same AI verdict; menu links need no verdict once those jobs win."""

    def setUp(self):
        from src.ai import decide, page_words
        self.decide, self.page_words = decide, page_words
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.requests = []
        self.answers = lambda text: 'job_page' if 'role' in text else 'not_jobs'
        self.db = Path(self.tmp.name) / 'decisions.sqlite'
        self.client = SimpleNamespace(messages=SimpleNamespace(create=self.create))
        for patch in (mock.patch.object(page_words, 'ai_on', return_value=True),
                      mock.patch.object(decide, '_db', lambda: sqlite3.connect(self.db)),
                      mock.patch.object(decide.engine, 'ready', return_value=True),
                      mock.patch.object(decide.engine, 'client', return_value=self.client),
                      mock.patch.object(decide.engine, 'structured', return_value={}),
                      mock.patch.object(decide.cost, 'side'), mock.patch('src.ai.meanings_pack.first', return_value=None),
                      mock.patch('src.ai.meanings_pack.queue')):
            patch.start()
            self.addCleanup(patch.stop)
        decide.reset_run()
        self.addCleanup(decide.reset_run)

    def create(self, **request):
        items = [part.split('\n', 1)[1].strip() for part in request['messages'][0]['content'].split('### Item ')[1:]]
        self.requests.append(items)
        body = json.dumps({str(n): self.answers(text) for n, text in enumerate(items)})
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=body)], usage=None)

    def test_confirmed_job_ids_skip_menu_classification_and_keep_all_jobs(self):
        menu = ''.join(f'<a href="/section/{n}">Menu {n}</a>' for n in range(120))
        cards = ''.join(f'<a href="/vacancy/{100000 + n}">Role {n}</a>' for n in range(5))
        found = careers.job_links(menu + cards, BASE)
        self.assertEqual(found, [f'https://jobs.example.ch/vacancy/{100000 + n}' for n in range(5)])
        self.assertEqual([len(items) for items in self.requests], [5], 'one small AI request, with no menu links, instead of three 50-item batches')

    def test_rejected_numbered_news_links_fall_back_to_the_jobs_without_ids(self):
        news = ''.join(f'<a href="/article/{100000 + n}">News {n}</a>' for n in range(3))
        cards = '<a href="/open/role-a">Role A</a><a href="/open/role-b">Role B</a>'
        found = careers.job_links(news + cards, BASE)
        self.assertEqual(found, ['https://jobs.example.ch/open/role-a', 'https://jobs.example.ch/open/role-b'])

    def test_unanswered_id_candidates_are_not_accepted_by_shape(self):
        cards = ''.join(f'<a href="/vacancy/{100000 + n}">Role {n}</a>' for n in range(3))
        with mock.patch.object(self.decide, 'MAX_CALLS_PER_RUN', 0):
            self.assertEqual(careers.job_links(cards, BASE), [])
        self.assertEqual(self.requests, [])

    def test_three_anchors_to_one_job_do_not_hide_the_other_jobs(self):
        repeated = '<a href="/vacancy/100000">Role A</a>' * 3
        cards = '<a href="/open/role-b">Role B</a><a href="/open/role-c">Role C</a>'
        self.assertEqual(careers.job_links(repeated + cards, BASE), [
            'https://jobs.example.ch/vacancy/100000', 'https://jobs.example.ch/open/role-b', 'https://jobs.example.ch/open/role-c'])


if __name__ == '__main__':
    unittest.main()
