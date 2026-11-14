"""Guard: release — the before/after pair judges each job ONCE for both sides, so a job shown on both sides has one verdict (sa for the owner, 14 Nov 2026, asked via AskUserQuestion: "Should the pair judge each job once
and use that verdict on both sides?" "Yes, judge each job once (Recommended)"). Without it a judge whose verdict follows its batch turned a real +2 into +6 (pair 43604153744, #4199: 4 jobs of b08 on both sides read "no" 3 of 3
on main and "yes" 3 of 3 on the PR). Fake judge only: no relay, no AI call."""
import io
import json
import re
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import gate_judge  # noqa: E402
import pair  # noqa: E402
import profiles  # noqa: E402


def job(title):
    return {'title': title, 'company': 'Acme', 'location': 'Nürnberg, Germany'}


SHARED = [job('Business Analyst'), job('Statistician')]
MAIN = SHARED + [job('Sales Analyst')]                      # 3 distinct jobs on main
PR = SHARED + [job('Risk Analyst'), job('Data Analyst')]    # 4 distinct jobs on the PR: 2 of them shown on both sides


def batchy(calls=None):
    """A judge whose verdict follows its BATCH, as the real one did: it says "yes" to a role only when the batch it sees has an even number of jobs."""
    lock = threading.Lock()

    def asker(profile, jobs):
        with lock:
            if calls is not None:
                calls.append(len(jobs))
        answer = 'yes' if len(jobs) % 2 == 0 else 'no'
        return {j['n']: {'role': answer, 'place': 'yes', 'ai': 'gpt-6-luna'} for j in jobs}
    return asker


def verdict_of(rows, title):
    return next(r['role'] for r in rows if r['title'] == title)


class OneVerdictPerJob(unittest.TestCase):
    def rows(self):
        return [dict(r) for r in MAIN], [dict(r) for r in PR]

    def test_positive_control_judged_side_by_side_the_same_job_flips(self):
        """The old way (one judge() per side): the shared jobs sit in a batch of 3 on main and of 4 on the PR, and read no / yes. This is what the control must show, or the fix below proves nothing."""
        main, pr = self.rows()
        gate_judge.judge(1, main, batchy())
        gate_judge.judge(1, pr, batchy())
        self.assertEqual((verdict_of(main, 'Business Analyst'), verdict_of(pr, 'Business Analyst')), ('no', 'yes'))

    def test_pooled_a_job_on_both_sides_has_one_verdict_and_every_shared_job_matches(self):
        main, pr = self.rows()
        calls = []
        out = gate_judge.judge_pooled(1, [('main', main), ('pr', pr)], batchy(calls))
        for title in ('Business Analyst', 'Statistician'):
            self.assertEqual(verdict_of(out[0]['rows'], title), verdict_of(out[1]['rows'], title), title)
        self.assertEqual(len(set(calls)), 1, 'one set of batches over the union, never one per side')
        self.assertEqual(calls, [5, 5, 5], '5 distinct jobs (7 rows, 2 on both sides), asked 3 times at once')

    def test_each_side_keeps_only_its_own_rows_and_says_what_was_pooled(self):
        main, pr = self.rows()
        out = gate_judge.judge_pooled(1, [('main', main), ('pr', pr)], batchy())
        self.assertEqual([len(v['rows']) for v in out], [3, 4])
        self.assertEqual([v['judged_jobs'] for v in out], [3, 4])
        self.assertEqual(out[0]['pooled'], {'distinct': 5, 'shown_on_both': 2})
        self.assertEqual(out[1]['pooled'], out[0]['pooled'])
        self.assertEqual(out[0]['agreement']['jobs'], 3, "a side's agreement counts the side's own jobs")

    def test_a_side_with_several_runs_counts_a_job_shown_on_both_once(self):
        main1, main2, pr1 = [dict(r) for r in MAIN], [dict(r) for r in MAIN], [dict(r) for r in PR]
        out = gate_judge.judge_pooled(1, [('main', main1), ('main', main2), ('pr', pr1)], batchy())
        self.assertEqual(out[0]['pooled']['shown_on_both'], 2)
        self.assertEqual(out[0]['pooled']['distinct'], 5, 'two runs of one side list the same jobs: judged once')

    def test_the_command_writes_each_sides_judged_json_from_its_folder_name(self):
        with tempfile.TemporaryDirectory() as folder:
            paths = []
            for name, rows in (('b08--main-1', MAIN), ('b08--pr-1', PR)):
                Path(folder, name).mkdir()
                Path(folder, name, 'jobs.json').write_text(json.dumps(rows))
                paths += [str(Path(folder, name, 'jobs.json')), str(Path(folder, name, 'judged.json'))]
            real = gate_judge.judge_pooled
            with mock.patch.object(gate_judge, 'judge_pooled', lambda n, runs: real(n, runs, batchy())), redirect_stdout(io.StringIO()) as said:
                gate_judge.main(['--pooled', '1', *paths])
            main = json.loads(Path(folder, 'b08--main-1', 'judged.json').read_text())
            pr = json.loads(Path(folder, 'b08--pr-1', 'judged.json').read_text())
        self.assertEqual((len(main['rows']), len(pr['rows'])), (3, 4))
        self.assertEqual(verdict_of(main['rows'], 'Statistician'), verdict_of(pr['rows'], 'Statistician'))
        self.assertIn('2 shown on both', said.getvalue())

    def test_the_commands_prompt_ai_and_answers_are_the_ones_the_night_uses(self):
        """Nothing of the locked measure changes: the pooled call is gate_judge.judge() itself (its prompt, 3 answers, the majority), not a second judge."""
        source = (ROOT / 'tools' / 'persona-search' / 'gate_judge.py').read_text()
        body = source.split('def judge_pooled', 1)[1].split('def main', 1)[0]
        self.assertIn('judge(n, pool, asker)', body)
        self.assertNotIn('SYSTEM', body)

    def test_a_profile_is_judged_as_itself_through_the_same_path(self):
        seen = {}
        with mock.patch.object(gate_judge, 'main', lambda argv: seen.update(argv=argv, personas=len(gate_judge.PERSONAS))):
            profiles.judge_pooled(profiles.IDS[1], ['a/jobs.json', 'a/judged.json'])
        self.assertEqual(seen['argv'][:2], ['--pooled', '2'])
        self.assertEqual(seen['personas'], len(profiles.PROFILES), 'the judge reads the profiles list, not the night people')


