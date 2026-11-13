"""A board card that links its posting twice (the job page and an action on it, /jobs/<id>-<slug> and /jobs/<id>/apply) is ONE posting in the list
(src/sources/careers_parse.py one_per_posting). 13 Nov 2026 (sd; bp's proof on an airline board, discovery run 43498167418): 39 rows of ~20 postings, each posting
once from its job page and once from its apply page ('Girona' vs 'Gerona'), so a person saw each job twice and the Scout counted 53 for a field of ~27 postings.
Invented boards and words; no AI call, no live site. Only the certain case is joined: the link that ends at its own <id>-<slug> segment keeps its place and a link of the same id
with segments after it is dropped; two links that both add segments, or a bare id beside its sub-pages, are never joined (a lost job is worse than a shown twin, sa 13 Nov 2026)."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src.sources import careers, careers_parse, found_boards  # noqa: E402

_READER = careers.READER


def setUpModule():
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


HOST = 'listings.example'
SEARCH = {'jobs_board_search_queries': ['mecanico'], 'role_keywords': ['mecanico'], 'locations': {'top_tier': ['Porto'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Listings', 'host': HOST, 'search_url': f'https://{HOST}/busca?q={{role}}&local={{place}}', 'countries': ['Portugal'], 'kinds': ['any']}
BASE = f'https://{HOST}/jobs/in-portugal'


def card(number, title, slug, action='apply'):
    return (f'<div class="card"><a href="/jobs/{number}-{slug}">{title}</a><span>Porto</span>'
            f'<a class="btn" href="/jobs/{number}/{action}">Apply</a></div>')


def board_page(count=6, action='apply'):
    return ''.join(card(7000000 + n, f'Mechanic {n}', f'mechanic-{n}', action) for n in range(count))


def job_page(url, town='Porto'):
    number = [part for part in url.split('/') if part[:1].isdigit()][0].split('-')[0]
    posting = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': f'Mechanic {number}', 'url': url, 'hiringOrganization': {'@type': 'Organization', 'name': 'Acme Lda'},
               'jobLocation': {'@type': 'Place', 'address': {'addressLocality': town, 'addressCountry': 'PT'}}}
    return f'<html><script type="application/ld+json">{json.dumps(posting)}</script><h1>Mechanic {number}</h1></html>'


class OneLinkPerPostingTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)

    def test_a_card_that_links_its_posting_and_its_apply_action_gives_one_job_link(self):
        urls = careers_parse.job_links(board_page(), BASE)
        self.assertEqual(len(urls), 6, urls)
        self.assertTrue(all('/apply' not in url for url in urls), urls)

    def test_a_board_read_lists_each_posting_once_and_never_opens_the_apply_pages(self):
        opened = []

        def fetch(url):
            opened.append(url)
            return board_page() if '/busca' in url else job_page(url)
        jobs, state, _ = found_boards.read_board(BOARD, SEARCH, fetch=fetch)
        self.assertEqual((len(jobs), state), (6, 'ok'))
        self.assertEqual(len({job['title'] for job in jobs}), 6)
        self.assertEqual([url for url in opened if '/apply' in url], [], 'an action page is not asked for')

    def test_the_layout_a_board_served_is_cleaned_the_same_way(self):
        """read_page_from(linked=...) takes the links a served layout named: twins in it are read once too."""
        named = [f'https://{HOST}/jobs/7000001-mechanic-1', f'https://{HOST}/jobs/7000001/apply', f'https://{HOST}/jobs/7000002-mechanic-2']
        opened = []

        def fetch(url):
            opened.append(url)
            return job_page(url)
        jobs = careers.read_page_from('<html></html>', BASE, fetch, linked=named)
        self.assertEqual(sorted(job['title'] for job in jobs), ['Mechanic 7000001', 'Mechanic 7000002'])
        self.assertEqual(len(opened), 2)

    def test_any_action_word_is_the_same_shape(self):
        """No word list: /jobs/<id>/<anything> beside /jobs/<id>-<slug> is the same posting."""
        for action in ('apply', 'solicitar', 'bewerben', 'x'):
            with self.subTest(action=action):
                self.assertEqual(len(careers_parse.job_links(board_page(action=action), BASE)), 6)

    def test_two_postings_of_one_employer_are_two_postings(self):
        """Different ids stay apart, also when a company id comes first in the path."""
        page = ''.join(f'<a href="/jobs/1234567/{7000000 + n}-mecanico-{n}">Mecânico {n}</a>' for n in range(6))
        self.assertEqual(len(careers_parse.job_links(page, BASE)), 6)

    def test_two_jobs_under_one_employer_id_told_apart_only_by_what_follows_are_kept(self):
        """sa, 13 Nov 2026: /employer/<id>/welder and /employer/<id>/driver share the path before the id and the id, and are two jobs."""
        page = ''.join(f'<a href="/jobs/{7000000 + n}/{role}">{role}</a>' for n in range(3) for role in ('welder', 'driver'))
        self.assertEqual(len(careers_parse.job_links(page, BASE)), 6)

    def test_a_bare_id_page_is_never_joined_with_the_pages_below_it(self):
        """/jobs/<id> may be an employer page, not a posting with a slug: its sub-pages stay."""
        urls = [f'https://{HOST}/jobs/7000001', f'https://{HOST}/jobs/7000001/welder', f'https://{HOST}/jobs/7000001/driver']
        self.assertEqual(careers_parse.one_per_posting(urls), urls)

    def test_the_posting_stays_when_only_the_action_is_listed_first(self):
        page = ''.join(f'<a href="/jobs/{7000000 + n}/apply">Apply</a><a href="/jobs/{7000000 + n}-mechanic-{n}">Mechanic {n}</a>' for n in range(6))
        urls = careers_parse.job_links(page, BASE)
        self.assertEqual(len(urls), 6)
        self.assertTrue(all(url.split('/')[-1].startswith('70000') and '-mechanic-' in url for url in urls), urls)

    def test_a_posting_with_no_twin_is_untouched(self):
        page = ''.join(f'<a href="/jobs/{7000000 + n}-mechanic-{n}">Mechanic {n}</a>' for n in range(6))
        self.assertEqual(len(careers_parse.job_links(page, BASE)), 6)


if __name__ == '__main__':
    unittest.main()
