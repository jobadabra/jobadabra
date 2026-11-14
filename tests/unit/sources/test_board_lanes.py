"""A job board that sends nothing for a while gives its lane to the next board; a slow board that keeps asking keeps it (src/sources/board_lanes.py).
Why (xc, 14 Nov 2026, issue #4255): in 61 CI searches a board read from the first seconds stopped sending requests and held its lane to the search's
end (c02 Vienna 5 of 5 searches, c04 Madrid 2 of 3, d03 Chisinau 2 of 3); d03's rabota.md fetched its pages to +21.8 s, then nothing until the cut at
124 s, while the same board on an identical search read on to +226 s. A fake clock here; the found_boards.read case is in test_board_lane_read.py."""
import threading
import time
import unittest
from unittest import mock

from src.sources import board_lanes


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


class BoardLanes(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.lanes = board_lanes.Lanes(1, quiet_s=20, clock=self.clock)

    def test_a_board_that_sends_nothing_for_the_quiet_time_gives_its_lane_to_the_next(self):
        self.assertTrue(self.lanes.take('rabota.md'))
        self.lanes.touch('rabota.md')   # its last request, at +21.8 s in the d03 search
        self.clock.now = 19.9
        self.assertFalse(self.lanes.free_quiet(), 'still inside its quiet time')
        self.clock.now = 20.1
        self.assertEqual(self.lanes.free_quiet(), ['rabota.md'])
        self.assertTrue(self.lanes.take('delucru.md', wait=0), 'the next board takes the freed lane at once')

    def test_a_slow_board_that_asks_every_15_seconds_keeps_its_lane(self):
        """sa, 14 Nov 2026: the bound is a hang guard, not a judgment of a slow site (rabota.md's requests came 1-15 s apart)."""
        self.assertTrue(self.lanes.take('slow.example'))
        for second in range(15, 181, 15):
            self.clock.now = second
            self.lanes.touch('slow.example')
            self.assertEqual(self.lanes.free_quiet(), [], f'at {second} s')
        self.assertFalse(self.lanes.take('next.example', wait=0), 'the lane is still the slow board\'s')

    def test_a_freed_board_that_ends_later_gives_back_nothing_twice(self):
        self.lanes.take('rabota.md')
        self.clock.now = 30
        self.lanes.free_quiet()
        self.lanes.take('delucru.md', wait=0)
        self.lanes.give_back('rabota.md')   # its thread came back and ended: its lane was already given
        self.assertFalse(self.lanes.take('third.example', wait=0), 'one lane, held by delucru.md: never two boards on one lane')
        self.lanes.give_back('delucru.md')
        self.assertTrue(self.lanes.take('third.example', wait=0))

    def test_a_board_waiting_for_a_lane_frees_a_quiet_one_itself(self):
        """No watcher thread and no timer: the board that waits looks, each time it would wait."""
        self.lanes.take('rabota.md')
        self.clock.now = 25
        took = []
        waiter = threading.Thread(target=lambda: took.append(self.lanes.take('delucru.md', wait=5)))
        waiter.start()
        waiter.join(10)
        self.assertEqual(took, [True])
        self.assertEqual(self.lanes.freed, ['rabota.md'], 'the log names the board that stopped answering')

    def test_never_more_boards_reading_than_lanes_besides_the_freed_ones(self):
        lanes = board_lanes.Lanes(2, quiet_s=20, clock=self.clock)
        self.assertTrue(lanes.take('a') and lanes.take('b'))
        self.assertFalse(lanes.take('c', wait=0))
        self.clock.now = 21
        lanes.touch('b')
        self.assertTrue(lanes.take('c', wait=0), 'a went quiet: c takes its lane')
        self.assertFalse(lanes.take('d', wait=0), 'b and c read: two lanes, both held')

    def test_boards_take_lanes_in_the_order_they_asked(self):
        """The list puts known boards first (boards_first): a board that asks later never jumps a board already waiting in line."""
        self.lanes.take('first.example')
        took = []
        with mock.patch.object(board_lanes, 'LOOK_S', 30):   # the waiting board sleeps until told: only the line decides
            second = threading.Thread(target=lambda: took.append(self.lanes.take('second.example', wait=10)), daemon=True)
            second.start()
            for _ in range(1000):
                if self.lanes.line:
                    break
                time.sleep(0.002)
            self.clock.now = 25   # first.example went quiet: its lane is free
            self.assertFalse(self.lanes.take('third.example', wait=0), 'second.example asked first')
            second.join(5)
        self.assertEqual(took, [True])
        self.assertIn('second.example', self.lanes.reading)

    def test_a_board_listed_earlier_takes_the_lane_before_one_whose_thread_asked_first(self):
        """Gitar on #4284: the line kept the order threads arrived in; a known board whose thread started late waited behind boards listed after it."""
        self.lanes.take('first.example')
        took = []
        with mock.patch.object(board_lanes, 'LOOK_S', 30):
            late = threading.Thread(target=lambda: took.append(('listed 5th', self.lanes.take('fifth.example', wait=10, rank=5))), daemon=True)
            late.start()
            for _ in range(1000):
                if self.lanes.line:
                    break
                time.sleep(0.002)
            self.clock.now = 25   # first.example went quiet: its lane is free
            self.assertTrue(self.lanes.take('second.example', wait=0, rank=1), 'the board listed 2nd goes before the one listed 5th')
            self.lanes.give_back('second.example')
            late.join(5)
        self.assertEqual(took, [('listed 5th', True)])

if __name__ == '__main__':
    unittest.main()
