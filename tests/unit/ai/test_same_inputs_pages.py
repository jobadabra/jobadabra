"""Guard: release: a same-inputs pair says valid only when the two searches also read the same pages, so a search PR's yes or no never rests on a pair whose sides read different boards.
Why (14 Nov 2026, sa for the owner): a same-code control of b01 read 113 pages of one board on one side and 37 on the other, one side "still being read at the search's time", and the pair still said valid."""
import importlib.util
import json
import os
import tempfile
import unittest

from src import same_inputs

SPEC = importlib.util.spec_from_file_location('same_inputs_validity', os.path.join(os.path.dirname(__file__), '..', '..', '..', 'tools', 'persona-search', 'same_inputs_validity.py'))
validity = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validity)

CUT = "[124s] Job boards: OLX.bg Работа still being read at the search's time; read next time"
ROUND = "[21s] Job boards: OLX.bg Работа round 'шофьор на камион': 36 job(s) on the page, 36 new, 17 s (page 2 s · job links 9 s)"


class PageFlags(unittest.TestCase):
    def test_the_same_code_control_of_b01_is_flagged_with_the_board_named(self):
        reads = {'a': {'www.olx.bg': 113, 'www.trans.eu': 5}, 'b': {'www.olx.bg': 37, 'www.trans.eu': 5}}
        flags = validity.page_flags(reads, {'a': ['[4s] started', CUT], 'b': ['[4s] started', ROUND]})
        self.assertEqual(flags, ['www.olx.bg read 113 times on A, 37 on B', "OLX.bg Работа still being read at the search's time on A only"])

    def test_pairs_whose_counts_differ_by_less_than_twice_are_not_flagged(self):
        for a, b in ((25, 43), (65, 37), (14, 14)):   # c15 tes.com, the first b01 pair's olx.bg: what a normal pair does
            self.assertEqual(validity.page_flags({'a': {'h': a}, 'b': {'h': b}}, {'a': [], 'b': []}), [], (a, b))

    def test_a_small_host_is_not_flagged_however_uneven(self):
        self.assertEqual(validity.page_flags({'a': {'h': 20}, 'b': {'h': 1}}, {'a': [], 'b': []}), [])

    def test_d03_rabota_md_53_against_9_is_flagged(self):
        self.assertEqual(len(validity.page_flags({'a': {'www.rabota.md': 53}, 'b': {'www.rabota.md': 9}}, {'a': [], 'b': []})), 1)

    def test_a_board_cut_on_both_sides_is_not_a_difference(self):
        self.assertEqual(validity.page_flags({'a': {}, 'b': {}}, {'a': [CUT], 'b': [CUT]}), [])


class ReadsFromTheSharedLayer(unittest.TestCase):
    def test_the_rows_the_layer_writes_are_counted_per_side_and_host(self):
        with tempfile.TemporaryDirectory() as folder:
            same_inputs.folder = folder
            try:
                same_inputs._log('live', 'https://www.olx.bg/a', 1)
                same_inputs._log('own_again', 'https://www.olx.bg/b', 0)
                same_inputs._log('ai_live', 'ai-key', 3)
                same_inputs._log('exit', '{}', 0)
            finally:
                same_inputs.folder = ''
            logs = validity.read_logs(folder)
        reads = validity.reads_by_side(logs, {'a': same_inputs.SIDE, 'b': 'nobody'})
        self.assertEqual(reads, {'a': {'www.olx.bg': 2}, 'b': {}})

    def test_the_spread_of_a_control_decides_inside_or_outside(self):
        self.assertEqual(validity.against_spread(2, 3), 'inside')
        self.assertEqual(validity.against_spread(-4, 3), 'outside')
        self.assertEqual(validity.against_spread(0, 0), 'inside')


if __name__ == '__main__':
    unittest.main()
