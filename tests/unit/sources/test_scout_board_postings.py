"""Board discovery's first read judges each job page "one posting or not" as installs do, on its own allowance (src/sources/one_posting.py
pass_allowance, src/scout_boards.py POSTING_CALLS). Why (13 Nov 2026, sa): the pass read with the page reader off, which kept every linked page
as a job (one_posting.kept with no reader): a Portuguese board's filter pages (/job-category/…, /job-location/…, /job-type/…) counted as 25 of
its 39 jobs and their mixed paths blocked its layout ("no one shape reads its job cards"), and another board's redirect stubs counted as 20
local jobs. Example boards only, fake AI."""
import unittest
from unittest import mock

import tests.unit.sources.test_scout_board_layouts as layouts

from src import scout_boards
from src.ai import decide
from src.sources import careers, found_boards, one_posting

CARDS = ['python-developer-acme', 'data-engineer-globex', 'backend-developer-initech', 'devops-engineer-umbrella']
FILTERS = ['/job-category/design', '/job-location/chisinau', '/job-type/full-time']


def pages(url):
    """A board whose cards are /offer-x/<slug> (JobPosting data) beside its filter links, whose pages have a heading and no job data."""
    host, path = url.split('/')[2], '/' + url.split('/', 3)[3]
    if path.startswith('/offer-x/'):
        return layouts.posting(host, path.rsplit('/', 1)[1], 'offer-x')
    if path in FILTERS:
        return f'<html><head><title>{path.rsplit("/", 1)[1].title()} jobs</title></head><body><h1>{path.rsplit("/", 1)[1].title()}: 120 jobs</h1></body></html>'
    links = [f'/offer-x/{slug}' for slug in CARDS] + FILTERS
    return f'<html><body>{layouts.MENU}' + ''.join(f'<a href="{h}">{h.rsplit("/", 1)[1].replace("-", " ").title()}</a>' for h in links) + f'{layouts.FOOTER}</body></html>'


_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


class PassJudgesJobPages(unittest.TestCase):
    def setUp(self):
        layouts.DiscoveryLayoutTest.setUp(self)   # the same board pass harness, without running its tests again here
        self.scopes, real = [], decide.decide

        def judged(topic, items, *args, **kwargs):   # the posting question: one call per batch, drawn from the scope's pool as decide does
            if topic != one_posting.TOPIC:
                return real(topic, items, *args, **kwargs)
            self.scopes.append(decide.own_scope())
            if not decide.take(topic, 'batch'):
                return None
            return {url: 'one_posting' if '/offer-x/' in url else 'other' for url in items}
        patch = mock.patch.object(decide, 'decide', side_effect=judged)
        patch.start()
        self.addCleanup(patch.stop)

    def pass_over(self):
        read = lambda item, search, fetch: found_boards.read_board(item, search, pages)
        self.lines = []
        return scout_boards.run(self.db, ideas=lambda search: [layouts.board('filters.example')], read_board=read, out=self.lines.append,
                                google=lambda db, country, kinds, out: [], named='md')

    def test_filter_pages_are_judged_not_jobs_and_the_cards_layout_is_learned(self):
        kept = self.pass_over()
        self.assertEqual([fact.get('layout') for fact in kept], [{'kind': 'links', 'prefix': '/offer-x'}])
        self.assertIn('filters.example 4/4 (layout learned: links /offer-x)', self.lines[0], 'listed counts the job cards only')
        self.assertEqual(set(self.scopes), {one_posting.POSTINGS}, 'asked on its own allowance, never the page words or the run cap')
        self.assertRegex(self.lines[0], r'job pages [1-9]\d* of \d+', 'the pass line says what the question spent')

    def test_a_spent_allowance_leaves_the_pages_unjudged_and_never_counts_them(self):
        with mock.patch.object(scout_boards, 'POSTING_CALLS', 0):
            kept = self.pass_over()
        self.assertEqual([fact.get('layout') for fact in kept], [{'kind': 'links', 'prefix': '/offer-x'}], 'only the cards with job data stand')
        self.assertIn('filters.example 4/4', self.lines[0])

    def test_outside_the_pass_a_read_with_no_page_reader_keeps_every_page_as_before(self):
        jobs = [{'url': 'https://filters.example/job-type/full-time', 'title': 'Full Time'}]
        self.assertEqual(one_posting.kept(jobs, False), jobs)
        self.assertEqual(self.scopes, [], 'nothing asked')


if __name__ == '__main__':
    unittest.main()
