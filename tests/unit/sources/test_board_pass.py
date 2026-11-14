"""The search's last judging pass over the job boards' jobs (src/sources/board_pass.py, boards_first.Beside.last_pass, read_budget.pass_at).
Design (owner, 14 Nov 2026, asked via AskUserQuestion: "Judge in search + show both (Recommended)"; L05: "Yes, stop new reads then (Recommended)"):
every board job read before the search's last judging moment is placed and title-judged in the search; one read after it waits for the queue after
the search (src/sources/waiting_jobs.py); the lane starts no new read after that moment; no AI call starts in the run's last seconds (L04).
Why (14 Nov 2026, 12 CI searches of the GTM 6 profiles): 486 board jobs with a place text were never asked; 0 place passes ran in 7 of 12 searches.
Offline: the place-call tests' own fake model (tests/unit/ai/test_titles_with_places.py), temp stores, example names only. The clock is set, never waited for."""
import pathlib
import sqlite3
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from unittest import mock

from src import geo, time_budget
from src.ai import engine, place_triage, slots, title_triage
from src.sources import aggregators, board_pass, boards_first, feeds, places_later, read_budget, waiting_jobs
from tests.unit.ai.test_titles_with_places import Model

SEARCH = {'role_keywords': ['known role'], 'preferences': {'locations': {'best': ['Known town']}}}
NOW = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)
PACES = {'place_rounds': 8.0, 'title_rounds': 7.0}   # this computer's measured rounds: the pass needs 15 s, inside the floor and the ceiling
PASS = 165 - 15   # the pass time at those paces, in s of the app's 180 (run end 180 - TAIL 15)


def at(second, budget=180):
    """The clock `second` s into a run of `budget` s (the app's 180 s, part() is 1:1)."""
    time_budget.start(budget, now=time.monotonic() - second)


def board():
    """A board's page for the city: one job naming it, two in the next town nobody placed yet."""
    return [{'title': title, 'location': town, 'url': f'https://board.example.test/job/{n}', 'company': 'Example SARL', 'id': str(n), 'date_posted': '',
             'description': '', 'remote': False, 'salary': ''}
            for n, (title, town) in enumerate([('Known role 0', 'Known town'), ('Late role 0', 'Late town'), ('Late role 1', 'Late town')])]


class ThePassTime(unittest.TestCase):
    def setUp(self):
        self.addCleanup(time_budget.start, 0)
        paces = mock.patch.object(time_budget, '_paces', lambda: {**time_budget.PACE, **self.paces})
        paces.start()
        self.addCleanup(paces.stop)
        self.paces = dict(PACES)

    def test_the_pass_starts_one_measured_place_round_and_title_round_before_the_runs_end(self):
        at(100)
        self.assertAlmostEqual(read_budget.run_end() - read_budget.pass_at(), 15.0, places=3)

    def test_the_pass_time_keeps_its_floor_and_its_ceiling(self):
        at(100)
        self.paces = {'place_rounds': 2.0, 'title_rounds': 1.0}
        self.assertAlmostEqual(read_budget.run_end() - read_budget.pass_at(), time_budget.part(read_budget.PASS_MIN), places=3)
        self.paces = {'place_rounds': 40.0, 'title_rounds': 40.0}
        self.assertAlmostEqual(read_budget.run_end() - read_budget.pass_at(), time_budget.part(read_budget.PASS_MAX), places=3)
        self.assertLess(read_budget.PASS_MIN, read_budget.PASS_MAX)

    def test_no_budget_no_pass_time(self):
        time_budget.start(0)
        self.assertIsNone(read_budget.pass_at())

    def test_the_lane_starts_no_new_read_after_the_pass_time_and_waits_for_open_reads_to_the_runs_end(self):
        at(100)
        pass_at, end = read_budget.pass_at(), read_budget.run_end()
        with slots.in_lane(end):
            self.assertFalse(read_budget.past_cut(), 'before the pass time the lane reads')
        at(pass_at - time_budget.BEGAN + 1)   # one second past the pass time
        with slots.in_lane(read_budget.run_end()):
            self.assertTrue(read_budget.past_cut(), 'past the pass time no new read starts in the lane')
            self.assertEqual(read_budget.cut_at(), read_budget.run_end(), 'a read already open is waited for to the run\'s end')

    def test_to_the_end_the_steps_stop_at_the_runs_end_and_never_in_its_last_seconds(self):
        at(150)
        self.assertTrue(time_budget.over('titles', now=time.monotonic()), 'positive control: past the titles\' own stop')
        with time_budget.to_the_end():
            self.assertFalse(time_budget.over('titles', now=time.monotonic()))
            self.assertFalse(time_budget.over('place_rounds', now=time.monotonic()))
            self.assertGreater(time_budget.batch('title_rounds', 3, now=time.monotonic(), say=False), 0)
        self.assertTrue(time_budget.over('titles', now=time.monotonic()), 'the mode ends with its block')
        at(170)   # in the TAIL: no AI call starts (L04)
        with time_budget.to_the_end():
            self.assertTrue(time_budget.over('titles', now=time.monotonic()))
            self.assertEqual(time_budget.batch('title_rounds', 3, now=time.monotonic(), say=False), 0)

    def test_only_the_pass_and_the_calls_it_carries_run_to_the_end(self):
        at(150)
        seen = {}
        with time_budget.to_the_end():
            others = [threading.Thread(target=lambda: seen.__setitem__('other', time_budget.over('titles', now=time.monotonic()))),
                      threading.Thread(target=time_budget.carried(lambda: seen.__setitem__('carried', time_budget.over('titles', now=time.monotonic())))),
                      threading.Thread(target=slots.carry(lambda: seen.__setitem__('pool', time_budget.over('titles', now=time.monotonic()))))]
            for thread in others:
                thread.start()
                thread.join(timeout=5)
        self.assertEqual(seen, {'other': True, 'carried': False, 'pool': False}, 'scoring and the lane keep their stops; the pass\'s workers do not')


