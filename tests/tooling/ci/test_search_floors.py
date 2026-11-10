"""Guard: release — a Find jobs number that falls under the level it held for 3 nights must turn the night red, or one session's gain is undone by the
next unseen (#3685's first build halved scoring; 30 Oct to 5 Nov read 0 right jobs every night). Floors only rise; only the owner's words lower one (finish-line G2).
tools/persona-search/floors.py: pure update + the state's shape + the compare-and-swap save + the PR's Floor-change check."""
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/persona-search'))
import floors  # noqa: E402

CHAIN = 'codex,claude'


def night(people, eures='off'):
    """people: {n: (kind, raw row)} -> a verdict as gate.compare writes it: `inout` on the verdict row (inout.attach), the rest under `personas`."""
    return {'state': 'success', 'eures': eures, 'rows': [{'persona': n, 'kind': kind, **({'inout': row['inout']} if 'inout' in row else {})} for n, (kind, row) in people.items()],
            'personas': {str(n): {'persona': n, **{k: v for k, v in row.items() if k != 'inout'}} for n, (_, row) in people.items()}}


def run(nights, state=None, resets=()):
    report = None
    for i, verdict in enumerate(nights):
        state, report = floors.update(state, verdict, CHAIN, f'r{i}', f'2026-11-{10 + i:02d}', resets)
    return state, report


def entry(state, n, number):
    (series,) = state['series'].values()
    return series['people'][str(n)][number]


class FloorsOnlyRise(unittest.TestCase):
    def test_a_floor_is_the_best_level_held_3_nights_in_a_row_and_never_falls(self):
        state, report = run([night({1: ('measured', {'local': v})}) for v in (5, 6, 7, 8)])
        self.assertEqual(entry(state, 1, 'right')['floor'], 6)
        state, report = run([night({1: ('none-right', {'local': 3})})], state)
        self.assertEqual((entry(state, 1, 'right')['floor'], entry(state, 1, 'right')['below'], report['red']), (6, 1, []), 'one night under: not red yet')
        state, report = run([night({1: ('none-right', {'local': 3})})], state)
        self.assertEqual([(r['persona'], r['number'], r['floor'], r['now']) for r in report['red']], [(1, 'right', 6, 3)])
        self.assertEqual(entry(state, 1, 'right')['floor'], 6, 'a red night never lowers the floor')
        state, report = run([night({1: ('measured', {'local': 6})})], state)
        self.assertEqual((report['red'], entry(state, 1, 'right')['below']), ([], 0))

    def test_a_floor_outlives_the_nights_that_set_it(self):
        state, _ = run([night({1: ('measured', {'local': 6})})] * 3 + [night({1: ('measured', {'local': 5})})] * 14)
        self.assertEqual(len(entry(state, 1, 'right')['levels']), floors.KEEP)
        self.assertEqual(entry(state, 1, 'right')['floor'], 6, 'the 6s left the kept levels; the floor they set stays')

    def test_inside_the_persons_spread_is_not_under(self):
        state, _ = run([night({1: ('measured', {'local': 6})})] * 3)
        state, report = run([night({1: ('measured', {'local': 5})})] * 2, state)
        self.assertEqual(report['red'], [], 'one job under a floor of 6, with fewer than 5 levels, is inside the spread')

    def test_seconds_to_first_job_is_a_ceiling_that_only_falls(self):
        state, _ = run([night({1: ('measured', {'local': 1, 'counters': {'firstS': s}})}) for s in (90, 80, 70, 60, 60, 60)])
        self.assertEqual(entry(state, 1, 'first_s')['floor'], 60)
        state, report = run([night({1: ('measured', {'local': 1, 'counters': {'firstS': 200}})})] * 2, state)
        self.assertEqual([(r['number'], r['floor'], r['now']) for r in report['red']], [('first_s', 60, 200)])

    def test_eures_in_equals_out_is_a_share(self):
        rows = [night({2: ('measured', {'local': 1, 'inout': {'eures': {'in': 10, 'out': out, 'lost': {}}}})}) for out in (8, 9, 10)]
        state, _ = run(rows)
        self.assertEqual(entry(state, 2, 'eures_inout')['floor'], 0.8)


