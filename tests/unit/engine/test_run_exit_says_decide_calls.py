"""A press that is hard-stopped at its deadline still says how many AI calls each kind made (#3339, 6 Nov 2026; night p1 Sofia's log had no `AI decide calls` line, so
the nightly's "AI calls" counter read low exactly on the slow presses): src/run_exit.py ends the process with os._exit, which skips atexit, where decide said it."""
import subprocess
import sys
import unittest

PROGRAM = '''
import atexit, sys, threading, time
from src import run_exit, time_budget
from src.ai import decide
decide.WAITING['calls'].update({'role-kind': 2, 'pool-country': 1})
atexit.register(lambda: print('an exit handler ran', file=sys.stderr, flush=True))   # as src/notify.py flush, src/run_result.py, src/search_tape.py _report
threading.Thread(target=lambda: time.sleep(30)).start()   # a site read still open at the deadline
time_budget.start(1)
run_exit.finish(0)
'''


class HardStop(unittest.TestCase):
    def test_a_press_cut_by_the_hard_stop_still_says_its_decide_calls(self):
        run = subprocess.run([sys.executable, '-c', PROGRAM], capture_output=True, text=True, timeout=20)
        self.assertIn('site read(s) still open', run.stderr, 'positive control: the process was hard-stopped, not exited')
        self.assertIn('AI decide calls: pool-country 1, role-kind 2', run.stderr)

    def test_a_press_cut_by_the_hard_stop_runs_every_exit_handler(self):
        """Why (lanes 2/5, 11 Nov 2026): os._exit skips atexit, where notifications are sent, the run's result is published and a replay counts its tape;
        since 2/5 every run with a call in flight at its deadline is hard-stopped, so every handler must run, not only decide's."""
        run = subprocess.run([sys.executable, '-c', PROGRAM], capture_output=True, text=True, timeout=20)
        self.assertIn('site read(s) still open', run.stderr, 'positive control: the process was hard-stopped, not exited')
        self.assertEqual(run.stderr.count('an exit handler ran'), 1, run.stderr[-1500:])
        self.assertEqual(run.stderr.count('AI decide calls'), 1, 'decide says its calls once')


    def test_an_exit_handler_that_never_returns_cannot_hold_the_hard_stop_and_is_said(self):
        """Why (lanes 2/5, sa's review, 11 Nov 2026): the handlers run at the hard stop now; one that hangs (a message that never sends) must not
        bring back the 175 s stop, and leaving without the rest is said."""
        hung = PROGRAM.replace("atexit.register(lambda: print('an exit handler ran'", "atexit.register(lambda: threading.Event().wait()); atexit.register(lambda: print('an exit handler ran'")
        self.assertNotEqual(hung, PROGRAM, 'positive control: the hanging handler is in the program')
        run = subprocess.run([sys.executable, '-c', hung], capture_output=True, text=True, timeout=30)   # the deadline is 1 s, the handlers' limit 5 s: a hang guard
        self.assertIn('the exit handlers did not end within', run.stderr, run.stderr[-1500:])
        self.assertIn('an exit handler ran', run.stderr, 'the handlers registered after the hanging one ran first (atexit runs the last registered first)')

    def test_a_call_in_flight_is_said_as_a_task_not_as_a_site_read(self):
        """Why (#3798, 11 Nov 2026): the scorer's call in flight is a pool worker, not a site read; the log said "site read(s)" for it."""
        scoring = PROGRAM.replace("threading.Thread(target=lambda: time.sleep(30)).start()",
                                  "from concurrent.futures import ThreadPoolExecutor\n"
                                  "threading.Thread(target=lambda: ThreadPoolExecutor(1).submit(time.sleep, 30), daemon=True).start(); time.sleep(0.2)")
        self.assertNotEqual(scoring, PROGRAM, 'positive control: the program opens a pool in a daemon thread, as the scorer does')
        run = subprocess.run([sys.executable, '-c', scoring], capture_output=True, text=True, timeout=20)
        self.assertIn('1 task(s) still running at the run\'s time', run.stderr, run.stderr[-1500:])
        self.assertNotIn('site read(s)', run.stderr)

    def test_an_open_read_keeps_the_runs_time_to_its_deadline(self):
        """Why (#3798, owner 11 Nov 2026, asked via AskUserQuestion: "Wait to the deadline (Recommended)"): the open reads' wait ended
        run_exit.HANDLERS (5 s) before the deadline, so every live run cut its last 5 s of work (lanes after-1: 130 s instead of 135 s); the
        exit handlers take under 1 s and run after the deadline, on their own limit."""
        reading = PROGRAM.replace("target=lambda: time.sleep(30)", "target=lambda: time.sleep(2)").replace("time_budget.start(1)", "time_budget.start(3)")
        self.assertIn("time.sleep(2)", reading, 'positive control: the read ends 1 s before the deadline')
        self.assertIn("time_budget.start(3)", reading, 'positive control: the run has 3 s')
        reading += "print('the read ended in the run\\'s time', flush=True)\n"
        run = subprocess.run([sys.executable, '-c', reading], capture_output=True, text=True, timeout=20)
        self.assertNotIn('still open', run.stderr, run.stderr[-1500:])
        self.assertIn("the read ended in the run's time", run.stdout, 'finish waited for the read and returned: no hard stop')


if __name__ == '__main__':
    unittest.main()
