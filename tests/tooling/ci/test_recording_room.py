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


if __name__ == '__main__':
    unittest.main()
