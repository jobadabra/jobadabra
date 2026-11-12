"""The scout's feed-pass timer (src/scout_timing.py): it counts the three local reads while the pass runs, prints one line, and leaves every function as it was."""
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from src import geo, paths, scout_timing
from src.ai import decide


class FeedPassTimingTest(unittest.TestCase):
    def test_counts_calls_while_the_pass_runs_and_restores_the_functions(self):
        before = (decide.kept, geo._read, paths.load_search_config)
        out, folder = io.StringIO(), tempfile.mkdtemp()
        with mock.patch.object(geo, 'STORE', Path(folder) / 'geo.json'), redirect_stdout(out), scout_timing.feed_pass(24) as tally:
            self.assertIsNot(decide.kept, before[0], 'wrapped during the pass')
            decide.kept('job-title-kind', [], db=decide._table(__import__('sqlite3').connect(':memory:')))
            geo.load()
        self.assertEqual((decide.kept, geo._read, paths.load_search_config), before, 'every function is back after the pass')
        self.assertEqual((tally.calls['answer-cache lookups'], tally.calls['place-file reads'], tally.calls['search-config reads']), (1, 1, 0))
        self.assertRegex(out.getvalue(), r'^Scout feed pass time \(24 workers x \d+ s = \d+ thread-seconds, reads after the pass ended not counted\): answer-cache lookups \d+ s in 1 calls, '
                                         r'place-file reads \d+ s in 1 calls, search-config reads 0 s in 0 calls\n$')

    def test_an_error_inside_the_pass_still_restores_the_functions(self):
        before = decide.kept
        with self.assertRaises(RuntimeError), redirect_stdout(io.StringIO()), scout_timing.feed_pass(1):
            raise RuntimeError('a feed pass that fails')
        self.assertIs(decide.kept, before)


if __name__ == '__main__':
    unittest.main()
