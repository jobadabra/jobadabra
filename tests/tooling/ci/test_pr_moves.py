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

    def test_the_search_words_producers_need_a_moves_line(self):
        """Why (13 Nov 2026, owner via sa: "let's close these gaps"): the strategy draft, the place reader, the board ideas and the search settings decide what a first
        search asks; #2977 and #3857 changed it unmeasured. A scoring helper (src/ai/locations.py feeds score.py) still needs none."""
        for path in ('desktop/lib/strategy.js', 'desktop/lib/strategy-draft-handlers.js', 'src/places.py', 'src/fragment_words.py', 'src/ai/board_ideas.py',
                     'src/notion/search_settings.py'):
            self.assertIn(path, check.moves_gap('## x', [path]) or '', path)
        self.assertIsNone(check.moves_gap('## x', ['src/ai/locations.py', 'desktop/lib/strategy-edit.mjs.bak']))

    def test_a_profile_and_a_not_yet_measured_difference_pass(self):
        """The pair's own lines (tools/persona-search/pair.py table): a profile id, and a person whose usual difference has fewer than 5 night levels."""
        for line in ('Moves: b02 right jobs 3 → 5 (1 run a side, same minute, usual difference not measured yet)',
                     'Moves: p3 right jobs 1 → 1 (1 run a side, same minute, usual difference 1)',
                     'Moves: p1 right jobs 0 → 9 (2 runs a side, same minute, usual difference not measured yet)'):
            self.assertIsNone(check.moves_gap('## x\n' + line + '\n', ['src/sources/feeds.py']), line)
        for line in ('Moves: b2 right jobs 3 → 5 (1 run a side, same minute, usual difference 2)', 'Moves: B02 right jobs 3 → 5 (1 run a side, same minute, usual difference 2)',
                     'Moves: b02 right jobs 3 → 5 (1 run a side, same minute, usual difference unknown)'):
            self.assertIsNotNone(check.moves_gap('## x\n' + line, ['src/sources/feeds.py']), line)

    def test_a_pending_number_holds_the_pr_as_a_dont_merge_draft(self):
        """Why (13 Nov 2026, owner via sa: "anything not a draft is safe to merge"): a ready PR whose number is still pending could be merged before its pair ended."""
        body = '## x\nMoves: p1 right jobs 0 → pending (1 run a side, same minute, usual difference 2)\n'
        self.assertIsNone(check.moves_gap(body, ['src/sources/feeds.py']))   # the line itself is complete
        self.assertIsNone(check.pending_gap(body, '[rs] DONT MERGE Read boards', 'true'))
        for title, draft in (('[rs] Read boards', 'true'), ('[rs] DONT MERGE Read boards', 'false'), ('[rs] Read boards', 'false')):
            self.assertIn('DONT MERGE', check.pending_gap(body, title, draft) or '', (title, draft))
        self.assertIsNone(check.pending_gap(body, '[rs] Read boards', None))   # a local run (no PR_DRAFT): ship sets the hold itself
        self.assertIsNone(check.pending_gap(body.replace('pending', '4'), '[rs] Read boards', 'false'))
        self.assertIsNone(check.pending_gap(body, '', 'true'))   # a bot's PR: the gate passes no title, the draft holds it
        self.assertIsNotNone(check.pending_gap(body, '', 'false'))
        for done in ('Moves: nothing (the run → pending later)\n', 'Moves: p1 right jobs 0 → 4 (1 run a side, same minute, usual difference 2; next → pending)\n'):
            self.assertIsNone(check.pending_gap('## x\n' + done, '[rs] Read boards', 'false'), done)   # a word in the note is not the number

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
