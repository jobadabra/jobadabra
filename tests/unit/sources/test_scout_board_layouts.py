"""Board discovery learns a measured board's layout once and keeps it in the board's fact, for the Scout's publish (src/scout_boards.py,
src/sources/board_layout.py). Why (13 Nov 2026, owner: "shouldn't the central scout and board discovery do that... spend those 60-90s ?"): every
install's first search asked the AI about each link of a board discovery had already read; the layout it learns is replayed with no question."""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import scout_board_cells, scout_board_lanes, scout_boards, scout_cells
from src.ai import page_words
from src.sources import careers, found_boards

MENU = '<a href="/about">About us</a><a href="/blog/news">News</a><a href="/employers">For employers</a>'
FOOTER = '<footer><p>' + 'Jobs Example lists open positions from employers across the country, updated every day. ' * 12 + '</p></footer>'


def board(host):
    return {'name': host, 'host': host, 'search_url': f'https://{host}/search?q={{role}}', 'countries': ['Moldova'], 'kinds': ['any'], 'source_kind': 'general'}


def posting(host, n):
    job = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': f'Developer {n}', 'url': f'https://{host}/job/{n}',
           'hiringOrganization': {'@type': 'Organization', 'name': 'Acme'},
           'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Chisinau', 'addressCountry': 'MD'}}}
    return f'<html><script type="application/ld+json">{json.dumps(job)}</script><body>x</body></html>'


SLUGS = ['python-developer-acme', 'data-engineer-globex', 'backend-developer-initech', 'devops-engineer-umbrella']


def pages(shape):
    """A board whose cards are /job/<slug> with no number in the path (shape 'one'; sa, 13 Nov 2026: six Lisbon boards' 50-141 links a page carry
    none), scattered under several folders (shape 'mixed': no one layout reads them), or listing its jobs as JSON-LD (shape 'jsonld': no layout tested)."""
    def fetch(url):
        host, path = url.split('/')[2], '/' + url.split('/', 3)[3]
        if path.startswith(('/job/', '/jobs-it/', '/offer/')):
            return posting(host, path.rsplit('/', 1)[1])
        if shape == 'jsonld':
            return '<html>' + ''.join(posting(host, slug).split('<body>')[0].removeprefix('<html>') for slug in SLUGS) + f'<body>{MENU}{FOOTER}</body></html>'
        hrefs = [f'/job/{slug}' for slug in SLUGS] if shape == 'one' else ['/job/python-developer-acme', '/jobs-it/data-engineer-globex',
                                                                            '/offer/backend-developer-initech', '/jobs-it/x/devops-engineer-umbrella']
        return f'<html><body>{MENU}' + ''.join(f'<a href="{h}">{h.rsplit("/", 1)[1].replace("-", " ").title()}</a>' for h in hrefs) + f'{FOOTER}</body></html>'
    return fetch


_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


class DiscoveryLayoutTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        scout_cells.keep(self.db, [{'countries': [c]} for c in scout_cells.EUROPE if c != 'md' for _ in range(5)])
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.folder = Path(tmp.name)
        self.asked = []

        def link_words(pairs, floor=None):   # the AI's verdict on each link (a job card or not), recorded
            pairs = list(pairs)
            self.asked.extend(pairs)
            return {(str(t), str(p)): page_words.Words(False, False, False, str(p).startswith(('/job', '/offer'))) for t, p in pairs}
        for patch in (mock.patch.object(scout_boards.pool_tags, 'countries_each', lambda texts: ({t: {'md'} if 'Chi' in t else set() for t in texts}, [])),
                      mock.patch.object(scout_boards.pool_tags, 'families_read', lambda titles: (['software_dev'] if titles else [], [])),
                      mock.patch('src.paths.DATA', self.folder), mock.patch('src.places.load', return_value={}),
                      mock.patch('src.sources.board_yield.is_relevant', side_effect=list),
                      mock.patch.object(page_words, 'link_words', side_effect=link_words)):
            patch.start()
            self.addCleanup(patch.stop)

    def run_pass(self, shapes):
        read = lambda item, search, fetch: found_boards.read_board(item, search, pages(shapes[item['host']]))
        self.lines = []
        return scout_boards.run(self.db, ideas=lambda search: [board(host) for host in shapes], read_board=read, out=self.lines.append,
                                google=lambda db, country, kinds, out: [], named='md')

    def keep(self, host, layout):
        scout_boards.ensure(self.db)
        self.db.execute('INSERT OR REPLACE INTO scout_board_facts (host, country, url, families, local_jobs, read_at, browser, layout) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        (host, 'md', f'https://{host}/search?q={{role}}', 'software_dev', 4, '2026-11-01', 0, json.dumps(layout)))

    def test_a_measured_board_keeps_the_layout_its_read_found_and_the_publish_sends_it(self):
        kept = self.run_pass({'one.example': 'one', 'mixed.example': 'mixed'})
        self.assertEqual({fact['host']: fact.get('layout') for fact in kept}, {'one.example': {'kind': 'links', 'prefix': '/job'}, 'mixed.example': None},
                         'a layout only where one shape reads every card the read found')
        published = {fact['host']: fact.get('layout') for fact in scout_boards.facts(self.db)}
        self.assertEqual(published, {'one.example': {'kind': 'links', 'prefix': '/job'}, 'mixed.example': None})
        self.assertIn('a layout for 1 of the 2 kept boards', self.lines[0])

    def test_the_published_layout_reads_the_board_with_no_link_question(self):
        """The whole loop: what discovery publishes, served to an install (jobadabra-web api/employers.js boardFactsOf keeps it), costs no question."""
        layout = next(fact['layout'] for fact in self.run_pass({'one.example': 'one'}))
        self.asked.clear()
        jobs, _, _ = found_boards.read_board({**board('one.example'), 'layout': layout}, {'jobs_board_search_queries': ['developer'], 'role_keywords': ['developer'],
                                                                                         'locations': {'top_tier': ['Chisinau'], 'country_wide': [], 'abroad': []}}, pages('one'))
        self.assertEqual((self.asked, len(jobs)), ([], 4))

    def test_a_kept_layout_that_still_holds_is_kept_and_the_read_asks_no_link_question(self):
        self.keep('one.example', {'kind': 'links', 'prefix': '/job'})
        self.run_pass({'one.example': 'one'})
        self.assertEqual(scout_boards.facts(self.db)[0].get('layout'), {'kind': 'links', 'prefix': '/job'})
        self.assertFalse([path for _, path in self.asked if path.startswith('/job/')], 'discovery itself replays the layout it kept')

    def test_a_stale_layout_is_replaced_by_the_one_this_read_learns(self):
        self.keep('one.example', {'kind': 'links', 'prefix': '/vacancy'})
        self.run_pass({'one.example': 'one'})
        self.assertEqual(scout_boards.facts(self.db)[0].get('layout'), {'kind': 'links', 'prefix': '/job'})

    def test_a_stale_layout_with_no_new_one_leaves(self):
        self.keep('mixed.example', {'kind': 'links', 'prefix': '/vacancy'})
        self.run_pass({'mixed.example': 'mixed'})
        self.assertNotIn('layout', scout_boards.facts(self.db)[0])

    def test_a_read_that_never_tested_the_layout_keeps_it(self):
        """sa, 13 Nov 2026: a pass that learns no layout must not blank one an earlier pass learned (the same REPLACE that lost families)."""
        self.keep('listed.example', {'kind': 'links', 'prefix': '/job'})
        self.run_pass({'listed.example': 'jsonld'})
        self.assertEqual(scout_boards.facts(self.db)[0].get('layout'), {'kind': 'links', 'prefix': '/job'})

    def test_a_stored_layout_the_engine_would_not_replay_is_never_published(self):
        scout_boards.ensure(self.db)
        self.db.execute("INSERT INTO scout_board_facts (host, country, url, families, local_jobs, read_at, browser, layout) VALUES "
                        "('odd.example', 'md', 'https://odd.example/?q={role}', 'software_dev', 4, '2099-01-01', 0, '{\"kind\": \"links\", \"prefix\": \"/a/(.*)\"}')")
        self.assertNotIn('layout', scout_boards.facts(self.db, today=__import__('datetime').date(2099, 1, 2))[0])

    def test_a_lane_and_the_seed_carry_the_layout(self):
        self.run_pass({'one.example': 'one'})
        lane = self.folder / 'lane.sqlite'
        with sqlite3.connect(lane) as copy:
            self.db.backup(copy)
        merged = sqlite3.connect(':memory:')
        scout_board_lanes.merge(merged, lane, 'md')
        self.assertEqual(scout_boards.facts(merged)[0].get('layout'), {'kind': 'links', 'prefix': '/job'})
        fresh = sqlite3.connect(':memory:')
        scout_board_cells.seed(fresh, str(lane), out=lambda line: None)
        self.assertEqual(scout_boards.facts(fresh)[0].get('layout'), {'kind': 'links', 'prefix': '/job'})

    def test_the_seed_from_a_memory_kept_before_layouts_copies_its_facts_without_one(self):
        old = self.folder / 'old.sqlite'
        with sqlite3.connect(old) as source:
            source.execute('CREATE TABLE scout_board_facts (host TEXT NOT NULL, country TEXT NOT NULL, url TEXT NOT NULL, families TEXT NOT NULL, '
                           'local_jobs INTEGER NOT NULL, read_at TEXT NOT NULL, browser INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (host, country))')
            source.execute("INSERT INTO scout_board_facts VALUES ('one.example', 'md', 'https://one.example/?q={role}', 'software_dev', 4, '2099-01-01', 0)")
        fresh = sqlite3.connect(':memory:')
        self.assertEqual(scout_board_cells.seed(fresh, str(old), out=lambda line: None), 1)
        self.assertNotIn('layout', scout_boards.facts(fresh, today=__import__('datetime').date(2099, 1, 2))[0])


if __name__ == '__main__':
    unittest.main()
