"""Guard: release — a Find jobs source getting lost must turn the night red and be told once on the Engineering channel (finish-line G6; owner, 10 Nov 2026:
"If a source is getting lost · We should have red CI · We should have alerts"), and a blind night (no AI answered) must never read as a lost source.
tools/persona-search/lost.py + the compare job's wiring."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/persona-search'))
import floors  # noqa: E402
import lost  # noqa: E402

STEPS = ('employer_sites', 'job_boards', 'free_job_apis')


def person(n, sources=None, step_yield=None, **extra):
    return {'persona': n, **({'sources': sources} if sources is not None else {}), **({'step_yield': step_yield} if step_yield is not None else {}), **extra}


def night(employer_right, eures_right=0, eures='on', count=6):
    """A run whose persons each carry `sources`: employer_sites and eures right per person."""
    return {'state': 'green', 'rows': [], 'personas': [person(n, {'employer_sites': {'right': employer_right}, 'eures': {'right': eures_right},
                                                                  'web_search': {'status': 'not measured'}}, eures=eures) for n in range(1, count + 1)]}


def read(steps):
    return [{'step': step, 'jobs': jobs} for step, jobs in steps.items()]


class Gone(unittest.TestCase):
    def test_a_source_right_on_three_runs_and_none_now_is_red(self):
        causes = lost.gone(night(0, eures_right=2), [night(4), night(5), night(3)])
        self.assertEqual([(c['kind'], c['what'], c['red']) for c in causes], [('gone', 'employer_sites', True)])
        self.assertIn('0 right now, 24 / 30 / 18', causes[0]['detail'])

    def test_it_arms_only_after_three_runs_carry_sources(self):
        self.assertEqual(lost.gone(night(0), [night(4), night(5), {'personas': [person(1)]}]), [], 'a run before the count existed is no evidence')
        self.assertEqual(lost.gone(night(0), [night(4), night(5), night(0)]), [], 'one of the 3 already at 0: not "gone now"')

    def test_eures_counts_only_where_the_row_read_it_and_a_status_is_never_zero(self):
        self.assertEqual(lost.totals(night(1, eures_right=3, eures='off')), {'employer_sites': 6, 'eures': None, 'web_search': None}, 'EURES off and a {status} word are None (not measured), never 0')
        self.assertEqual(lost.gone({'personas': [person(n, {'web_search': {'status': 'not measured'}}) for n in range(1, 7)]},
                                   [{'personas': [person(n, {'web_search': {'right': 2}}) for n in range(1, 7)]}] * 3), [], 'not measured now is never gone')
        self.assertEqual(lost.gone(night(1, eures='off'), [night(1, 2), night(1, 2), night(1, 2)]), [], 'EURES off tonight is not EURES lost')


    def test_a_partly_blind_night_is_no_evidence(self):
        self.assertEqual(lost.gone(night(0, count=5), [night(4)] * 3), [], 'fewer than MIN_READ persons carry sources: the missing ones would read as lost')

    def test_a_word_left_out_now_is_gone(self):
        past = {'personas': [person(n, {'linkedin': {'right': 1}, 'job_boards': {'right': 2}}) for n in range(1, 7)]}
        now = {'personas': [person(n, {'job_boards': {'right': 2}}) for n in range(1, 7)]}   # sources_count.py drops linkedin when none was right
        self.assertEqual([c['what'] for c in lost.gone(now, [past] * 3)], ['linkedin'])


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
    def run_check(self, verdict, earlier=(), opened=None, logs=None):
        """A night: the floors-state file compare wrote carries the causes open before (`opened`); returns (code, lost, the open causes floors-save would write)."""
        with tempfile.TemporaryDirectory() as tmp:
            dirs = []
            for i, old in enumerate(earlier):
                Path(tmp, str(i)).mkdir()
                Path(tmp, str(i), 'verdict.json').write_text(json.dumps(old), encoding='utf-8')
                dirs.append(str(Path(tmp, str(i))))
            path, state = Path(tmp, 'verdict.json'), Path(tmp, 'floors-state.json')
            path.write_text(json.dumps(verdict), encoding='utf-8')
            state.write_text(json.dumps({'base': None, 'state': {'version': 1, 'series': {}, **({'lost': {'open': opened}} if opened is not None else {})}}), encoding='utf-8')
            code = lost.check(path, dirs, logs, state, night=True)
            saved = json.loads(state.read_text(encoding='utf-8'))['state']
            self.assertEqual(floors.validate(saved), [], 'floors-save accepts what lost.py wrote')
            return code, json.loads(path.read_text(encoding='utf-8'))['lost'], saved['lost']['open']

    def test_a_lost_source_exits_red_and_a_broken_floor_is_told(self):
        tonight = {**night(0), 'floors': {'red': [{'persona': 4, 'number': 'right', 'floor': 9, 'now': 2}], 'merges': ['Read X (#1)']}}
        code, out, _ = self.run_check(tonight, [night(4)] * 3)
        self.assertEqual(code, lost.RED)
        self.assertEqual({(c['kind'], c['what']) for c in out['tell']}, {('gone', 'employer_sites'), ('floor', 'p4 right')})
        self.assertEqual(out['merges'], ['Read X (#1)'])

    def test_a_floor_is_red_only_on_the_scheduled_night(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, 'verdict.json')
            path.write_text(json.dumps({'floors': {'red': [{'persona': 4, 'number': 'right', 'floor': 9, 'now': 2}]}}), encoding='utf-8')
            with mock.patch.object(floors, 'read_state', return_value=(None, None)):
                code = lost.check(path, [], None, Path(tmp, 'none.json'), night=False)
            told = json.loads(path.read_text(encoding='utf-8'))['lost']['causes']
        self.assertEqual((code, [(c['kind'], c['red']) for c in told]), (0, [('floor', False)]), 'a by-hand run tells it, as floors.py, never reds on it')

    def test_told_once_while_it_lasts_then_back_once(self):
        """sa, 10 Nov 2026: "never the same alert every night"; the night itself stays red while a source is lost."""
        unread_night = {'state': 'red', 'rows': [], 'personas': [person(n, step_yield=read({'employer_sites': 3, 'free_job_apis': 1})) for n in range(1, 7)]}
        first_code, first, opened = self.run_check(unread_night)
        self.assertEqual((first_code, [c['what'] for c in first['tell']], opened), (lost.RED, ['job_boards'], ['unread:job_boards']))
        again_code, again, opened = self.run_check(unread_night, opened=opened)
        self.assertEqual((again_code, again['tell'], again['back']), (lost.RED, [], []), 'still red, nothing told the second night')
        fixed = {**unread_night, 'personas': [person(n, step_yield=read({'employer_sites': 3, 'job_boards': 2, 'free_job_apis': 1})) for n in range(1, 7)]}
        back_code, back, opened = self.run_check(fixed, opened=opened)
        self.assertEqual((back_code, back['tell'], back['back'], opened), (0, [], ['unread:job_boards'], []))
        _, quiet, _ = self.run_check(fixed, opened=opened)
        self.assertEqual((quiet['tell'], quiet['back']), ([], []), 'back is told once, then silence')

    def test_a_run_without_the_nights_state_reads_the_ref_and_never_writes(self):
        """sa, 10 Nov 2026: a by-hand run can neither open nor clear a cause; only floors-save writes the ref."""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, 'verdict.json')
            path.write_text(json.dumps({'personas': [person(n, step_yield=read({'employer_sites': 3, 'free_job_apis': 1})) for n in range(1, 7)]}), encoding='utf-8')
            with mock.patch.object(floors, 'read_state', return_value=('a' * 40, {'version': 1, 'series': {}, 'lost': {'open': ['unread:job_boards']}})), \
                    mock.patch.object(floors, 'save', side_effect=AssertionError('a by-hand run wrote the state')):
                code = lost.check(path, [], None, Path(tmp, 'no-floors-state.json'))
            out = json.loads(path.read_text(encoding='utf-8'))['lost']
            self.assertFalse(Path(tmp, 'no-floors-state.json').exists())
        self.assertEqual((code, out['tell']), (lost.RED, []), 'open on the ref: still red, not told again')

    def test_the_state_takes_only_fixed_cause_keys(self):
        good = {'version': 1, 'series': {}, 'lost': {'open': ['unread:job_boards', 'floor:p4 right', 'not-run:not run']}}
        self.assertEqual(floors.validate(good), [])
        for bad in ({'open': ['<script>']}, {'open': 'unread:job_boards'}, {'open': [], 'extra': 1}, {'open': ['x' * 80]}):
            self.assertEqual(floors.validate({**good, 'lost': bad}), ['lost'], bad)

    def test_time_up_is_said_so_nobody_reads_a_broken_site(self):
        with tempfile.TemporaryDirectory() as logs:
            for n in (1, 2):
                Path(logs, f'search-personas-p{n}', 'draw').mkdir(parents=True)
                for press in (1, 2):   # two presses of one person count once
                    Path(logs, f'search-personas-p{n}', 'draw', f'run-{press}.log').write_text('[114s] ⏱ Time is up (1 min 54 s) for job boards: 6 boards wait for the next search\n', encoding='utf-8')
            verdict = {'personas': [person(n, step_yield=read({'employer_sites': 3, 'free_job_apis': 1})) for n in range(1, 7)]}
            causes = lost.unread(verdict, lost.timeups(logs))
        self.assertEqual(causes[0]['detail'], 'time was up before its turn (2 of 6 persons)')

    def test_a_blind_night_is_told_never_red_and_keeps_what_was_open(self):
        blind = {'state': 'not-run', 'rows': [{'persona': n, 'kind': 'not-run', 'why': 'not run: Codex broker: queue full'} for n in range(1, 19)], 'personas': []}
        code, out, opened = self.run_check(blind, opened=['unread:job_boards'])
        self.assertEqual(code, 0)
        self.assertEqual([(c['kind'], c['red'], len(c['people'])) for c in out['tell']], [('not-run', False, 18)])
        self.assertEqual(out['causes'][0]['detail'], 'Codex broker: queue full')
        self.assertEqual(out['back'], [], 'a blind night saw no source: nothing is back')
        self.assertIn('unread:job_boards', opened, 'the next seeing night does not tell it again')


class Wiring(unittest.TestCase):
    def test_the_night_reds_on_g6_and_only_a_full_main_run_tells_the_owner(self):
        text = (ROOT / '.github/workflows/search-personas.yml').read_text(encoding='utf-8')
        self.assertIn('python3 tools/persona-search/lost.py check result/verdict.json --state result/floors-state.json --logs results ${NIGHT:+--night} "${mains[@]}"', text)
        self.assertIn('test "$LOST" != 1', text)
        tell = text[text.index('- name: Tell the Engineering channel (G6)'):text.index("- name: The table in the run's summary")]
        self.assertIn("inputs.scheduled", tell, 'only the night, which alone moves the open causes, tells')
        self.assertIn("github.ref == 'refs/heads/main'", tell)
        self.assertIn('continue-on-error: true', tell)
        self.assertIn('node search-alert.mjs', tell)
        self.assertLess(text.index('- name: A source lost (G6)'), text.index("path: result/floors-state.json, retention-days: 7"), 'the open causes are in the state before floors-save gets it')


if __name__ == '__main__':
    unittest.main()
