# Guard: release — a Find jobs PR graded by its author on one run (4 claims withdrawn on 10 Nov 2026) reaches main; tools/pr-body-check.py must refuse a search-file PR without a "Moves:" line.
import importlib.util
import os
import pathlib
import subprocess
import tempfile
import unittest

TOOL = pathlib.Path(__file__).resolve().parents[3] / 'tools' / 'pr-body-check.py'
SPEC = importlib.util.spec_from_file_location('pr_body_check', TOOL)
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)

GOOD = 'Moves: p5 in = out EURES 14/24 → 22/24 (1 run a side, same minute, usual difference 3)'


class MovesLine(unittest.TestCase):
    def test_search_file_without_a_moves_line_is_refused(self):
        for path in ('src/sources/eures.py', 'src/press/stages.py', 'src/first_jobs.py', 'src/daily_search_scoring.py', 'src/ai/place_triage.py',
                     'src/ai/title_triage.py', 'src/ai/slots.py', 'src/time_budget.py', 'src/job_rank.py'):
            gap = check.moves_gap('## fixed\n\nWhy: it was slow', [path, 'docs/x.md'])
            self.assertIn(path, gap or '', path)
            self.assertIn('Moves:', gap)

    def test_other_files_need_no_moves_line(self):
        self.assertIsNone(check.moves_gap('## docs', ['docs/map/search.md', 'tests/unit/press/test_x.py', 'src/ai/score.py', 'src/daily.py', 'desktop/main.js']))

    def test_a_person_a_number_and_one_search_a_side_pass(self):
        """Why (12 Nov 2026, owner, quoted by coordinator sa: "Let's do only 1 live search before and after. not 3 (which are 6)"): one search a side with the
        person's usual difference is the line; 3 a side with their spread still passes."""
        for line in (GOOD, '- Moves: p10 right jobs 130 -> 152 (1 run a side, same minute, usual difference 15)',
                     '- Moves: p13 coverage 40% -> 61% (3 runs a side, spread 4%)', '**Moves:** nothing (a comment fix, no behaviour)'):
            self.assertIsNone(check.moves_gap('## x\n' + line + '\n', ['src/press/run.py']), line)

    def test_saved_runs_before_and_the_owners_after_run_pass_with_a_number_or_pending(self):
        """Why (lanes 4a, owner, 11 Nov 2026: "Accept your measure (Recommended)"): 49 saved runs before, one run after; pending while it runs."""
        for line in ('Moves: p2 p3 p6 p9 p10 p11 p13 board jobs on a first run 1/49 → pending (49 saved runs before, 1 run after)',
                     'Moves: p2 board jobs on a first run 1/49 → 5/7 (49 saved runs before, 1 run after, run 42999)'):
            self.assertIsNone(check.moves_gap('## x\n' + line + '\n', ['src/sources/boards_first.py']), line)
        for line in ('Moves: p2 board jobs 1/49 → soon (49 saved runs before, 1 run after)', 'Moves: p2 board jobs 1/49 → pending (0 saved runs before, 1 run after)',
                     'Moves: p2 board jobs 1/49 → pending (49 saved runs before)', 'Moves: p2 board jobs → pending (49 saved runs before, 1 run after)'):
            self.assertIsNotNone(check.moves_gap('## x\n' + line, ['src/sources/boards_first.py']), line)

    def test_a_half_filled_line_is_refused(self):
        for line in ('Moves: p5 EURES (3 runs a side, spread 3)', 'Moves: p5 x 1 → 2 (1 run, spread 3)', 'Moves: nothing ()', 'Moves: nothing (<why>)',
                     'Moves: p<n> <number> <before> → <after> (3 runs a side, spread <s>)', 'Moves: p<n> <number> <before> → <after> (1 run a side, same minute, usual difference <d>)',
                     'Moves: p10 right jobs 130 → 152 (1 run a side, same minute)', 'Moves: <a PR that changes a search file ...>'):
            self.assertIsNotNone(check.moves_gap('## x\n' + line, ['src/sources/feeds.py']), line)

    def test_the_command_line_reads_the_diff_against_base(self):
        """--base wires the check to git: a branch that edits src/press/run.py exits 1 without the line and 0 with it; no --base (the other repos' calls) never asks."""
        body = '## ok\n\n---\n\n### Impact\n\n| What changed | Before | After |\n|---|---|---|\n| x | y | z |\n'
        with tempfile.TemporaryDirectory() as tmp:
            def git(*args):
                subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@example.test', *args], cwd=tmp, check=True, capture_output=True)
            git('init', '-q', '-b', 'main')
            pathlib.Path(tmp, 'README.md').write_text('x')
            git('add', '.')
            git('commit', '-q', '-m', 'base')
            git('checkout', '-q', '-b', 'pr')
            os.makedirs(os.path.join(tmp, 'src', 'press'))
            pathlib.Path(tmp, 'src', 'press', 'run.py').write_text('x = 1')
            git('add', '.')
            git('commit', '-q', '-m', 'change the press')

            def run(text, *args):
                return subprocess.run(['python3', '-I', str(TOOL), *args], input=text, cwd=tmp, capture_output=True, text=True)
            refused = run(body, '--base', 'main')
            self.assertEqual(refused.returncode, 1, refused.stderr)
            self.assertIn('Moves:', refused.stderr)
            self.assertEqual(run(body + GOOD + '\n', '--base', 'main').returncode, 0)
            self.assertEqual(run(body).returncode, 0)
            for args in (('--base', 'no-such-base'), ('--base',)):   # Gitar on #3704: git cannot say, or no base given: refused, never a silent pass
                unread = run(body + GOOD + '\n', *args)
                self.assertEqual(unread.returncode, 1, args)
                self.assertIn('could not read the changed files', unread.stderr)


if __name__ == '__main__':
    unittest.main()
