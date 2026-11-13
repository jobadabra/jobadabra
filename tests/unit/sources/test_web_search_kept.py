"""The web search a Find jobs run left open at its cut is kept for the next run (owner, 26 Oct 2026: "next one to continue/start properly without
redoing the same job"; E2b, 8 Nov 2026: on persona 18's chain replay run 1's web search was still searching at the cut, run 2 asked it again from
second 0 and waited ~116 s for it, 70% of that run).
Design: states of one web search: ASKED (board_web.early at second 0, its future in board_web._early) -> ANSWERED (the call returned: the raw boards are
saved at once in data/web_raw.json, keyed by what was asked with its place words, 24 h) -> JUDGED (the boards are checked, then ideas + a stamp equal to the
answer's time in found_boards.json: that stamp is what marks the answer used, nothing is dropped before it is on disk) -> READ NEXT RUN. A search that finds its raw answer judges it and does not ask again. If the run ends while the call is open, the run's
end hands the future on (daily_search.leave_early_reads -> board_web.leave) and its answer is kept when it lands before the exit. One owner: board_web.
Real web search function, a model that answers only when the test lets it; no real time enters a result."""
import io
import json
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src import daily_search, time_budget
from src.ai import board_ideas
from src.sources import board_web, careers, found_boards, web_answers

SEARCH = {'role_keywords': ['civil engineer'], 'locations': {'top_tier': ['copenhagen']}}
RAW_NAME = web_answers.name('k-civil', ['copenhagen'])
ASKED = ('k-civil', ['Denmark'], ['civil engineer'], ['any'], ['copenhagen'])
FOUND = {'boards': [{'name': 'englishjobs.dk', 'search_url': 'https://englishjobs.dk/in/kobenhavn/{role}', 'countries': ['Denmark'], 'kinds': ['any'],
                     'source_kind': 'sector'}]}
BUDGET = 3
T0 = datetime(2026, 11, 8, 12, 0, tzinfo=timezone.utc)   # the searches' clock: pinned (tests/unit/ unpinned-clock ratchet)
_READER = careers.READER


def setUpModule():   # no page read reaches a real model here (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


class Gated:
    """The web search's model: answers only when the test sets `gate` (a hang guard of 30 s, not a measure of speed); counts the questions."""
    def __init__(self, gate):
        self.gate, self.asked = gate, []
        self.messages = self

    def create(self, **kwargs):
        self.asked.append(kwargs)
        assert self.gate.wait(30), 'the test never let the web search answer'
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(FOUND))], usage=None)


def wait_for(condition, seconds=6.0):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if condition():
            return True
        time.sleep(0.02)
    return False