class TheTableAndTheWorkflow(unittest.TestCase):
    def results(self, shown):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        for name, side in (('b08--main-1', 'main'), ('b08--pr-1', 'pr')):
            Path(folder.name, name).mkdir()
            Path(folder.name, name, 'side.json').write_text(json.dumps({'side': side, 'right': 3, 'found': 9, 'first_s': '4', 'words': [], 'calls': 4, 'failed': 0, 'valid': True, 'shown_on_both': shown}))
        return folder.name

    def test_the_comment_says_the_judge_ran_once_and_for_how_many_jobs(self):
        text = pair.table(self.results(4), '7', 'b' * 40, 'a' * 40, spread=lambda person: 2)
        self.assertIn('Judged once for both sides: 4 jobs shown on both (b08: 4)', text)
        self.assertNotIn('Judged once', pair.table(self.results(None), '7', 'b' * 40, 'a' * 40, spread=lambda person: 2), 'a pair judged the old way does not claim it')

    def test_side_json_carries_the_count_from_the_judged_file(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, 'judged.json').write_text(json.dumps({'rows': [], 'pooled': {'distinct': 5, 'shown_on_both': 2}}))
            with redirect_stdout(io.StringIO()):
                pair.side(folder, 'pr')
            self.assertEqual(json.loads(Path(folder, 'side.json').read_text())['shown_on_both'], 2)

    def test_the_workflow_judges_once_for_all_sides_and_never_per_side_folder(self):
        text = (ROOT / '.github' / 'workflows' / 'search-pair.yml').read_text()
        step = text.split('The blind judge, once for both sides', 1)[1].split('upload-artifact', 1)[0]
        self.assertIn('gate_judge.py --pooled "$N" "${files[@]}"', step)
        self.assertIn('profiles.py judge-pooled "$ID" "${files[@]}"', step)
        self.assertIsNone(re.search(r'gate_judge\.py "\$N" "\$out/jobs\.json"', step), 'a per-side judge call is the flip this guard exists for')
        self.assertIsNone(re.search(r'profiles\.py judge "\$ID"', step))


if __name__ == '__main__':
    unittest.main()
