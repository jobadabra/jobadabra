"""Guard: data — a Trello profile starved by the AI broker must read "not measured", never "0 right jobs", and a cancelled run must read "cancelled", in the CI table and the owner's Telegram line.
Why (13 Nov 2026, sa; Gitar on #3968): run 43354770712 told the owner "2 of 3 got 0 right jobs" while b02 and c06 waited p90 56-58 s on the broker
(Cluj found 18-21 on the Mac). The relay lines below are timings only, the shape codex.mjs writes."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import profiles  # noqa: E402


def relay(waits_ms):
    return ''.join(f'relay: small total {w + 3000} broker 3000 waited {w} in-flight 4 prompt-chars 10 kind a start 1 status 200 sent yes tools 0 out-tokens 5 engine codex\n'
                   for w in waits_ms)


def profile_folder(tmp, pid, waits_ms, right):
    out = Path(tmp) / f'search-profile-{pid}'
    (out / 'draw').mkdir(parents=True)
    (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'started': '2026-11-13T02:50:00Z', 'seconds': 180}) + '\n')
    rows = [{'role': 'yes', 'place': 'yes', 'first_seen': '2026-11-13T02:51:00Z'}] * right + [{'role': 'no', 'place': 'yes'}]
    (out / 'judged.json').write_text(json.dumps({'rows': rows, 'judged_jobs': len(rows), 'agreement': {'ai': ['codex']}}))
    (out / 'run.log').write_text('AI: codex / gpt-6-luna\n' + relay(waits_ms))
    (out / 'row.json').write_text(json.dumps(profiles.row(pid, out)))
    return out


class StarvedProfileTest(unittest.TestCase):
    def test_starved_row_is_not_measured_and_never_counted_as_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile_folder(tmp, 'b02', [4000] * 8 + [56000, 56500], right=0)   # p90 (nearest rank, 9th of 10) = 56 s
            profile_folder(tmp, 'b06', [4000] * 9 + [115000], right=0)   # one slow call: p90 = 4 s, measured
            profile_folder(tmp, 'c06', [1000] * 7 + [58000] * 3, right=1)
            rows = {r['id']: r for r in (json.loads(f.read_text()) for f in Path(tmp).rglob('row.json'))}
            self.assertEqual((rows['b02']['not_measured'], rows['b02']['starved']), ('not measured (waits p90 56 s)', True))
            self.assertNotIn('relevant', rows['b02'])
            self.assertEqual((rows['b06']['relevant'], rows['b06']['waits_p90_s']), (0, 4), 'positive control: a measured 0 stays a 0')
            profiles.table(tmp, Path(tmp) / 'table.md')
            table = (Path(tmp) / 'table.md').read_text()
            self.assertIn('| b02 | Cluj-Napoca | HR Generalist | not measured (waits p90 56 s) |', table)
            self.assertIn('| c06 | Prague | Car Mechanic | not measured (waits p90 58 s) |', table)
            lines = profiles.tell(Path(tmp) / 'rows.json', 'https://example.invalid/run', Path(tmp) / 'message.txt')
            self.assertIn('1 of 1 got 0 right jobs', lines, 'only the measured b06 counts as 0')
            self.assertEqual(lines[0], '🧪 Search profiles on CI · Codex · 1 of 3 measured', 'the text names the AI of its series (sa, 13 Nov 2026)')
            self.assertIn('2 not measured, the broker was too busy (waits p90 > 20 s): b02, c06', lines)

    def test_nothing_measured_names_every_group(self):
        with tempfile.TemporaryDirectory() as tmp:
            rows = Path(tmp) / 'rows.json'
            rows.write_text(json.dumps([{'id': 'b01', 'starved': True, 'not_measured': 'x'}, {'id': 'b03', 'not_run': 'held'}]))
            lines = profiles.tell(rows, 'https://example.invalid/run', Path(tmp) / 'message.txt')
            self.assertEqual(lines[1:3], ['1 not measured, the broker was too busy (waits p90 > 20 s): b01', '1 not run or not measured: b03'])

    def test_cancelled_run_says_cancelled_and_names_every_asked_profile(self):
        """Plays run 43355710034: 27 profiles asked, cancelled at 02:58Z, 6 uploaded a not-run row (mac-9a for the owner, 13 Nov 2026)."""
        with tempfile.TemporaryDirectory() as tmp:
            asked = [p['id'] for p in json.loads((ROOT / 'tools' / 'persona-search' / 'search-profiles.json').read_text())['profiles'] if p['id'] not in ('b02', 'b06', 'c06')]
            rows = Path(tmp) / 'rows.json'
            rows.write_text(json.dumps([{'id': pid, 'not_run': 'cancelled'} for pid in ('b01', 'b03', 'b04', 'b05', 'b07', 'b08')]))
            lines = profiles.tell(rows, 'https://example.invalid/run', Path(tmp) / 'message.txt', asked, 'cancelled')
            self.assertEqual(lines[0], '⚪ Search profiles on CI · cancelled on GitHub before measuring (27 profiles)')
            self.assertTrue(lines[1].startswith('27 not run or not measured: '), lines[1])
            self.assertNotIn('nothing measured', '\n'.join(lines))
            finished = profiles.tell(rows, 'https://example.invalid/run', Path(tmp) / 'message.txt', asked, 'success')
            self.assertEqual(finished[0], '🧪 Search profiles on CI · nothing measured (27 profiles)', 'positive control: a finished run keeps its words')


if __name__ == '__main__':
    unittest.main()
