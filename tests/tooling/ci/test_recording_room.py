"""Guard: money — a Find jobs recording that starts without room on its AI broker lane spends ~300 calls and is then cut by refused calls (the by-hand lane's 800 a day, owner 8 Nov 2026).
tools/persona-search/recording_room.py decides from the broker's /health counts; every count it cannot read is no room (Gitar on #3589), never zero used."""
import importlib.util
import pathlib
import unittest

_path = pathlib.Path(__file__).resolve().parents[3] / 'tools' / 'persona-search' / 'recording_room.py'
_spec = importlib.util.spec_from_file_location('recording_room', _path)
recording_room = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(recording_room)
room = recording_room.room

NOW = 1794000000
NEW = {'limits': {'usedPercent': 50}, 'daily': {'byhand': 100, 'drift': 0}, 'lines': {'week': {'pr': 100, 'byhand': 100, 'scheduled': 100}, 'daily': {'drift': 24, 'byhand': 800}, 'claude': 90}}


class RecordingRoom(unittest.TestCase):
    def test_room_on_both_lanes(self):
        self.assertTrue(room(NEW, 'byhand')[0])
        self.assertTrue(room(NEW, 'scheduled')[0])

    def test_each_unread_count_is_no_room(self):
        cases = {
            'no Codex week': ({**NEW, 'limits': {}}, 'scheduled'),
            'no limits at all': ({k: v for k, v in NEW.items() if k != 'limits'}, 'byhand'),
            "no day count for a capped lane": ({**NEW, 'daily': {'drift': 0}}, 'byhand'),
            'a day count that is not a number': ({**NEW, 'daily': {'byhand': 'x'}}, 'byhand'),
            'no line for the lane': ({**NEW, 'lines': {'week': {'pr': 100}, 'daily': {}}}, 'scheduled'),
        }
        for name, (health, lane) in cases.items():
            with self.subTest(name):
                ok, said = room(health, lane)
                self.assertFalse(ok)
                self.assertIn('does not say', said)

    def test_full_week_or_day_is_no_room(self):
        self.assertFalse(room({**NEW, 'limits': {'usedPercent': 97}}, 'scheduled')[0])
        self.assertFalse(room({**NEW, 'daily': {'byhand': 600}}, 'byhand')[0])
        self.assertTrue(room({**NEW, 'daily': {'byhand': 500}}, 'byhand')[0])

    def test_a_broker_before_the_lines_field(self):
        old = {'limits': {'usedPercent': 73}, 'daily': {'byhand': 301}}
        self.assertTrue(room(old, 'byhand')[0])
        self.assertFalse(room(old, 'scheduled')[0])
        self.assertFalse(room({**old, 'daily': {'byhand': 600}}, 'byhand')[0])

    def test_claude_has_room_when_codex_has_none(self):
        # owner via mac-9d, 8 Nov 2026: "One at a time, now, Codex then Claude (Recommended)"
        spent = {**NEW, 'limits': {'usedPercent': 99}}
        unknown = {**NEW, 'limits': None}
        week = lambda pct: {**NEW['lines'], 'claudeWeek': {'usedPercent': pct, 'resetsAt': NOW + 3600}}
        self.assertTrue(room({**spent, 'lines': week(40)}, 'scheduled', now=NOW)[0])
        self.assertTrue(room({**unknown, 'lines': week(40)}, 'scheduled', now=NOW)[0])
        self.assertFalse(room({**spent, 'lines': week(87)}, 'scheduled', now=NOW)[0])
        self.assertTrue(room({**spent, 'lines': week(None)}, 'scheduled', now=NOW)[0], 'a reported null is the broker allowing Claude')
        self.assertFalse(room({**spent, 'lines': {**week(40), 'daily': {'byhand': 800}}, 'daily': {'byhand': 600}}, 'byhand', now=NOW)[0], 'the day cap holds whichever engine answers')

    def test_claude_from_the_cli_window_before_web_493(self):
        chain = lambda used, resets: [{'name': 'codex', 'configured': True}, {'name': 'claude', 'configured': True, 'limits': {'sevenDay': {'utilization': used, 'resetsAt': resets}}}]
        unknown = {**NEW, 'limits': None}
        self.assertTrue(room({**unknown, 'chain': chain(0.04, NOW + 3600)}, 'scheduled', now=NOW)[0])
        self.assertFalse(room({**unknown, 'chain': chain(0.89, NOW + 3600)}, 'scheduled', now=NOW)[0])
        self.assertTrue(room({**unknown, 'chain': chain(0.89, NOW - 1)}, 'scheduled', now=NOW)[0], 'a reset window is a new week')
        self.assertFalse(room({**unknown, 'chain': [{'name': 'claude', 'configured': True}]}, 'scheduled', now=NOW)[0], 'no window reported = no Claude room')
        self.assertFalse(room({**unknown, 'chain': chain(0.04, NOW + 3600), 'lines': {k: v for k, v in NEW['lines'].items() if k != 'claude'}}, 'scheduled', now=NOW)[0], 'no Claude line = no Claude room')


if __name__ == '__main__':
    unittest.main()
