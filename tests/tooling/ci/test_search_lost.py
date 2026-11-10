"""Guard: release — a Find jobs source getting lost must turn the night red and be told once on the Engineering channel (finish-line G6; owner, 10 Nov 2026:
"If a source is getting lost · We should have red CI · We should have alerts"), and a blind night (no AI answered) must never read as a lost source.
tools/persona-search/lost.py + the compare job's wiring."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/persona-search'))
import lost  # noqa: E402

STEPS = ('employer_sites', 'job_boards', 'free_job_apis')


def person(n, sources=None, step_yield=None, **extra):
    return {'persona': n, **({'sources': sources} if sources is not None else {}), **({'step_yield': step_yield} if step_yield is not None else {}), **extra}


def night(employer_right, eures_right=0, eures='on', count=3):
    """A run whose persons each carry `sources`: employer_sites and eures right per person."""
    return {'state': 'green', 'rows': [], 'personas': [person(n, {'employer_sites': {'right': employer_right}, 'eures': {'right': eures_right},
                                                                  'web_search': {'status': 'not measured'}}, eures=eures) for n in range(1, count + 1)]}


def read(steps):
    return [{'step': step, 'jobs': jobs} for step, jobs in steps.items()]


class Gone(unittest.TestCase):
    def test_a_source_right_on_three_runs_and_none_now_is_red(self):
        causes = lost.gone(night(0, eures_right=2), [night(4), night(5), night(3)])
        self.assertEqual([(c['kind'], c['what'], c['red']) for c in causes], [('gone', 'employer_sites', True)])
        self.assertIn('0 right now, 12 / 15 / 9', causes[0]['detail'])

    def test_it_arms_only_after_three_runs_carry_sources(self):
        self.assertEqual(lost.gone(night(0), [night(4), night(5), {'personas': [person(1)]}]), [], 'a run before the count existed is no evidence')
        self.assertEqual(lost.gone(night(0), [night(4), night(5), night(0)]), [], 'one of the 3 already at 0: not "gone now"')

    def test_eures_counts_only_where_the_row_read_it_and_a_status_is_never_zero(self):
        self.assertEqual(lost.totals(night(1, eures_right=3, eures='off')), {'employer_sites': 3}, 'EURES off: its word is left out; a {status} word is left out')
        self.assertEqual(lost.gone(night(1, eures='off'), [night(1, 2), night(1, 2), night(1, 2)]), [], 'EURES off tonight is not EURES lost')


class Unread(unittest.TestCase):
    def test_a_step_that_read_no_job_for_anyone_is_red(self):
        verdict = {'personas': [person(n, step_yield=read({'employer_sites': 0, 'job_boards': 3})) for n in range(1, 7)]}
        self.assertEqual({c['what'] for c in lost.unread(verdict)}, {'employer_sites', 'free_job_apis'}, 'a step absent for everyone read nothing too')

    def test_a_few_persons_or_unmeasured_ones_are_no_evidence(self):
        few = {'personas': [person(n, step_yield=read({'job_boards': 3})) for n in range(1, 6)]}
        self.assertEqual(lost.unread(few), [])
        blind = {'personas': [person(n, step_yield=[], not_run='queue full') for n in range(1, 19)]}
        self.assertEqual(lost.unread(blind), [], 'no AI answered: never a lost step')


class Check(unittest.TestCase):
    def run_check(self, verdict, earlier=()):
        with tempfile.TemporaryDirectory() as tmp:
            dirs = []
            for i, old in enumerate(earlier):
                Path(tmp, str(i)).mkdir()
                Path(tmp, str(i), 'verdict.json').write_text(json.dumps(old), encoding='utf-8')
                dirs.append(str(Path(tmp, str(i))))
            path = Path(tmp, 'verdict.json')
            path.write_text(json.dumps(verdict), encoding='utf-8')
            code = lost.check(path, dirs)
            return code, json.loads(path.read_text(encoding='utf-8'))['lost']

    def test_a_lost_source_exits_red_and_a_broken_floor_is_told(self):
        tonight = {**night(0), 'floors': {'red': [{'persona': 4, 'number': 'right', 'floor': 9, 'now': 2}], 'merges': ['Read X (#1)']}}
        code, out = self.run_check(tonight, [night(4)] * 3)
        self.assertEqual(code, lost.RED)
        self.assertEqual({(c['kind'], c['what']) for c in out['causes']}, {('gone', 'employer_sites'), ('floor', 'right')})
        self.assertEqual(out['merges'], ['Read X (#1)'])

    def test_a_blind_night_is_told_never_red_never_green_again(self):
        blind = {'state': 'not-run', 'rows': [{'persona': n, 'kind': 'not-run', 'why': 'not run: Codex broker: queue full'} for n in range(1, 19)], 'personas': []}
        code, out = self.run_check(blind, [{**night(4), 'lost': {'red': True}}])
        self.assertEqual(code, 0)
        self.assertEqual([(c['kind'], c['red'], len(c['people'])) for c in out['causes']], [('not-run', False, 18)])
        self.assertEqual(out['causes'][0]['detail'], 'Codex broker: queue full')
        self.assertFalse(out['green_again'])

    def test_green_again_once_after_a_red_run(self):
        code, out = self.run_check(night(4), [{**night(0), 'lost': {'red': True}}, night(4)])
        self.assertEqual((code, out['causes'], out['green_again']), (0, [], True))
        _, quiet = self.run_check(night(4), [{**night(4), 'lost': {'red': False, 'green_again': True}}])
        self.assertFalse(quiet['green_again'], 'told once, then silence')


class Wiring(unittest.TestCase):
    def test_the_night_reds_on_g6_and_only_a_full_main_run_tells_the_owner(self):
        text = (ROOT / '.github/workflows/search-personas.yml').read_text(encoding='utf-8')
        self.assertIn('python3 tools/persona-search/lost.py check result/verdict.json "${mains[@]}"', text)
        self.assertIn('test "$LOST" != 1', text)
        tell = text[text.index('- name: Tell the Engineering channel (G6)'):text.index("- name: The table in the run's summary")]
        self.assertIn("github.ref == 'refs/heads/main'", tell)
        self.assertIn('continue-on-error: true', tell)
        self.assertIn('node search-alert.mjs', tell)
        self.assertLess(text.index('- name: A source lost (G6)'), text.index("path: result/verdict.json, retention-days: 90"), '`lost` is stored before the verdict is kept: the next night reads it')


if __name__ == '__main__':
    unittest.main()