class WhatNeverCounts(unittest.TestCase):
    def test_not_run_unmeasured_faults_and_second_tries_add_no_level(self):
        state, report = run([night({1: ('not-run', {'local': 0}), 2: ('unmeasured', {'local': 0}), 3: ('fault', {'local': 0}),
                                    4: ('measured', {'local': 9, 'again': 1}), 5: ('measured', {'local': 2})})])
        (series,) = state['series'].values()
        self.assertEqual(sorted(series['people']), ['5'])

    def test_a_new_measure_chain_or_eures_mode_is_its_own_series_and_the_old_one_is_kept(self):
        state, _ = run([night({1: ('measured', {'local': 4})})] * 3)
        state, _ = floors.update(state, night({1: ('measured', {'local': 1})}, eures='on'), CHAIN, 'r9', '2026-11-20')
        self.assertEqual(len(state['series']), 2)
        state, _ = floors.update(state, night({1: ('measured', {'local': 1})}), 'free-ai', 'r10', '2026-11-21')
        self.assertEqual(len(state['series']), 3)
        self.assertTrue(all(key.startswith(floors.measure() + '|') for key in state['series']))

    def test_only_the_owners_reset_lowers_a_floor_once(self):
        state, _ = run([night({1: ('measured', {'local': v})}) for v in (8, 8, 8)])
        reset = [{'persona': 1, 'number': 'right', 'from': '2026-11-13', 'words': 'the EURES reader moved'}]
        state, report = run([night({1: ('measured', {'local': 2})})], state, reset)
        self.assertIsNone(entry(state, 1, 'right')['floor'])
        self.assertEqual(entry(state, 1, 'right')['levels'], [['2026-11-10', 2]])
        state, _ = run([night({1: ('measured', {'local': 2})})] * 2, state, reset)
        self.assertEqual(entry(state, 1, 'right')['floor'], 2, 'applied once: later nights build the new floor')

    def test_a_night_that_measured_nobody_is_not_a_green_night(self):
        state, _ = run([night({1: ('measured', {'local': 4})})] * 3)
        green = next(iter(state['series'].values()))['last_green']
        state, report = floors.update(state, night({1: ('unmeasured', {'local': 0})}), CHAIN, 'r8', '2026-11-20', sha='f' * 40)
        (series,) = state['series'].values()
        self.assertEqual(series['last_green'], green, 'the merges since the last measured green night stay named')

    def test_a_reset_floors_cannot_apply_is_named_not_a_crash(self):
        bad = [{'persona': 1, 'num': 'right', 'from': '10 Nov', 'words': 'x'}]
        (gap,) = floors.reset_gaps([], bad, 'Floor-change: "x"')
        self.assertTrue(gap.startswith('an entry floors cannot apply'), gap)

    def test_a_reset_needs_the_owners_words_in_the_pr(self):
        new = [{'persona': 1, 'number': 'right', 'from': '2026-11-13', 'words': 'the EURES reader moved'}]
        self.assertEqual(floors.reset_gaps([], new, 'nothing said'), ['p1 right from 2026-11-13'])
        self.assertEqual(floors.reset_gaps([], new, 'Floor-change: "the EURES reader moved"'), [])
        self.assertEqual(floors.reset_gaps(new, new, ''), [], 'an old reset needs no new words')


