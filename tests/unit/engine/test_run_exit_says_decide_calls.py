"""A press that is hard-stopped at its deadline still says how many AI calls each kind made (#3339, 6 Nov 2026; night p1 Sofia's log had no `AI decide calls` line, so
the nightly's "AI calls" counter read low exactly on the slow presses): src/run_exit.py ends the process with os._exit, which skips atexit, where decide said it."""
import subprocess
import sys
import unittest

PROGRAM = '''
import threading, time
from src import run_exit, time_budget
from src.ai import decide
decide.WAITING['calls'].update({'role-kind': 2, 'pool-country': 1})
threading.Thread(target=lambda: time.sleep(30)).start()   # a site read still open at the deadline
time_budget.start(1)
run_exit.finish(0)
'''


class HardStop(unittest.TestCase):
    def test_a_press_cut_by_the_hard_stop_still_says_its_decide_calls(self):
        run = subprocess.run([sys.executable, '-c', PROGRAM], capture_output=True, text=True, timeout=20)
        self.assertIn('site read(s) still open', run.stderr, 'positive control: the process was hard-stopped, not exited')
        self.assertIn('AI decide calls: pool-country 1, role-kind 2', run.stderr)


if __name__ == '__main__':
    unittest.main()
