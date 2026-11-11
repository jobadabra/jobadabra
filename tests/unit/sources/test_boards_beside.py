"""A Find jobs press after the first discovers the job boards' employers inside the search, beside the employer sites (src/sources/boards_beside.py;
owner, 8 Nov 2026: "One process, discovery inside (Recommended)"): run 42411469318 (p7) gave employer sites ~4 s behind a separate boards step."""
import contextlib
import threading
import time
import unittest
from types import SimpleNamespace
from unittest import mock

from src import daily_search
from src.ai import batch_scope
from src.sources import boards, boards_ahead, boards_beside, board_yield

REAL_START = boards_beside.start


def args(**over):
    base = dict(mode='run', discover_beside=True, first_jobs=False, only_visits=False, score_max=60)
    return SimpleNamespace(**{**base, **over})


class GatherSourcesTest(unittest.TestCase):
    def gather(self, a, work):
        """gather_sources with every reader faked: `work` is the discovery, the employer sites' read waits until it has started."""
        started, events, calls = threading.Event(), [], []

        def discovery():
            started.set()
            events.append('discovery')
            return work()

        def scan_beside(*_a, **_k):
            events.append('employer sites start')
            if calls:
                self.assertTrue(started.wait(2), 'the discovery runs while the employer sites are read')
            events.append('employer sites end')
            return {'jobs': [], 'sources': []}, None

        def start():
            calls.append(batch_scope._frozen is not None)
            return REAL_START(search={'any': 1}, work=discovery)
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(daily_search.feeds, 'database', lambda _path: contextlib.nullcontext(object())))
            stack.enter_context(mock.patch.object(daily_search.jobs_so_far, 'SoFar', lambda _db: mock.MagicMock()))
            stack.enter_context(mock.patch.object(daily_search.first_jobs, 'run', lambda *_a, **_k: None))
            stack.enter_context(mock.patch.object(boards_ahead, 'scan_beside', scan_beside))
            stack.enter_context(mock.patch.object(boards_beside, 'start', start))
            stack.enter_context(mock.patch.object(boards, 'boards', lambda _search: ['jobs.ch']))
            stack.enter_context(mock.patch.object(daily_search, 'load_search_config', lambda: {}))
            stack.enter_context(mock.patch.object(daily_search, 'gather_apis', lambda *_a: None))
            stack.enter_context(mock.patch.object(daily_search.coverage, 'save', lambda _f: None))
            stack.enter_context(mock.patch('builtins.print'))
            daily_search.gather_sources(a, None, object(), [], lambda: {'cv': 1}, set(), set(), {'warnings': []})
        return calls, events

    def test_a_later_press_discovers_the_boards_employers_beside_the_employer_sites(self):
        done = []
        calls, events = self.gather(args(), lambda: done.append(True))
        self.assertEqual(calls, [True], 'started once, inside the side-by-side scope: its titles stay its own until it ends')
        self.assertIn('discovery', events)
        self.assertEqual(done, [True], 'the search waits for it before it imports')

    def test_no_flag_or_a_first_press_discovers_nothing_inside_the_search(self):
        for a in (args(discover_beside=False), args(first_jobs=True), args(mode='today')):
            calls, events = self.gather(a, lambda: None)
            self.assertEqual(calls, [], a)
            self.assertNotIn('discovery', events)

    def test_a_failed_discovery_is_a_warning_not_the_searchs_failure(self):
        def broken():
            raise OSError('jobs.ch refused')
        with mock.patch('builtins.print') as said:
            beside = boards_beside.Beside(broken)
            beside.finish()
        self.assertIn('job boards employer discovery stopped (OSError: jobs.ch refused)', ' '.join(str(c) for c in said.call_args_list))


    def test_the_search_waits_for_it_only_until_the_reads_cut(self):
        # A slow employer homepage in the discovery would otherwise hold the search past the cut, out of scoring's time (review of ps E1).
        from src.sources import read_budget
        release = threading.Event()
        with mock.patch.object(read_budget, 'cut_at', lambda: time.monotonic() + 0.1), mock.patch('builtins.print') as said:   # clock: relative a cut 0.1 s from now, compared with the time waited
            beside = boards_beside.Beside(lambda: release.wait(5))
            began = time.monotonic()   # clock: relative only the time waited is measured
            beside.finish()
            waited = time.monotonic() - began   # clock: relative only the time waited is measured
        release.set()
        self.assertLess(waited, 2, 'let go at the cut, as the employer sites are')
        self.assertIn("goes on past the read's time", ' '.join(str(c) for c in said.call_args_list))

class DiscoverBesideTest(unittest.TestCase):
    def test_without_a_fixed_board_it_reads_nothing_the_search_reads_the_found_boards_itself(self):
        with mock.patch.object(boards, 'boards', lambda _search: []), mock.patch.object(board_yield, 'step', side_effect=AssertionError('read twice')):
            self.assertIsNone(boards_beside.start(search={'any': 1}))
            self.assertEqual(boards.discover(5, 40, beside=True), 0)

    def test_a_board_job_becomes_a_checked_employer_in_the_report(self):
        # Gitar on #3576: the split left discover() calling read_budget without its import, so every employer raised NameError; this runs
        # discover past its employer step with one fake job (no site is reached: the boards' readers and the employer's links are faked).
        from src.sources import boards_report
        job = {'company': 'Acme AG', 'url': 'https://board.test/1', 'title': 'Nurse', 'city': 'Geneva', 'work_mode': 'onsite', 'location': 'Geneva', 'source': 'TechTree'}
        company = {'company': 'Acme AG', 'size': '', 'min_employees': None, 'jobs': [job], 'website': '', 'career_pages': ['https://acme.test/jobs'],
                   'platforms': [], 'notes': []}
        written = []
        with mock.patch.object(boards, 'boards', lambda _search: ['TechTree']), \
                mock.patch.object(boards, '_jobsch_pages', lambda *_a: []), mock.patch.object(boards, '_fit_jobs', lambda *_a: None), \
                mock.patch.object(boards, '_dev_boards', lambda _client, _used, jobs, _sources: jobs.append(job)), \
                mock.patch.object(boards, 'enrich', lambda pair, _client: company), \
                mock.patch.object(boards_report, 'write', lambda report, _out: written.append(report)), mock.patch('builtins.print'):
            boards.discover(5, 40, beside=True)
        self.assertEqual([c['company'] for c in written[0]['companies']], ['Acme AG'])

    def test_the_step_turned_off_or_the_fixture_mode_starts_nothing(self):
        with mock.patch.object(boards, 'boards', lambda _search: ['jobs.ch']):
            with mock.patch.dict('os.environ', {'JOBADABRA_FIXTURE_DIR': '/x'}):
                self.assertIsNone(boards_beside.start(search={'any': 1}))
            with mock.patch('src.features.disabled', lambda name: name == 'discover'):
                self.assertIsNone(boards_beside.start(search={'any': 1}))


if __name__ == '__main__':
    unittest.main()