class TheStateIsSafe(unittest.TestCase):
    def test_only_the_known_shape_is_written(self):
        state, _ = run([night({1: ('measured', {'local': 4})})] * 3)
        self.assertEqual(floors.validate(state), [])
        self.assertTrue(floors.validate({'version': 1, 'series': {'x': {}}}))
        self.assertTrue(floors.validate({'version': 1, 'series': {}, 'extra': 1}))
        bad = json.loads(json.dumps(state))
        next(iter(bad['series'].values()))['people']['1']['<script>'] = {}
        self.assertTrue(floors.validate(bad))

    def test_save_refuses_a_bad_shape_and_never_forces_over_a_moved_state(self):
        state, _ = run([night({1: ('measured', {'local': 4})})] * 3)
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {'GITHUB_REPOSITORY': 'o/r'}):
            path = Path(tmp, 's.json')
            path.write_text(json.dumps({'base': None, 'state': {'version': 2}}))
            with redirect_stdout(io.StringIO()):
                self.assertEqual(floors.save_main(path), 1)
            path.write_text(json.dumps({'base': 'a' * 40, 'state': state}))
            calls = []

            def gh(*args, payload=None):
                calls.append(args)
                if '-X' in args and 'PATCH' in args:
                    assert payload['force'] is False
                    raise RuntimeError('Update is not a fast forward')
                return {'sha': 'b' * 40}
            out = io.StringIO()
            with mock.patch.object(floors, 'gh', side_effect=gh), redirect_stdout(out):
                self.assertEqual(floors.save_main(path), 0)
            self.assertIn('not saved (the state moved', out.getvalue())
            self.assertEqual(sum('PATCH' in a for a in calls), 1, 'no retry over a moved state, no force')

    def test_a_failed_save_is_red_not_silent(self):
        state, _ = run([night({1: ('measured', {'local': 4})})] * 3)
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {'GITHUB_REPOSITORY': 'o/r'}), \
                mock.patch.object(floors, 'gh', side_effect=RuntimeError('HTTP 403: Resource not accessible by integration')), redirect_stdout(io.StringIO()):
            path = Path(tmp, 's.json')
            path.write_text(json.dumps({'base': None, 'state': state}))
            self.assertEqual(floors.save_main(path), 1)

    def test_a_crash_in_the_floors_is_not_checked_never_red(self):
        with tempfile.TemporaryDirectory() as tmp:
            verdict = Path(tmp, 'verdict.json')
            verdict.write_text(json.dumps(night({1: ('measured', {'local': 0})})))
            with mock.patch.object(floors, 'read_state', return_value=('c' * 40, {'version': 1, 'series': {}})), \
                    mock.patch.object(floors, 'update', side_effect=AttributeError('list has no get')), redirect_stdout(io.StringIO()):
                self.assertEqual(floors.check(verdict, Path(tmp, 'new.json'), night=True), 0)
            self.assertFalse(json.loads(verdict.read_text())['floors']['checked'])

    def test_an_unreadable_state_is_not_checked_never_red_never_a_guessed_floor(self):
        with tempfile.TemporaryDirectory() as tmp:
            verdict = Path(tmp, 'verdict.json')
            verdict.write_text(json.dumps(night({1: ('measured', {'local': 0})})))
            with mock.patch.object(floors, 'read_state', side_effect=RuntimeError('HTTP 502')), redirect_stdout(io.StringIO()):
                self.assertEqual(floors.check(verdict, Path(tmp, 'new.json'), night=True), 0)
            written = json.loads(verdict.read_text())
            self.assertEqual(written['floors'], {'checked': False, 'why': 'state unreadable: RuntimeError: HTTP 502'})
            self.assertEqual(written['measure'], floors.measure())
            self.assertFalse(Path(tmp, 'new.json').exists())

    def test_a_red_night_fails_and_hands_the_state_on_a_by_hand_run_never_writes(self):
        state, _ = run([night({1: ('measured', {'local': 6})})] * 3 + [night({1: ('measured', {'local': 1})})])
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(floors, 'read_state', return_value=('c' * 40, state)), \
                mock.patch.object(floors, 'merges_since', return_value=['[sf] 2/8 Find jobs scores the nearest jobs first (#3685)']), redirect_stdout(io.StringIO()):
            verdict = Path(tmp, 'verdict.json')
            verdict.write_text(json.dumps(night({1: ('measured', {'local': 1})})))
            self.assertEqual(floors.check(verdict, Path(tmp, 'byhand.json'), night=False), 0)
            self.assertFalse(Path(tmp, 'byhand.json').exists())
            verdict.write_text(json.dumps(night({1: ('measured', {'local': 1})})))
            self.assertEqual(floors.check(verdict, Path(tmp, 'new.json'), night=True), floors.RED)
            written = json.loads(verdict.read_text())['floors']
            self.assertEqual(written['merges'], ['[sf] 2/8 Find jobs scores the nearest jobs first (#3685)'], 'once per night, not per red number')
            self.assertNotIn('merges', written['red'][0])
            self.assertEqual(json.loads(Path(tmp, 'new.json').read_text())['base'], 'c' * 40)


if __name__ == '__main__':
    unittest.main()
