"""Guard: safety — the verdict job holds `checks: write`; without these tests a row could land on a commit that is not a PR's current open head (a replaced push, a closed PR, a fork's commit),
or a row write could fail the required status. Also: a by-hand run (the PR's e2e) gets its row and the summary table lists what the verdict counted (owner, 14 Nov 2026, #4177)."""
import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('pr_verdict_rows', ROOT / 'tools' / 'pr_verdict_rows.py')
rows = importlib.util.module_from_spec(spec); spec.loader.exec_module(rows)
NOW = datetime(2026, 11, 14, 13, 0, tzinfo=timezone.utc)
SERVER, REPO = 'https://github.com', 'o/r'


def run(id, title='E2E for PR · jobs · topic', status='completed', conclusion='success', event='workflow_dispatch', at='2026-11-14T12:50:00Z', end='2026-11-14T12:57:00Z'):
    return {'databaseId': id, 'workflowName': 'E2E', 'displayTitle': title, 'status': status, 'conclusion': conclusion if status == 'completed' else '', 'event': event, 'createdAt': at, 'updatedAt': end}


class Gh:
    def __init__(self, listed=(), open_rows=()):
        self.listed, self.open_rows, self.calls = list(listed), list(open_rows), []

    def __call__(self, *args, **kw):
        self.calls.append(args)
        if '--paginate' in args:   # the head's open display rows, one json object per line
            return '\n'.join(json.dumps(r) for r in self.open_rows)
        return json.dumps(self.listed) if '--jq' in args else ''


class OneRowPerByHandRun(unittest.TestCase):
    def test_only_by_hand_runs_get_a_row_and_each_row_opens_its_run(self):
        got = rows.rows([run(5), run(6, 'CI · Pull request', event='pull_request')], 'success', REPO, SERVER, NOW)
        self.assertEqual([(r['name'], r['url'], r['status'], r['conclusion']) for r in got], [('run · E2E for PR · jobs · topic', 'https://github.com/o/r/actions/runs/5', 'completed', 'success')])

    def test_the_summary_opens_with_a_link_to_the_run_because_github_ignores_details_url_for_this_app(self):
        """Read back on 14 Nov 2026 (sa, #4187's pair row): a check run created with GITHUB_TOKEN keeps its own page as Details whatever details_url says; the summary is the link."""
        row = rows.rows([run(5)], 'success', REPO, SERVER, NOW)[0]
        self.assertTrue(row['summary'].splitlines()[0].startswith('[run · E2E for PR') and row['summary'].splitlines()[0].count('https://github.com/o/r/actions/runs/5') == 1, row['summary'])

    def test_the_row_follows_the_run_running_green_red(self):
        states = [rows.rows([run(5, status=s, conclusion=c)], 'pending', REPO, SERVER, NOW)[0] for s, c in (('queued', ''), ('in_progress', ''), ('completed', 'failure'))]
        self.assertEqual([(r['status'], r['conclusion']) for r in states], [('queued', None), ('in_progress', None), ('completed', 'failure')])

    def test_a_red_run_the_verdict_reads_as_grey_shows_neutral_so_the_list_never_contradicts_the_status(self):
        red = run(5, conclusion='failure')
        self.assertEqual(rows.rows([red], 'success', REPO, SERVER, NOW)[0]['conclusion'], 'neutral')
        self.assertEqual(rows.rows([red], 'failure', REPO, SERVER, NOW)[0]['conclusion'], 'failure')

    def test_the_summary_table_lists_every_counted_run_with_a_link(self):
        text = rows.table([run(5), run(6, 'CI · Pull request', event='pull_request')], 'success', REPO, SERVER, NOW)
        self.assertIn('(https://github.com/o/r/actions/runs/5)', text)
        self.assertIn('(https://github.com/o/r/actions/runs/6)', text)
        self.assertIn('7.0 min', text)


class NeverOnACommitThatIsNotTheCurrentOpenHead(unittest.TestCase):
    def test_only_an_open_same_repository_pr_whose_head_is_this_commit_qualifies(self):
        open_pr = {'state': 'open', 'merged_at': None, 'head_sha': 'abc', 'cross_repo': False}
        self.assertTrue(rows.current_open_head([open_pr], 'abc'))
        for name, pulls in (('a newer push replaced it', [dict(open_pr, head_sha='def')]), ('closed', [dict(open_pr, state='closed')]), ('merged', [dict(open_pr, merged_at='x')]),
                            ('a fork PR', [dict(open_pr, cross_repo=True)]), ('no PR (a dispatched run\'s branch)', [])):
            self.assertFalse(rows.current_open_head(pulls, 'abc'), name)

    def test_publish_writes_no_row_for_a_replaced_head(self):
        gh = Gh()
        done = rows.publish(REPO, 'abc', [{'state': 'open', 'merged_at': None, 'head_sha': 'def'}], [run(5)], 'success', gh, SERVER, NOW)
        self.assertEqual((done, gh.calls), ([], []))

    def test_a_write_that_fails_never_raises_into_the_verdict(self):
        def refuse(*args, **kw):
            raise OSError('HTTP 403')
        done = rows.publish(REPO, 'abc', [{'state': 'open', 'merged_at': None, 'head_sha': 'abc'}], [run(5)], 'success', refuse, SERVER, NOW)
        self.assertEqual(done, [])


