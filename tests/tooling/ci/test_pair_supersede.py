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


class OnePairPerPrAtATime(unittest.TestCase):
    def test_a_newer_dispatch_for_the_pr_replaces_the_older_run_by_the_workflows_own_group(self):
        group = re.search(r'(?m)^concurrency:\n  group: (.+)\n  cancel-in-progress: (.+)$', WORKFLOW)
        self.assertTrue(group, 'the workflow has one concurrency block')
        self.assertIn('inputs.pr', group.group(1))
        self.assertNotIn('inputs.people', group.group(1), 'other people of the same PR replace the pair too: one pair per PR (a by-hand pair names all its people)')
        self.assertEqual(group.group(2), 'true')

    def test_the_pairs_own_second_run_is_in_another_group_than_the_run_that_dispatches_it(self):
        self.assertIn('inputs.attempt', re.search(r'(?m)^  group: (.+)$', WORKFLOW).group(1), 'the first run dispatches attempt 2 from its comment job: one shared cancelling group would cancel it')

    def test_a_cancelled_run_gives_its_claims_back_and_its_row_reads_superseded(self):
        self.assertRegex(WORKFLOW, r"(?m)^  release:\n(?:.*\n)*?    if: \$\{\{ always\(\) && needs\.setup\.outputs\.go == '1' \}\}")
        self.assertRegex(WORKFLOW, r"(?m)^  status:\n(?:.*\n)*?    if: \$\{\{ always\(\) && needs\.setup\.result == 'success'")

    def test_the_dispatch_input_says_to_name_all_the_people_at_once(self):
        self.assertIn('Name ALL of them in one dispatch', WORKFLOW)


class AMovedHeadKeepsTheNumbersOnlyWhenTheSearchFilesDidNotChange(unittest.TestCase):
    def test_search_files_count_as_changed_and_the_rest_does_not(self):
        self.assertTrue(pair.search_changed(['docs/x.md', 'src/sources/found_boards.py']))
        self.assertTrue(pair.search_changed(['desktop/lib/strategy-draft.js']))
        self.assertFalse(pair.search_changed(['docs/x.md', 'tests/unit/sources/test_x.py', 'tools/ship.sh', '.github/workflows/pr-verdict.yml']))
        self.assertFalse(pair.search_changed([]))

    def test_a_compare_cut_at_300_files_counts_as_changed_never_as_unchanged(self):
        self.assertTrue(pair.search_changed(['TRUNCATED']))

    def test_the_comment_job_writes_the_numbers_for_an_unchanged_head_and_says_which_commit_was_measured(self):
        self.assertIn('pair.py reach delta.txt', WORKFLOW)
        self.assertIn('elif [ "$newer" = 1 ]; then', WORKFLOW)
        self.assertIn('no file the search reads changed since, so these numbers stand for it', WORKFLOW)
        self.assertRegex(pair.table(str(ROOT / 'tests'), '9', 'a' * 40, 'b' * 40).splitlines()[1], r'#9 `bbbbbbbb`', 'the comment names the commit it measured in its first heading')


if __name__ == '__main__':
    unittest.main()
