"""Guard: money — a pair that is not replaced by the next push keeps its broker claims (2 searches per person) for code that no longer exists, and a comment that is lost to a moved head
hides the numbers the owner asked to see (14 Nov 2026, #4175; owner: "see the outcome results as a PR comment")."""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import pair  # noqa: E402

WORKFLOW = (ROOT / '.github' / 'workflows' / 'search-pair.yml').read_text(encoding='utf-8')
MEASURED, NOW = 'a' * 40, 'b' * 40


def cancels(attempt):
    """Evaluate the workflow's own cancel-in-progress expression for a run of this attempt (the only expression shape it uses)."""
    expr = re.search(r'(?m)^  cancel-in-progress: (.+)$', WORKFLOW).group(1)
    hit = re.fullmatch(r"\$\{\{ inputs\.attempt == '(\d)' \}\}", expr)
    return hit is not None and hit.group(1) == attempt


class OnePairPerPrAtATime(unittest.TestCase):
    def test_a_first_run_replaces_what_runs_for_the_pr_and_the_second_run_never_cancels_its_dispatcher(self):
        group = re.search(r'(?m)^concurrency:\n  group: (.+)$', WORKFLOW).group(1)
        self.assertEqual(group, 'search-pair-${{ inputs.pr }}', 'one group per PR for every attempt and every set of people: an older attempt 2 is replaced too (Gitar on #4191)')
        self.assertTrue(cancels('1'))
        self.assertFalse(cancels('2'), 'attempt 2 is dispatched by the first run\'s comment job; cancelling would kill the dispatcher mid-comment')

    def test_a_cancelled_run_still_runs_the_jobs_that_give_the_claims_back_and_write_the_row(self):   # wiring only: the row's transition is played in test_pair_row (died + newer -> superseded)
        self.assertRegex(WORKFLOW, r"(?m)^  release:\n(?:.*\n)*?    if: \$\{\{ always\(\) && needs\.setup\.outputs\.go == '1' \}\}")
        self.assertRegex(WORKFLOW, r"(?m)^  status:\n(?:.*\n)*?    if: \$\{\{ always\(\) && needs\.setup\.result == 'success'")

    def test_the_dispatch_input_says_to_name_all_the_people_at_once(self):
        self.assertIn('Name ALL of them in one dispatch', WORKFLOW)


class AMovedHeadKeepsTheNumbersOnlyWhenTheSearchFilesDidNotChange(unittest.TestCase):
    def verdict(self, files, status='ahead', state='OPEN', now=NOW):
        return pair.head_verdict(state, MEASURED, now, {'status': status, 'files': files})

    def test_the_head_did_not_move(self):
        self.assertEqual(self.verdict([], now=MEASURED), (False, False))

    def test_a_push_of_docs_and_tests_keeps_the_numbers_and_says_the_head_moved(self):
        self.assertEqual(self.verdict(['docs/x.md', 'tests/unit/sources/test_x.py', '.github/workflows/pr-verdict.yml']), (True, False))

    def test_a_push_that_changes_a_search_file_is_a_newer_head(self):
        self.assertEqual(self.verdict(['docs/x.md', 'src/sources/found_boards.py']), (True, True))
        self.assertEqual(self.verdict(['desktop/lib/strategy-draft.js']), (True, True))

    def test_every_doubt_counts_as_newer_never_as_unchanged(self):   # Gitar on #4191: an empty list, a rebase, a force push, an unreadable compare, a cut list
        self.assertEqual(self.verdict([]), (True, True), 'nothing proves the head is the measured code')
        self.assertEqual(self.verdict(['docs/x.md'], status='diverged'), (True, True), 'a rebase: the file list is the merge-base side')
        self.assertEqual(pair.head_verdict('OPEN', MEASURED, NOW, {}), (True, True), 'the compare could not be read')
        self.assertEqual(self.verdict([f'docs/{n}.md' for n in range(300)]), (True, True), 'a list cut at 300 may hide a search file')

    def test_a_search_file_renamed_out_of_a_search_path_counts_by_its_old_name(self):   # Gitar on #4195: compare gives the new name in filename, the old one in previous_filename
        self.assertEqual(pair.head_verdict('OPEN', MEASURED, NOW, {'status': 'ahead', 'count': 1, 'files': ['docs/found_boards.py', 'src/sources/found_boards.py']}), (True, True))
        self.assertIn('previous_filename', WORKFLOW, 'the workflow lists the old names')

    def test_an_unreadable_current_head_is_a_doubt_not_unchanged(self):
        self.assertEqual(pair.head_verdict('OPEN', MEASURED, '', {}), (True, True))
        self.assertEqual(pair.head_verdict('MERGED', MEASURED, '', {}), (False, False))

    def test_the_cut_counts_the_compares_files_not_the_longer_list_with_old_names(self):
        self.assertEqual(pair.head_verdict('OPEN', MEASURED, NOW, {'status': 'ahead', 'count': 150, 'files': [f'docs/{n}.md' for n in range(300)]}), (True, False))
        self.assertEqual(pair.head_verdict('OPEN', MEASURED, NOW, {'status': 'ahead', 'count': 300, 'files': ['docs/a.md']}), (True, True))

    def test_a_merged_pr_has_no_head_to_follow(self):
        self.assertEqual(self.verdict(['src/sources/x.py'], state='MERGED'), (False, False))

    def test_the_comment_job_reads_the_decision_from_that_function(self):   # wiring: the shell holds no decision of its own
        self.assertIn('pair.py head "$STATE" "$HEAD" "$now" compare.json', WORKFLOW)
        self.assertIn('elif [ "$newer" = 1 ]; then', WORKFLOW)

    def test_the_comment_names_the_commit_it_measured_in_its_first_heading(self):
        self.assertRegex(pair.table(str(ROOT / 'tests'), '9', 'a' * 40, 'b' * 40).splitlines()[1], r'#9 `bbbbbbbb`')


if __name__ == '__main__':
    unittest.main()