class StaysWithinTheTokensCalls(unittest.TestCase):
    PULLS = [{'state': 'open', 'merged_at': None, 'head_sha': 'abc'}]

    def test_a_new_row_is_one_list_and_one_create_then_an_unchanged_row_costs_the_list_only(self):
        gh = Gh()
        rows.publish(REPO, 'abc', self.PULLS, [run(5)], 'success', gh, SERVER, NOW)
        self.assertEqual([c[1] for c in gh.calls], ['repos/o/r/commits/abc/check-runs?per_page=100&check_name=run%20%C2%B7%20E2E%20for%20PR%20%C2%B7%20jobs%20%C2%B7%20topic', 'repos/o/r/check-runs', '--paginate'])   # list by name, create, then the paged list that closes a superseded row (only because the row is new)
        want = rows.rows([run(5)], 'success', REPO, SERVER, NOW)[0]
        again = Gh([{'id': 9, 'external_id': want['external_id'], 'status': want['status'], 'conclusion': want['conclusion'], 'title': want['title']}])
        rows.publish(REPO, 'abc', self.PULLS, [run(5)], 'success', again, SERVER, NOW)
        self.assertEqual(len(again.calls), 1)

    def test_a_changed_row_is_updated_in_place_not_added_again(self):
        old = {'id': 9, 'external_id': 'pr-verdict-row:5', 'status': 'in_progress', 'conclusion': None, 'title': 'running 7.0 min'}
        gh = Gh([old])
        rows.publish(REPO, 'abc', self.PULLS, [run(5)], 'success', gh, SERVER, NOW)
        self.assertEqual(gh.calls[1][:3], ('api', '-X', 'PATCH'))
        self.assertEqual(gh.calls[1][3], 'repos/o/r/check-runs/9')

    def test_a_run_replaced_by_a_newer_one_of_the_same_title_has_its_open_row_closed_as_superseded(self):   # Gitar on #4194
        gh = Gh(open_rows=[{'id': 11, 'external_id': 'pr-verdict-row:4'}, {'id': 12, 'external_id': 'pr-verdict-row:5'}])
        rows.publish(REPO, 'abc', self.PULLS, [run(5)], 'pending', gh, SERVER, NOW)   # run 5 is the counted one; run 4's row (id 11) is open and no longer wanted
        patched = [c for c in gh.calls if c[:3] == ('api', '-X', 'PATCH')]
        self.assertEqual([c[3] for c in patched], ['repos/o/r/check-runs/11'])
        self.assertIn('conclusion=neutral', patched[0])

    def test_no_list_by_prefix_when_no_row_is_new(self):   # the extra paged list only runs when a new row could have superseded one
        want = rows.rows([run(5)], 'success', REPO, SERVER, NOW)[0]
        gh = Gh([{'id': 9, 'external_id': want['external_id'], 'status': want['status'], 'conclusion': want['conclusion'], 'title': want['title']}])
        rows.publish(REPO, 'abc', self.PULLS, [run(5)], 'success', gh, SERVER, NOW)
        self.assertFalse([c for c in gh.calls if '--paginate' in c])

    def test_a_head_with_many_check_runs_cannot_hide_the_row_the_list_asks_for_it_by_name(self):
        gh = Gh()
        rows.publish(REPO, 'abc', self.PULLS, [run(5)], 'success', gh, SERVER, NOW)
        self.assertIn('check_name=', gh.calls[0][1], 'a page of 100 check runs without the name filter would hide the row and add a copy on every write')

    def test_a_summary_path_that_cannot_be_written_does_not_hide_the_rows(self):   # Gitar on #4188
        gh = Gh()
        done = rows.publish(REPO, 'abc', self.PULLS, [run(5)], 'success', gh, SERVER, NOW, summary_path='/nonexistent-folder/summary.md')
        self.assertEqual(len(done), 1)

    def test_the_summary_is_appended_for_any_head_even_without_a_row(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder, 'summary.md')
            rows.publish(REPO, 'abc', [], [run(5)], 'pending', Gh(), SERVER, NOW, summary_path=str(path))
            self.assertIn('Checks counted for this commit: pending', path.read_text())


if __name__ == '__main__':
    unittest.main()
