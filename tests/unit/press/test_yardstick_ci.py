"""Guard: release — the yardstick's last step (tools/press-yardstick/ci.py) compares a PR only with a band of main built on the same recordings and
personas; a band of other personas or of re-made recordings would read a lost job as "no change" (Gitar on #3594)."""
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('press_yardstick_ci', ROOT / 'tools' / 'press-yardstick' / 'ci.py')
ci = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ci)

JUDGED = {'rows': [{'title': 'Nurse', 'company': 'St Mary', 'location': 'Dublin', 'role': 'yes', 'place': 'yes'}]}
JOBS = [{'title': 'Nurse', 'company': 'St Mary', 'location': 'Dublin', 'seen_s': 10, 'fit': 80, 'scored_s': 20}]


def artifact(art, persona, side, jobs=True):
    """One replay job's artifact: result/ with the recording's judged.json and ceiling, and the replay's jobs-1.json unless it crashed."""
    result = Path(art, f'yardstick-{persona}-{side}', 'result')
    (result / 'ceiling').mkdir(parents=True)
    (result / 'judged.json').write_text(json.dumps(JUDGED))
    (result / 'ceiling' / 'jobs-1.json').write_text(json.dumps(JOBS))
    if jobs:
        (result / 'jobs-1.json').write_text(json.dumps(JOBS))


class YardstickCi(unittest.TestCase):
    def band(self, root, crashed=()):
        art = Path(root, 'band-art')
        for side in ('main-1', 'main-2'):
            for persona in ('p1', 'p2'):
                artifact(art, persona, side, jobs=(persona, side) not in crashed)
        with redirect_stdout(io.StringIO()):
            ci.band_mode(art, Path(root, 'band-out'))
        return json.loads(Path(root, 'band-out', 'band.json').read_text())

    def test_a_band_counts_only_on_the_same_recordings_and_personas(self):
        with tempfile.TemporaryDirectory() as root:
            band = self.band(root)
            recordings = Path(root, 'band-out', 'recordings')
            self.assertEqual(ci.comparable(band, recordings, '1', ['p1', 'p2'])[1], None, 'positive control: same recordings, same personas')
            self.assertIn('measured', ci.comparable(band, recordings, '1', ['p1'])[1], 'one persona fewer is not compared')
            (recordings / 'p2' / 'judged.json').write_text(json.dumps({'rows': []}))
            self.assertIn('other recordings', ci.comparable(band, recordings, '1', ['p1', 'p2'])[1], 'a re-made recording is not compared')

    def test_a_persona_one_replay_of_main_lost_is_left_out_of_the_band(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(self.band(root, crashed={('p2', 'main-2')})['personas']['1'], ['p1'])

    def test_a_crashed_replay_is_named_in_the_summary(self):
        with tempfile.TemporaryDirectory() as root:
            art = Path(root, 'art')
            for persona in ('p1', 'p2'):
                artifact(art, persona, 'main')
                artifact(art, persona, 'pr', jobs=persona == 'p1')
            out = io.StringIO()
            with mock.patch.object(ci, 'newest_band', return_value={}), redirect_stdout(out):
                ci.pr(art, Path(root, 'out'))
            self.assertIn('crashed or missing on this ref (left out', out.getvalue())
            self.assertIn(': p2', out.getvalue())

    def test_a_stale_recording_is_named_main_decides_and_a_pr_only_report_stands(self):
        with tempfile.TemporaryDirectory() as root:
            art = Path(root)

            def report(name, **counts):
                (art / name).mkdir()
                (art / name / 'tape-report.jsonl').write_text(json.dumps({'mode': 'replay', **counts}) + '\n')
            report('yardstick-p11-main', web_tape=209, web_missing=551)      # stale: 72 % of the pages missing
            report('yardstick-p17-pr', web_tape=100, web_missing=40)         # a PR-only report: its gap stands
            report('yardstick-p17-main', web_tape=100, web_missing=1)        # ... until main, under the bounds, says otherwise
            report('yardstick-p18-pr', web_tape=164, web_missing=1, ai_tape=28, ai_missing=1)   # fresh: under both bounds
            report('yardstick-p5-pr', web_tape=10, web_missing=5)            # only the PR replayed it
            self.assertEqual(ci.recording_gaps(art), {'p11': (551, 760, 0, 0), 'p5': (5, 15, 0, 0)})


if __name__ == '__main__':
    unittest.main()