class TheLastPass(unittest.TestCase):
    def setUp(self):
        tmp = pathlib.Path(tempfile.mkdtemp())
        self.model = Model()
        self.model.gate.set()
        self.said = []
        for patch in (mock.patch.object(place_triage, 'STORE', tmp / 'p.json'), mock.patch.object(title_triage, 'STORE', tmp / 't.json'),
                      mock.patch.object(geo, 'STORE', tmp / 'g.json'), mock.patch.object(places_later, 'STORE', tmp / 'later.json'),
                      mock.patch.object(engine, 'ready', return_value=True), mock.patch.object(engine, 'client', lambda **kw: self.model),
                      mock.patch.object(engine, 'PARALLEL', 4), mock.patch.object(feeds, '_SEARCH', SEARCH),
                      mock.patch.object(feeds, 'wanted_location', lambda job: job['location'] == 'Known town' or feeds.place_of(job) in ('best', 'in')),
                      mock.patch.object(feeds, 'in_my_place', lambda job: job['location'] == 'Known town'),
                      mock.patch.object(geo, 'verdicts', lambda *args, **kw: {}),   # no map: the model places, as for a town seen for the first time
                      mock.patch.object(aggregators.board_employers, 'fill_missing'), mock.patch.object(aggregators.board_employers, 'note'),
                      mock.patch.object(time_budget, '_paces', lambda: {**time_budget.PACE, **PACES}),
                      mock.patch.object(aggregators.time_budget, 'wall', lambda: NOW),
                      mock.patch('builtins.print', lambda *args, **kw: self.said.append(' '.join(map(str, args))))):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(time_budget.start, 0)
        self.addCleanup(lambda: setattr(feeds, 'PLACED', None) or setattr(feeds, 'TRIAGED', None) or setattr(feeds, 'READ', None))
        feeds.PLACED = feeds.TRIAGED = feeds.READ = None
        self.db = sqlite3.connect(':memory:', check_same_thread=False)
        self.addCleanup(self.db.close)
        self.db.execute('CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))')

    def pass_time(self, lane, wait=True):
        """The clock set at the pass's time and the lane told so; with `wait`, until its pass ended (a hang guard, never the clock the test depends on)."""
        at(PASS)
        lane.wake()
        if wait:
            self.assertTrue(lane.passed.wait(timeout=30), 'the lane ran its pass at the pass time')

    def lane(self, read):
        """The boards' lane with one stand-in group source; the title sort of the lane's own threads had no time for its jobs (the AI's stop came first)."""
        no_time = lambda jobs: feeds._triaged().__setitem__(feeds.ASKED, True)
        with mock.patch('src.sources.board_reader.read', side_effect=read), mock.patch.object(feeds, 'triage', no_time):
            lane = boards_first.Beside(SEARCH)
            self.addCleanup(lane.close)
            shown = []
            lane.take(self.db, shown.extend, until=read_budget.pass_at())
        return lane, shown

    def test_the_lane_judges_at_the_pass_time_while_scoring_holds_the_main_thread_past_the_runs_end(self):
        """Pair 43601353056 (14 Nov 2026): the main thread reached the last hand-over at 161-174 s, past the run's end (165 s), held by scoring;
        a pass run by that hand-over asked nothing on any side. The lane asks at the pass time; the late hand-over only lists."""
        at(100)   # the lane reads before the pass time
        lane, shown = self.lane(lambda run, search, **kw: iter([('the board', board())]))
        self.pass_time(lane)
        self.assertIn('place answered', self.model.log, 'asked by the lane, not by the main thread')
        at(170)   # scoring held the main thread past the run's end (165 s)
        asked = len(self.model.log)
        lane.last_pass(self.db, shown.extend)
        self.assertEqual(sorted(job['title'] for job in shown), ['Known role 0', 'Late role 0', 'Late role 1'], 'listed by the late hand-over')
        self.assertEqual(len(self.model.log), asked, 'the late hand-over asks no AI (L04)')
        self.assertEqual(waiting_jobs.count(self.db, SEARCH), 0)
        self.assertIn(f'Board pass: asked 1 place(s), 3 title(s), listed 3, at {PASS} s', self.said)

    def test_a_board_job_read_before_the_pass_is_placed_and_judged_in_the_search(self):
        at(100)
        lane, shown = self.lane(lambda run, search, **kw: iter([('the board', board())]))
        self.assertEqual([job['title'] for job in shown], [], 'positive control: before the pass nothing is listed (no answer yet)')
        self.assertEqual(waiting_jobs.count(self.db, SEARCH), 3, 'positive control: the three wait for the queue')
        self.pass_time(lane)
        lane.last_pass(self.db, shown.extend)
        self.assertEqual(sorted(job['title'] for job in shown), ['Known role 0', 'Late role 0', 'Late role 1'], 'placed and judged in the search')
        self.assertEqual(waiting_jobs.count(self.db, SEARCH), 0, 'listed in the search: the queue owes them nothing')
        self.assertIn('place answered', self.model.log, 'the pass asked where Late town is')
        self.assertTrue(self.model.asked('titles late role 0'), 'and its title')
        line = next(line for line in self.said if line.startswith('Board pass: at '))
        self.assertRegex(line, r'^Board pass: at 1\d\ds of 165s: 1 location\(s\) and 3 title\(s\) to ask$')
        self.assertIn('Board pass: board.example.test places asked 2 · inside 2 · outside 0 · no answer 0', self.said)
        self.assertIn('Board pass: board.example.test titles asked 3 · fit 3 · not 0 · no answer 0', self.said)

    def test_a_board_read_after_the_pass_waits_and_the_queue_lists_its_jobs(self):
        at(100)
        passed, late = threading.Event(), board()[1:]

        def read(run, search, **kw):   # a read open at the pass time: its page comes back after the pass
            passed.wait(timeout=30)   # a hang guard, never the clock the test depends on
            yield 'the slow board', late
        judge = board_pass.judge

        def judged_then_the_page_lands(jobs):
            done = judge(jobs)
            passed.set()
            return done
        with mock.patch('src.sources.board_reader.read', side_effect=read), mock.patch.object(board_pass, 'judge', judged_then_the_page_lands):
            lane = boards_first.Beside(SEARCH)
            self.addCleanup(lane.close)
            shown = []
            self.pass_time(lane, wait=False)   # its page is still being read
            lane.last_pass(self.db, shown.extend)
        self.assertEqual(shown, [], 'read after the pass: not judged in the search')
        self.assertFalse(self.model.asked('titles late role'), 'no title call for it in the search')
        self.assertEqual(waiting_jobs.count(self.db, SEARCH), 2, 'it waits for the queue after the search')
        checked, items = waiting_jobs.judge(self.db, SEARCH, NOW, out=lambda line: None)
        self.assertEqual(sorted(item['title'] for item in items), ['Late role 0', 'Late role 1'], 'the queue lists them')

    def test_a_job_the_pass_refuses_leaves_the_queues_list(self):
        at(100)
        self.model.out = {'late town'}
        lane, shown = self.lane(lambda run, search, **kw: iter([('the board', board())]))
        self.pass_time(lane)
        lane.last_pass(self.db, shown.extend)
        self.assertEqual([job['title'] for job in shown], ['Known role 0'])
        self.assertEqual(waiting_jobs.count(self.db, SEARCH), 0, 'placed outside by the pass: the queue owes it nothing')

    def test_an_untimed_run_makes_no_pass(self):
        time_budget.start(0)
        lane, shown = self.lane(lambda run, search, **kw: iter([('the board', board())]))
        lane.last_pass(self.db, shown.extend)
        self.assertEqual(self.model.log, [], 'no pass: an untimed run judges each group as it comes')
        self.assertIn('Board pass: not run: the search has no time budget', self.said, 'said, never silent')

    def test_the_pass_asks_nothing_in_the_runs_last_seconds(self):
        at(170)   # in the TAIL (L04)
        owed = board()[1:]
        feeds._triaged()[feeds.ASKED] = True
        done = board_pass.judge(owed)
        self.assertEqual((done.answered, done.why), ([], 'the run had ended (its last seconds start no AI call)'))
        self.assertEqual(self.model.log, [], 'no AI call started')
        self.assertIn('Board pass: not run at 170s: the run had ended (its last seconds start no AI call)', self.said)

    def test_the_stage_log_says_each_job_read_and_each_job_kept_waiting(self):
        at(100)
        with mock.patch.dict('os.environ', {'JOBADABRA_STAGE_LOG': '1'}):
            lane, _shown = self.lane(lambda run, search, **kw: iter([('the board', board())]))
        self.assertIn('Stage: Job boards found read https://board.example.test/job/1\n', self.said)
        self.assertIn('Waiting: Job boards found https://board.example.test/job/1\n', self.said)


if __name__ == '__main__':
    unittest.main()