class AWebSearchOpenAtTheCut(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.addCleanup(self.quiet)   # runs before the folder goes: no search thread writes into it while it is removed
        self.data = Path(tmp.name)
        self.gate = threading.Event()
        self.addCleanup(self.gate.set)   # no search thread outlives its test
        self.client = Gated(self.gate)
        self.judging = threading.Event()   # the judging of the boards the search named: open unless a test holds it
        self.judging.set()
        self.addCleanup(self.judging.set)
        board_web._searched.clear()
        for patch in (mock.patch('src.paths.DATA', self.data), mock.patch('src.ai.board_ideas.asked_for', return_value=ASKED),
                      mock.patch.object(board_web, 'careers', SimpleNamespace(READER=object(), get_text=lambda url: '')),
                      mock.patch.object(board_web, 'disabled', return_value=False), mock.patch('src.ai.cost.side'),
                      mock.patch.object(board_web, '_searcher', return_value=self.client),
                      mock.patch.object(board_web, '_judged', side_effect=self.judged),
                      mock.patch.object(found_boards.board_employers, 'note')):
            patch.start()
            self.addCleanup(patch.stop)
        board_web._early.clear()
        self.addCleanup(board_web._early.clear)
        self.addCleanup(time_budget.start, 0)

    def quiet(self):
        for thread in threading.enumerate():
            if thread.name.startswith(('board-web', 'board-judge', 'kept-search')):
                thread.join(10)

    def judged(self, found, roles, fetch):
        assert self.judging.wait(30), 'the test never let the judging end'
        return found

    def raw(self):
        try:
            return json.loads((self.data / 'web_raw.json').read_text())
        except (OSError, ValueError):
            return {}

    def stamped(self):
        return bool((board_ideas.load().get('web') or {}).get('k-civil'))

    def test_the_next_run_reads_what_the_open_search_found_and_does_not_ask_again(self):
        time_budget.start(BUDGET)   # run 1
        board_web.early(SEARCH)   # at second 0
        # the run ends past its read cut: no stage took the search (found_boards.read returns at the cut; aggregators skips the boards' reader)
        time_budget.start(BUDGET, now=time.monotonic() - BUDGET)
        with redirect_stdout(io.StringIO()) as log, mock.patch.object(daily_search, 'load_search_config', return_value=SEARCH):
            daily_search.leave_early_reads(SimpleNamespace(mode='run', only_visits=False))
        self.assertEqual(board_web._early, {}, 'the open web search was never handed on: nobody will keep its answer')
        self.gate.set()   # the answer comes after the cut
        self.assertTrue(wait_for(self.stamped), 'the late answer of the web search was lost: run 2 will ask it again')
        self.assertIn('englishjobs.dk', json.dumps(board_ideas.load().get('ideas')), 'the boards it found are kept for the next run')
        self.assertIn('k-civil', board_ideas.load().get('web_used') or {}, 'the saved answer is not marked used: the next run would judge it again')
        self.assertIn('did not answer in the search', log.getvalue())
        # Run 2 on the stored state, its boards working (under 2 working boards a search asks again by the thin rule): it rests, no new question.
        time_budget.start(BUDGET)
        later = Gated(self.gate)
        with redirect_stdout(io.StringIO()), mock.patch.object(board_web, '_working', return_value=[{}, {}]):
            board_web.search(SEARCH, [], client=later, data=board_ideas.load())
        self.assertEqual(later.asked, [], 'run 2 asked the web search again')

    def test_the_pair_draft_asks_the_web_search_once_and_a_side_takes_that_answer(self):
        """Gitar, #4030: tools/persona-search/propose.py asks once; web_raw.json holds the answer, no web idea or used-stamp is left, and a side's search asks nothing."""
        import importlib.util
        spec = importlib.util.spec_from_file_location('propose', Path(__file__).resolve().parents[3] / 'tools' / 'persona-search' / 'propose.py')
        propose = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(propose)
        self.gate.set()
        with redirect_stdout(io.StringIO()):
            self.assertTrue(propose.share_web_search(SEARCH))
        self.assertEqual(len(self.client.asked), 1)
        self.assertIn(RAW_NAME, self.raw(), 'the draft kept no saved answer for the sides')
        data = board_ideas.load()
        self.assertNotIn('k-civil', data.get('web_used') or {}, 'the answer is marked used: a side would not take it')
        self.assertEqual([board for board in (data.get('ideas') or {}).get('k-civil', []) if board.get('origin') == 'web'], [])
        board_web._searched.clear()   # a side is a new process
        side = Gated(self.gate)
        with redirect_stdout(io.StringIO()) as log:
            board_web.search(SEARCH, [], client=side, data=board_ideas.load())
        self.assertEqual(side.asked, [], 'a side asked the web search again')
        self.assertIn('no new search', log.getvalue())

    def test_a_search_a_stage_took_is_not_handed_on_twice(self):
        time_budget.start(BUDGET)
        board_web.early(SEARCH)
        with redirect_stdout(io.StringIO()):
            started = board_web.start(SEARCH, board_ideas.load())   # the job boards' stage took it
            with mock.patch.object(daily_search, 'load_search_config', return_value=SEARCH):
                daily_search.leave_early_reads(SimpleNamespace(mode='run', only_visits=False))
        self.assertIsNotNone(started)
        self.assertEqual(board_web._early, {})
        self.assertFalse(started[0].done(), 'the stage still owns the search: the run end did not touch it')

    def test_modes_that_start_no_search_hand_nothing_on(self):
        board_web.early(SEARCH)
        with mock.patch.object(daily_search, 'load_search_config', return_value=SEARCH):
            daily_search.leave_early_reads(SimpleNamespace(mode='more', only_visits=False))
        self.assertEqual(len(board_web._early), 1)

    def test_an_answer_saved_before_judging_is_judged_by_the_next_run_with_no_new_search(self):
        # Run 1: the call returns, the run ends before the judging does (persona 18: call back at 115 s, judging needs ~30 s more, run over at 135 s).
        self.judging.clear()
        self.gate.set()
        time_budget.start(BUDGET)
        threading.Thread(target=lambda: board_web.search(SEARCH, [], client=self.client, data={}, now=T0), name='kept-search', daemon=True).start()
        self.assertTrue(wait_for(lambda: self.raw().get(RAW_NAME)), 'the answer was not saved when the call returned: a run that ends now loses it')
        self.assertEqual(len(self.client.asked), 1)
        self.assertFalse(self.stamped(), 'nothing is judged yet: no stamp, no ideas')
        # Run 2, a new process: the model must not be asked, the saved answer is judged.
        board_web._searched.clear()
        time_budget.start(BUDGET)
        self.judging.set()
        again, stored = Gated(self.gate), {}
        with redirect_stdout(io.StringIO()) as log:
            found = board_web.search(SEARCH, [], client=again, data=stored, now=T0)
        self.assertEqual(again.asked, [], 'run 2 asked the web search again')
        self.assertEqual([board['name'] for board in found], ['englishjobs.dk'])
        self.assertIn('answered in the last run', log.getvalue())
        # Run 3 on the same stored state: the stamp is on disk, so the answer is used. The search was thin (under 2 working boards), so run 3 searches
        # afresh by the existing rule; it must not judge the used answer a second time.
        board_web._searched.clear()
        time_budget.start(BUDGET)
        third = Gated(self.gate)
        with redirect_stdout(io.StringIO()) as log:
            board_web.search(SEARCH, [], client=third, data=stored, now=T0)
        self.assertNotIn('answered in the last run', log.getvalue(), 'a used answer was judged again')
        self.assertEqual(len(third.asked), 1)

    def test_an_answer_judged_in_a_run_that_ended_before_the_stamp_was_saved_is_taken_again(self):
        # The run judged the boards (in memory) and ended before the ideas and the stamp reached the disk: nothing durable says it is used.
        web_answers.keep(RAW_NAME, FOUND['boards'], T0)
        with redirect_stdout(io.StringIO()):
            board_web.search(SEARCH, [], client=self.client, data={}, now=T0)   # its ideas and stamp live in this dict only, then the process is gone
        board_web._searched.clear()   # a new process: no search yet in its run
        with redirect_stdout(io.StringIO()):
            found = board_web.search(SEARCH, [], client=Gated(self.gate), data={}, now=T0)
        self.assertEqual([board['name'] for board in found], ['englishjobs.dk'], 'the answer was dropped before its stamp was saved')
        self.assertEqual(self.client.asked, [])

    def test_a_failed_save_never_discards_the_answer(self):
        self.gate.set()
        with redirect_stdout(io.StringIO()) as log, mock.patch('src.paths.write_whole', side_effect=OSError('read-only')):
            found = board_web.search(SEARCH, [], client=self.client, data={}, now=T0)
        self.assertEqual([board['name'] for board in found], ['englishjobs.dk'])
        self.assertIn('could not be saved', log.getvalue())

    def test_another_strategy_never_takes_the_saved_answer(self):
        web_answers.keep(RAW_NAME, FOUND['boards'], T0)
        other = ('k-nurse', ['Denmark'], ['nurse'], ['any'], ['copenhagen'])
        elsewhere = ('k-civil', ['Denmark'], ['civil engineer'], ['any'], ['aarhus'])   # the same key, other place words
        for change in (other, elsewhere):
            with redirect_stdout(io.StringIO()), mock.patch('src.ai.board_ideas.asked_for', return_value=change):
                self.gate.set()
                board_web._searched.clear()
                board_web.search(SEARCH, [], client=self.client, data={}, now=T0)
        self.assertEqual(len(self.client.asked), 2, 'a strategy change reused another search\'s answer')

    def test_a_saved_answer_older_than_a_day_is_asked_again(self):
        then = T0
        web_answers.keep(RAW_NAME, FOUND['boards'], at=then)
        self.gate.set()
        with redirect_stdout(io.StringIO()):
            board_web.search(SEARCH, [], client=self.client, now=then + timedelta(hours=web_answers.RAW_HOURS, minutes=1), data={})
        self.assertEqual(len(self.client.asked), 1, 'an answer past its day was judged as if new')

    def test_judging_a_saved_answer_counts_one_search_not_two(self):
        # The asking run stamped and counted its thin try, the stamp reached the disk, the run ended before the judging: the next run judges the saved
        # answer and must not count a second try or move the stamp.
        web_answers.keep(RAW_NAME, FOUND['boards'], T0)
        stored = {'web': {'k-civil': T0.isoformat(timespec='seconds')}, 'web_thin': {'k-civil': 1}}
        with redirect_stdout(io.StringIO()):
            board_web.search(SEARCH, [], client=Gated(self.gate), data=stored, now=T0 + timedelta(hours=2))
        self.assertEqual(stored['web_thin']['k-civil'], 1, 'one real search was counted twice')
        self.assertEqual(stored['web']['k-civil'], T0.isoformat(timespec='seconds'), 'the stamp moved to a time nothing was searched')

    def test_judging_a_saved_answer_whose_asking_run_left_no_stamp_counts_it_once_at_its_own_time(self):
        web_answers.keep(RAW_NAME, FOUND['boards'], T0)
        stored = {}
        with redirect_stdout(io.StringIO()):
            board_web.search(SEARCH, [], client=Gated(self.gate), data=stored, now=T0 + timedelta(hours=2))
        self.assertEqual(stored['web_thin']['k-civil'], 1)
        self.assertEqual(stored['web']['k-civil'], T0.isoformat(timespec='seconds'), 'the stamp is when the search was asked, not when it was judged')


if __name__ == '__main__':
    unittest.main()
