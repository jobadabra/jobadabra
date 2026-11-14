"""Guard: release — a search PR held for its pending number (tools/ship-search-hold.sh) is let go only by its own pair, and only when no person fell beyond their usual difference.
Without it an unmeasured or worse search change becomes mergeable (owner via sa, 13 Nov 2026: "anything not a draft is safe to merge"), or a hold a person set is lifted by a tool.
Plays tools/persona-search/pair.py pending and settle on bodies shaped like a real PR's, and checks the lines it writes pass tools/pr-body-check.py."""
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import pair  # noqa: E402

spec = importlib.util.spec_from_file_location('pr_body_check', ROOT / 'tools' / 'pr-body-check.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)

BODY = ('🟢 A job board\'s first jobs are judged while the rest is still read\n\n'
        'Moves: p1 right jobs 0 → pending (1 run a side, same minute, usual difference 2)\n'
        '- Moves: p4 right jobs 20 → pending (1 run a side, same minute, usual difference not measured yet)\n')
TITLE = '[2d] DONT MERGE A job board\'s first jobs are judged while the rest is still read'


def done(**people):
    """measured()'s shape for (before, after, d) per person."""
    out = {}
    for person, (before, after, d) in people.items():
        out[person] = {'before': before, 'after': after, 'd': d, 'line': f'Moves: {person} right jobs {before:g} → {after:g} (1 run a side, same minute, usual difference '
                                                                       + (f'{d:g})' if d is not None else 'not measured yet)')}
    return out


class SearchHoldTest(unittest.TestCase):
    def test_pending_names_the_people_to_dispatch(self):
        self.assertEqual(pair.pending(BODY), [1, 4])
        self.assertEqual(pair.pending('Moves: b02 right jobs 3 → pending (1 run a side, same minute, usual difference not measured yet)'), ['b02'])
        for finished in ('Moves: p1 right jobs 0 → 9 (1 run a side, same minute, usual difference 2)', 'Moves: nothing (the run → pending later)',
                         'Moves: p1 right jobs 0 → 4 (1 run a side, same minute, usual difference 2; next → pending)'):
            self.assertEqual(pair.pending(finished), [], finished)

    def test_no_loss_lifts_ships_hold_and_the_written_body_passes_the_check(self):
        out = pair.settle(BODY, TITLE, ['search-hold'], done(p1=(0, 9, 2), p4=(20, 35, None)), ['p1', 'p4'], 1)
        self.assertTrue(out['lift'])
        self.assertEqual(out['title'], '[2d] A job board\'s first jobs are judged while the rest is still read')
        self.assertIn('Moves: p1 right jobs 0 → 9 (1 run a side, same minute, usual difference 2)', out['body'])
        self.assertIn('- Moves: p4 right jobs 20 → 35', out['body'])
        self.assertEqual(pair.pending(out['body']), [])
        self.assertIsNone(check.moves_gap(out['body'], ['src/sources/feeds.py']))
        self.assertIsNone(check.pending_gap(out['body'], out['title'], 'false'))   # ready and not a draft: no pending number left

    def test_a_loss_beyond_the_usual_difference_keeps_the_hold(self):
        out = pair.settle(BODY, TITLE, ['search-hold'], done(p1=(20, 6, 2), p4=(20, 20, None)), ['p1', 'p4'], 1)   # a spread of 2 is under the floor of 7: lost 14 is beyond it
        self.assertFalse(out['lift'])
        self.assertEqual(out['title'], TITLE)
        self.assertIn('p1 fell 20 → 6 (usual difference 7)', out['verdict'][0])
        self.assertIn('Moves: p1 right jobs 20 → 6', out['body'])   # the number is written either way

    def test_an_unmeasured_difference_allows_seven_jobs(self):   # 13 Nov 2026, sa: 7, not 1 (run 43498213279: the same code gave 8 vs 15)
        self.assertTrue(pair.settle(BODY, TITLE, ['search-hold'], done(p1=(12, 5, None), p4=(20, 40, None)), ['p1', 'p4'], 1)['lift'])
        self.assertFalse(pair.settle(BODY, TITLE, ['search-hold'], done(p1=(12, 4, None), p4=(20, 40, None)), ['p1', 'p4'], 1)['lift'])

    def test_a_side_not_valid_runs_once_more_then_reports(self):
        first = pair.settle(BODY, TITLE, ['search-hold'], done(p1=(0, 9, 2)), ['p1', 'p4'], 1, rerun=['p4'])
        self.assertFalse(first['lift'])
        self.assertIn('p4 not valid; the pair runs once more', first['verdict'][0])
        failed = pair.settle(BODY, TITLE, ['search-hold'], done(p1=(0, 9, 2)), ['p1', 'p4'], 1, rerun=[])   # the dispatch failed or the head moved: no promise of a second run (Gitar on #4077)
        self.assertNotIn('runs once more', failed['verdict'][0])
        self.assertEqual(pair.pending(first['body']), [4])
        second = pair.settle(first['body'], TITLE, ['search-hold'], {}, ['p4'], 2)
        self.assertFalse(second['lift'])
        self.assertIn('not valid twice', second['verdict'][0])
        third = pair.settle(first['body'], TITLE, ['search-hold'], done(p4=(20, 22, None)), ['p4'], 2)
        self.assertTrue(third['lift'])

    def test_a_loss_is_never_run_again(self):
        out = pair.settle(BODY, TITLE, ['search-hold'], done(p1=(9, 2, 2)), ['p1', 'p4'], 1)
        self.assertFalse(out['lift'])

    def test_a_person_who_never_searched_is_not_run_again(self):
        """Gitar on #3967: the turn gave up (no side ran); that is no "not valid" and the workflow must not queue a second long wait itself."""
        out = pair.settle(BODY, TITLE, ['search-hold'], {}, ['p1', 'p4'], 1, seen=set())
        self.assertFalse(out['lift'])
        self.assertIn('never searched', out['verdict'][0])
        out = pair.settle(BODY, TITLE, ['search-hold'], done(p1=(0, 9, 2)), ['p1', 'p4'], 1, seen={'p1'})

    def test_a_retitled_held_pr_loses_the_label_when_its_numbers_are_in(self):
        """Gitar on #3967: the label is the hold; a title without DONT MERGE still gets it lifted, the title unchanged."""
        out = pair.settle(BODY, '[2d] Read boards', ['search-hold'], done(p1=(0, 9, 2), p4=(20, 35, None)), ['p1', 'p4'], 1)
        self.assertTrue(out['lift'])
        self.assertEqual(out['title'], '[2d] Read boards')

    def test_a_pair_on_a_pr_ship_did_not_hold_never_runs_again(self):
        """13 Nov 2026, #3946: a by-hand pair with sides not valid queued a third run by itself; only ship's hold runs again, and its verdict says it is not a hold."""
        out = pair.settle(BODY, TITLE, [], done(p1=(0, 9, 2)), ['p1', 'p4'], 1)
        self.assertFalse(out['lift'])
        self.assertTrue(out['verdict'][0].startswith('Not held by ship'), out['verdict'])
        self.assertIn('fell 12 → 3 (usual difference not measured yet: 7 jobs allowed)', pair.settle(BODY, TITLE, ['search-hold'], done(p1=(12, 3, None)), ['p1'], 1)['verdict'][0])   # 13 Nov 2026, sa: 7, not 1 (pair_row.py)

    def test_a_hold_ship_did_not_set_is_never_lifted(self):
        out = pair.settle(BODY, TITLE, ['Gitar: approved'], done(p1=(0, 9, 2), p4=(20, 35, None)), ['p1', 'p4'], 1)
        self.assertFalse(out['lift'])
        self.assertEqual(out['title'], TITLE)
        self.assertEqual(pair.pending(out['body']), [])
        self.assertIn('lift it by hand', out['verdict'][0])


if __name__ == '__main__':
    unittest.main()
