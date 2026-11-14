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


def profile_folder(tmp, pid, waits_ms, right, ai='codex / gpt-6-luna', eures=None):
    out = Path(tmp) / f'search-profile-{pid}'
    (out / 'draw').mkdir(parents=True)
    (out / 'draw' / 'presses.jsonl').write_text(json.dumps({'started': '2026-11-13T02:50:00Z', 'seconds': 180, **({'eures': eures} if eures else {})}) + '\n')
    rows = [{'role': 'yes', 'place': 'yes', 'first_seen': '2026-11-13T02:51:00Z'}] * right + [{'role': 'no', 'place': 'yes'}]
    (out / 'judged.json').write_text(json.dumps({'rows': rows, 'judged_jobs': len(rows), 'agreement': {'ai': ['codex']}}))
    (out / 'run.log').write_text(f'AI: {ai}\n' + relay(waits_ms))
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
            self.assertIn('CI rows (Codex through the broker', table, 'the header names the AI of the rows, never a fixed word (Gitar on #3971)')
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
        """Plays run 43355710034: all but 3 profiles asked, cancelled at 02:58Z, 6 uploaded a not-run row (mac-9a for the owner, 13 Nov 2026)."""
        with tempfile.TemporaryDirectory() as tmp:
            asked = [p['id'] for p in json.loads((ROOT / 'tools' / 'persona-search' / 'search-profiles.json').read_text())['profiles'] if p['id'] not in ('b02', 'b06', 'c06')]
            n = len(asked)   # Why (13 Nov 2026, sa: 7 more profiles): the count follows search-profiles.json, never a number typed here
            rows = Path(tmp) / 'rows.json'
            rows.write_text(json.dumps([{'id': pid, 'not_run': 'cancelled'} for pid in ('b01', 'b03', 'b04', 'b05', 'b07', 'b08')]))
            lines = profiles.tell(rows, 'https://example.invalid/run', Path(tmp) / 'message.txt', asked, 'cancelled')
            self.assertEqual(lines[0], f'⚪ Search profiles on CI · cancelled on GitHub before measuring ({n} profiles)')
            self.assertTrue(lines[1].startswith(f'{n} not run or not measured: '), lines[1])
            self.assertNotIn('nothing measured', '\n'.join(lines))
            finished = profiles.tell(rows, 'https://example.invalid/run', Path(tmp) / 'message.txt', asked, 'success')
            self.assertEqual(finished[0], f'🧪 Search profiles on CI · nothing measured ({n} profiles)', 'positive control: a finished run keeps its words')

    def test_a_claude_round_is_named_claude_in_table_and_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile_folder(tmp, 'b04', [2000] * 5, right=14, ai='claude / claude-sonnet-5-5')
            profiles.table(tmp, Path(tmp) / 'table.md')
            self.assertIn('CI rows (Claude through the broker', (Path(tmp) / 'table.md').read_text())
            self.assertEqual(profiles.tell(Path(tmp) / 'rows.json', 'https://example.invalid/run', Path(tmp) / 'message.txt')[0], '🧪 Search profiles on CI · Claude · 1 of 1 measured')

    def test_row_counts_boards_that_gave_jobs_refused_and_cut(self):
        """sa for the owner (13 Nov 2026): per profile, boards that gave jobs, boards refused, boards cut at the end. Lines as run 43358450676's press logs write them."""
        with tempfile.TemporaryDirectory() as tmp:
            out = profile_folder(tmp, 'b01', [2000] * 5, right=1)
            (out / 'draw' / 'run-1.log').write_text('\n'.join([
                '[80s] Job boards found: jobup.ch 14 job(s), 2 relevant',
                '[90s] Job boards found: adecco.ch 1 job(s), 0 relevant',
                '[91s] Job boards found: ch.talent.com 0 job(s), 0 relevant',
                '[92s] Job boards found: Rabota.bg 0 job(s), 0 relevant (refuses automated reading, HTTP 403: offered as a visit)',
                '[93s] Job boards: Jobat refuses automated reading; reading Emplois Construction in its place',
                '[94s] ⏱ Time is up (1 min 28 s) for job boards: 3 board read waits for the next search',
                '[95s] ⏱ Time is up (1 min 29 s) for job boards: 1 board discovery waits for the next search']))   # not a board read: not counted (Gitar on #3975)
            row = profiles.row('b01', out)
            self.assertEqual((row['boards_read'], row['boards_gave_jobs'], row['boards_with_relevant'], row['boards_refused'], row['boards_cut']), (4, 2, 1, 2, 3))
            profiles.table(tmp, Path(tmp) / 'table.md')
            self.assertIn('| boards that gave jobs | boards with relevant | boards refused | boards cut at the end |', (Path(tmp) / 'table.md').read_text())


class EuresModeTest(unittest.TestCase):
    def test_the_table_header_says_eures_on_only_for_a_press_that_ran_with_it(self):
        """Gitar on #4170: the header said EURES off from a fixed string; it reads the press's own "eures" now (14 Nov 2026, owner: the card number is with EURES on)."""
        for mode, word in (('on', 'EURES on'), (None, 'EURES off')):
            with tempfile.TemporaryDirectory() as tmp:
                out = profile_folder(tmp, 'b04', [2000] * 5, right=3, eures=mode)
                self.assertEqual(json.loads((out / 'row.json').read_text())['eures_on'], mode == 'on')
                profiles.table(tmp, Path(tmp) / 'table.md')
                self.assertIn(f'fresh installs, {word}):', (Path(tmp) / 'table.md').read_text())
        with tempfile.TemporaryDirectory() as tmp:   # rows from two series in one folder are never labelled by one of them
            profile_folder(tmp, 'b04', [2000] * 5, right=3, eures='on')
            profile_folder(tmp, 'b06', [2000] * 5, right=3)
            profiles.table(tmp, Path(tmp) / 'table.md')
            self.assertIn('fresh installs, EURES mixed):', (Path(tmp) / 'table.md').read_text())


if __name__ == '__main__':
    unittest.main()
