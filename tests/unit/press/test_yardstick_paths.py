"""Guard: release — the Find jobs yardstick starts on every src file the run reaches (tools/press-yardstick/paths.py); a hand list missed feeds.py, features.py and
aggregators.py, so a PR that changed what a person sees ran no yardstick (10 Nov 2026, plan ys 1/2). Also: replays use the EURES reader a recording was made with."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def load(file):
    spec = importlib.util.spec_from_file_location(file.stem + '_for_test', file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


paths = load(ROOT / 'tools' / 'press-yardstick' / 'paths.py')
replay = load(ROOT / 'tools' / 'press-yardstick' / 'replay.py')


class YardstickPaths(unittest.TestCase):
    def test_the_workflow_lists_what_the_run_reaches(self):
        self.assertEqual(paths.check(), '', 'run: python3 tools/press-yardstick/paths.py and put the lines in press-yardstick.yml')

    def test_the_files_that_decide_what_is_kept_or_read_start_it(self):
        left_out = {entry[1:] for entry in paths.entries() if entry.startswith('!')}
        for file in ('src/sources/feeds.py', 'src/features.py', 'src/sources/aggregators.py', 'src/geo.py', 'src/places.py', 'src/job_rank.py',
                     'src/first_jobs.py', 'src/press/clock.py', 'src/daily_search.py'):
            self.assertNotIn(file, left_out, f'{file} decides what a Find jobs run keeps, reads or scores')
        self.assertIn('src/ai/inbox.py', left_out, 'positive control: the inbox reader is never imported by a Find jobs run')

    def test_a_recording_made_without_eures_is_replayed_without_it(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertTrue(replay.recorded_eures(root), 'every recording made before the switch has the reader')
            Path(root, 'recorded.json').write_text(json.dumps({'model_override': 'x'}))
            self.assertTrue(replay.recorded_eures(root))
            Path(root, 'recorded.json').write_text(json.dumps({'model_override': 'x', 'eures': False}))
            self.assertFalse(replay.recorded_eures(root))


if __name__ == '__main__':
    unittest.main()
