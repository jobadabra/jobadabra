"""Titles of jobs located in the user's own places are sorted first and past the titles' clock (24 Oct 2026, Chisinau: worldwide-remote titles spent
the 3 minutes), never past the run's end (owner, 26 Oct 2026: "A find jobs session should take at most 3min")."""
import json
import pathlib
import re
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest import mock

from src import time_budget
from src.ai import title_triage
from src.sources import feeds

SEARCH = {'role_keywords': ['software engineer'], 'title_exclude_keywords': []}


class Client:
    def __init__(self):
        self.asked = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        listed = kwargs['messages'][0]['content'].split('The titles:\n', 1)[1].split('\n')
        self.asked += [line.split('. ', 1)[1] for line in listed]
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'fit': [1]}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class LocalFirstTest(unittest.TestCase):
    def setUp(self):
        self.patches = [mock.patch.object(title_triage, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 't.json'),
                        mock.patch.object(feeds, 'PLACE', re.compile(r'moldova|chi[sș]in[aă]u', re.I)),
                        mock.patch('src.paths.DATA', pathlib.Path(tempfile.mkdtemp()))]   # its paces: the default ones, not a stray step_pace.json
        for patch in self.patches:
            patch.start()
        time_budget.start(180, now=time.monotonic() - 105)   # the titles' time ran out (at 95 s), scoring's share (time_budget.SCORING) not begun
        self.addCleanup(lambda: setattr(time_budget, 'DEADLINE', None))

    def tearDown(self):
        for patch in self.patches:
            patch.stop()

    def test_local_titles_are_sorted_after_the_clock_and_others_wait(self):
        client = Client()
        title_triage.decide(['Java Developer', 'Data Engineer'], SEARCH, client, local=True)
        title_triage.decide(['Remote Rust Engineer'], SEARCH, client)
        self.assertEqual(client.asked, ['java developer', 'data engineer'], 'the local titles were asked, the remote one waits for the next refresh')

    def test_a_local_batch_the_plan_allows_is_not_stopped_by_the_reserve(self):
        """25 Oct 2026, Chisinau #10: the plan took all the titles (nothing forced), then the safety net (75 s kept for later steps) stopped the batch."""
        client = Client()
        with mock.patch.object(time_budget, 'in_calls', side_effect=lambda step, n, *a, **k: n):
            title_triage.decide(['Java Developer', 'Data Engineer'], SEARCH, client, local=True)
            title_triage.decide(['Remote Rust Engineer'], SEARCH, client)
        self.assertEqual(client.asked, ['java developer', 'data engineer'])

    def test_the_floor_is_the_searchs_first_titles_only(self):
        client = Client()
        titles = [f'Engineer {n}' for n in range(time_budget.LOCAL_TITLES + 30)]
        with mock.patch.object(time_budget, 'in_calls', return_value=0):   # the clock gives no batch: the floor alone
            title_triage.decide(titles, SEARCH, client, local=True)
        self.assertEqual(len(client.asked), time_budget.LOCAL_TITLES)

    def test_past_the_runs_end_local_titles_wait_too(self):
        # owner, 26 Oct 2026: "A find jobs session should take at most 3min" (tests/unit/sources/test_three_minutes.py)
        time_budget.start(180, now=time.monotonic() - 1000)
        client = Client()
        title_triage.decide(['Java Developer', 'Data Engineer'], SEARCH, client, local=True)
        self.assertEqual(client.asked, [])

    def test_in_scorings_share_local_titles_wait_while_the_waiting_jobs_need_the_time(self):
        # 26 Oct 2026, a proof on a copy of the owner's data: floor title calls held the board read to 136 s; the search scored 3 jobs
        from src import run_counts
        run_counts.reset()   # Why (#2331, as #2218 in test_score_first_from_start): an earlier test in the process that scored https://x.test/1 left it scored, so nothing "waited"
        self.addCleanup(run_counts.reset)
        run_counts.matched([{'url': f'https://x.test/{n}'} for n in range(20)])
        time_budget.start(180, now=time.monotonic() - 125)
        client = Client()
        title_triage.decide(['Java Developer', 'Data Engineer'], SEARCH, client, local=True)
        self.assertEqual(client.asked, [])

    def test_in_scorings_share_one_waiting_job_leaves_the_local_titles_their_turn(self):
        # 5 Nov 2026, #2918, Copenhagen: one job waiting held back every title of 200 EURES rows, and the press ended 30 s early with 0 of them listed
        from src import run_counts
        run_counts.reset()
        self.addCleanup(run_counts.reset)
        run_counts.matched([{'url': 'https://x.test/1'}])
        time_budget.start(180, now=time.monotonic() - 125)
        client = Client()
        title_triage.decide(['Java Developer', 'Data Engineer'], SEARCH, client, local=True)
        self.assertEqual(client.asked, ['java developer', 'data engineer'])

    def test_each_planned_batch_asks_for_scorings_time_as_it_starts(self):
        # Code review of the title floor (5 Nov 2026): a real press plans whole rounds ("120 of 174"), and a planned batch went past the clock unasked, so 150 titles took the time of 10 waiting jobs
        titles = [f'Title {n}' for n in range(title_triage.BATCH * 4)]
        client = Client()
        with mock.patch.object(time_budget, 'in_calls', return_value=title_triage.BATCH * 3), mock.patch.object(time_budget, 'over', return_value=True), \
                mock.patch.object(time_budget, 'local_titles', side_effect=[title_triage.BATCH] + [0] * 3), mock.patch.object(time_budget, 'title_room', side_effect=[True, False, False, False]), \
                mock.patch('builtins.print'):
            title_triage.decide(titles, SEARCH, client, local=True)
        self.assertEqual(len(client.asked), title_triage.BATCH, 'the first batch had room; the others found none and wait')

    def test_in_scorings_share_one_batch_is_sorted_while_the_search_matched_nothing(self):
        # 27 Oct 2026, the quality suite on Free AI: "No time left" for its 10 titles, so its FLOOR scores had no job (tests/unit/sources/test_first_press_order.py)
        from src import run_counts
        run_counts.reset()
        time_budget.start(180, now=time.monotonic() - 125)
        client = Client()
        title_triage.decide(['Java Developer', 'Data Engineer'], SEARCH, client, local=True)
        self.assertEqual(client.asked, ['java developer', 'data engineer'])

    def test_a_job_is_in_my_place_by_its_location_not_by_being_remote(self):
        for location, mine in [('Chișinău', True), ('Moldova', True), ('MD', True), ('Remote - Worldwide', False), ('Remote', False), ('Berlin', False)]:
            with self.subTest(location=location), mock.patch.object(feeds, 'place_of', return_value=None):
                self.assertEqual(feeds.in_my_place({'title': 'x', 'location': location}), mine)


if __name__ == '__main__':
    unittest.main()
