"""A red main suite gets an owner (tools/e2e_bisect.py, gate G2b, 26 Oct 2026): bisect to the first red commit, one entry per suite in the red-main list (the Red main tab), dropped when green again."""
import json
import tempfile
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from tools import main_e2e_state as m
from tools import e2e_bisect as b  # noqa: E402

CREDIT = '✗ the interactions suite stopped: E2E_ANTHROPIC_KEY: the API refused model claude-haiku-5-5 (400): "Your credit balance is too low"'
COMMITS = [f'{i:02x}'.ljust(40, '0') for i in range(12)]   # [0] green, [11] red


class Bisect(unittest.TestCase):
    def test_finds_the_first_red_commit_in_log2_steps(self):
        for first_red in range(1, 12):
            calls = []

            def test(sha, first_red=first_red, calls=calls):
                calls.append(sha)
                return 'failure' if COMMITS.index(sha) >= first_red else 'success'
            found, _, tested = b.bisect(COMMITS, test)
            self.assertEqual(found, COMMITS[first_red])
            self.assertLessEqual(len(calls), 4, '11 commits: at most ceil(log2 11) = 4 runs')
            self.assertEqual([sha for sha, _ in tested], calls)

    def test_one_commit_in_range_needs_no_run(self):
        found, _, tested = b.bisect(COMMITS[:2], lambda sha: self.fail('no run needed'))
        self.assertEqual((found, tested), (COMMITS[1], []))

    def test_a_step_that_cannot_tell_stops_and_keeps_the_range(self):
        found, (lo, hi), _ = b.bisect(COMMITS, lambda sha: None)
        self.assertIsNone(found)
        self.assertEqual((lo, hi), (0, 11))


class RedRecord(unittest.TestCase):
    def test_the_entry_names_the_pr_and_branch_the_way_the_session_hook_reads_it(self):
        red = b.red_record('cardstates', 'f' * 40, 'https://run', found=COMMITS[5], pr={'number': 1914, 'branch': 'compact-run-banner', 'title': '[5c] Show each run'},
                           good=COMMITS[0], tested=[(COMMITS[5], 'failure'), (COMMITS[2], 'success')], status='found')
        # tools/pr-red-check.sh reads .pr.number and .pr.branch of every entry that has a pr; the Red main tab (jobadabra-web admin/red-main-page.js) the rest.
        self.assertEqual((red['pr']['number'], red['pr']['branch'], red['status']), (1914, 'compact-run-banner', 'found'))
        self.assertIn('.pr.branch', (ROOT / 'tools/pr-red-check.sh').read_text())
        self.assertEqual(red['tested'], [[COMMITS[5], 'failure'], [COMMITS[2], 'success']])
        self.assertEqual(red['good'], COMMITS[0])

    def test_no_pr_found_lists_the_range(self):
        red = b.red_record('settings', 'f' * 40, 'u', candidates=COMMITS[3:5], status='not-found')
        self.assertIsNone(red['pr'])
        self.assertEqual(red['candidates'], COMMITS[3:5])


class AfterRun(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        lanes = Path(tmp.name) / 'lanes.json'
        lanes.write_text(json.dumps({'suites': {suite: {'lane': 'tolerant'} for suite in ('quality', 'qualityai')}}))
        registry = patch.object(m, 'LANES', lanes)
        registry.start()
        self.addCleanup(registry.stop)
        self.calls = []
        self.saved = (b.gh, b.gh_json, b.load, b.save, b.jobs_of)
        b.gh = lambda *args, check=True: self.calls.append(args) or ''
        b.gh_json = lambda *args: {'html_url': 'https://run/9', 'head_sha': 'a' * 40}
        self.stored = [b.red_record('cardstates', 'c' * 40, 'u', status='found'), b.red_record('settings', 's' * 40, 'u', status='found')]
        b.load = lambda: [dict(red) for red in self.stored]
        b.save = lambda reds: setattr(self, 'stored', reds)
        self.saved += (b.log_of,)
        self.logs = {2: '✗ the icon rail: a marker covers the icon', 3: '✗ recorded: the panel says "Filled 3"', 4: '', 5: CREDIT}
        b.log_of = lambda job_id: self.logs.get(job_id, '')
        b.jobs_of = lambda rid: [{'id': 1, 'name': 'cardstates', 'conclusion': 'success'}, {'id': 6, 'name': 'settings', 'conclusion': 'failure'},
                                 {'id': 2, 'name': 'interactions', 'conclusion': 'failure'}, {'id': 3, 'name': 'recorded-2of5', 'conclusion': 'failure'},
                                 {'id': 4, 'name': 'Telegram alert', 'conclusion': 'failure'}, {'id': 7, 'name': 'jobs', 'conclusion': 'skipped'}]

    def tearDown(self):
        b.gh, b.gh_json, b.load, b.save, b.jobs_of, b.log_of = self.saved

    def started(self):
        return [next(a for a in c if a.startswith('suite=')) for c in self.calls if c[:2] == ('workflow', 'run')]

    def suites(self):
        return sorted(red['suite'] for red in self.stored)

    def test_tolerant_red_never_starts_bisect_or_adds_an_entry(self):
        b.jobs_of = lambda rid: [{'name': name, 'conclusion': 'failure'} for name in ('quality-1of2-standin · burn-in 2/5', 'qualityai-standin')]
        b.after_run('9')
        self.assertEqual(self.calls, [], 'tolerant reds never create red-main work')
        self.assertEqual(self.suites(), ['cardstates', 'settings'])

    def test_tolerant_green_drops_its_existing_red_main_entry(self):
        self.stored.append(b.red_record('quality', 'q' * 40, 'u', status='found'))
        b.jobs_of = lambda rid: [{'name': 'quality-1of2-standin · burn-in 2/5', 'conclusion': 'success'}]
        b.after_run('9')
        self.assertEqual(self.suites(), ['cardstates', 'settings'])
        self.assertEqual(self.started(), [])

    def test_explicit_bisect_of_tolerant_suite_adds_no_entry(self):
        with patch.object(b, 'last_green', return_value=None):
            b.run_bisect('quality', 'a' * 40, 'https://run/9')
        self.assertEqual(self.calls, [], 'even an already queued bisect must respect the current lane')

    def test_drops_green_again_and_bisects_one_new_red(self):
        b.after_run('9')
        self.assertEqual(self.suites(), ['interactions', 'settings'], 'cardstates passed: its entry goes; settings stays; the new red is bisecting')
        self.assertEqual({red['suite']: red['status'] for red in self.stored}['interactions'], 'bisecting')
        # 26 Oct 2026: 10 red suites started 10 bisects at once and filled the job queue. One per main check; the next check starts the next.
        self.assertEqual(self.started(), ['suite=interactions'], 'settings already has an entry; the alert job is no suite; one bisect per run')

    def test_an_environment_red_is_never_bisected(self):
        # 26 Oct 2026: the dead Claude key turned every suite red; bisecting it finds no PR and only fills the queue.
        self.logs[2] = CREDIT
        b.after_run('9')
        self.assertEqual(self.started(), ['suite=recorded'], 'interactions is red on the key: skipped, recorded is a product red')
        self.logs[3] = "✗ x: Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"
        self.calls.clear()
        b.after_run('9')
        self.assertEqual(self.started(), [], 'every red is the environment: no bisect')

    def test_a_bisecting_entry_whose_workflow_died_is_started_again_but_a_fresh_one_is_not(self):
        b.jobs_of = lambda rid: [{'id': 6, 'name': 'settings', 'conclusion': 'failure'}]
        self.stored[1].update(status='bisecting', bisectAt=b.now_iso())
        b.after_run('9')
        self.assertEqual(self.started(), [], 'a bisect that began a moment ago is still running')
        self.stored[1]['bisectAt'] = '2026-01-01T00:00:00Z'
        b.after_run('9')
        self.assertEqual(self.started(), ['suite=settings'])

    def test_the_entry_is_written_before_the_bisect_is_dispatched(self):
        def refuse(reds):
            raise OSError('site refused the write')
        b.save = refuse
        with self.assertRaises(OSError):
            b.after_run('9')
        self.assertEqual(self.started(), [], 'a bisect no entry knows about would be started again by the next check')

    def test_a_restarted_bisect_keeps_the_time_the_suite_first_went_red(self):
        b.jobs_of = lambda rid: [{'id': 6, 'name': 'settings', 'conclusion': 'failure'}]
        self.stored[1].update(status='bisecting', bisectAt='2026-01-01T00:00:00Z', sinceAt='2026-01-01T00:00:00Z', since='s' * 40)
        b.after_run('9')
        entry = next(red for red in self.stored if red['suite'] == 'settings')
        self.assertEqual((entry['sinceAt'], entry['since']), ('2026-01-01T00:00:00Z', 's' * 40))
        self.assertGreater(entry['bisectAt'], '2026-01-02')

    def test_a_bisect_that_never_reported_and_is_now_red_on_the_environment_leaves_the_list(self):
        self.logs[6] = CREDIT
        b.jobs_of = lambda rid: [{'id': 6, 'name': 'settings', 'conclusion': 'failure'}]
        self.stored[1].update(status='bisecting', bisectAt='2026-01-01T00:00:00Z')
        b.after_run('9')
        self.assertEqual(self.suites(), ['cardstates'])

    def test_a_site_that_cannot_be_read_stops_the_check_and_writes_nothing(self):
        def down():
            raise OSError('site down')
        b.load = down
        b.save = lambda reds: self.fail('a failed read must never become a write')
        with self.assertRaises(OSError):
            b.after_run('9')


class AfterMerge(AfterRun):
    """Completed after-merge runs go to the revert job; the old alert must never ask for fix-forward."""
    def setUp(self):
        super().setUp()
        self.saved_pr = (b.pr_of, b.report)
        self.reports = []
        b.pr_of = lambda sha: {'number': 2057, 'branch': 'ci-steps', 'title': 'Run only the steps'} if sha == 'a' * 40 else None
        b.report = lambda red: self.reports.append(red)

    def tearDown(self):
        b.pr_of, b.report = self.saved_pr
        super().tearDown()

    def test_after_merge_requests_no_fix_forward_or_bisect_and_closes_nothing(self):
        b.after_merge('9')
        self.assertEqual(self.started(), [], 'no bisect: the merge is the only commit in range')
        self.assertEqual(self.suites(), ['cardstates', 'settings'], 'cardstates green on a few steps: its entry stays')
        self.assertEqual(self.reports, [], 'completed-run revert evidence owns after-merge reds; no fix-forward comment')

    def test_an_environment_red_is_not_filed(self):
        self.logs[2] = CREDIT
        b.after_merge('9')
        self.assertEqual(self.reports, [], 'health never asks for a fix PR')

    def test_its_green_is_never_the_bisect_s_last_green(self):
        runs = [{'id': 5, 'head_sha': '5' * 40, 'head_branch': 'main', 'conclusion': 'success', 'display_title': 'E2E after merge · 5555555 · interactions'},
                {'id': 4, 'head_sha': '4' * 40, 'head_branch': 'main', 'conclusion': 'success', 'display_title': 'E2E check · on time (Worker cron)'}]
        b.gh_json = lambda *args: runs if 'runs?' in args[1] else None
        b.jobs_of = lambda rid: [{'name': 'interactions', 'conclusion': 'success'}]
        self.assertEqual(b.last_green('interactions', 'f' * 40, lambda a, c: True), '4' * 40)


class Workflows(unittest.TestCase):
    def test_bisect_runs_are_never_main_checks_nor_filed(self):
        e2e = (ROOT / '.github/workflows/e2e.yml').read_text()
        self.assertIn("inputs.bisect && format('Bisect {0} {1}', inputs.suite, inputs.target_ref)", e2e)
        self.assertIn('!inputs.bisect', e2e, 'a bisect step runs no paid judge')
        self.assertIn('python3 tools/e2e_bisect.py after-run "$GITHUB_RUN_ID"', e2e)
        self.assertIn("'Bisect '", (ROOT / '.github/workflows/ui-findings.yml').read_text())
        self.assertIn('Bisect', (ROOT / 'tools/main_e2e_state.py').read_text())
        self.assertRegex((ROOT / 'desktop/e2e/plan-run.mjs').read_text(), r'otherCode = run => /\^\([^)]*Bisect')

    def test_one_bisect_at_a_time(self):
        # 26 Oct 2026: `group: e2e-bisect-${{ inputs.suite }}` let 10 bisects run at once; one group: one runs, the newest waits.
        flow = (ROOT / '.github/workflows/e2e-bisect.yml').read_text()
        self.assertRegex(flow, r'(?m)^concurrency:[^\n]*\n  group: e2e-bisect\s*\n  cancel-in-progress: false')

    def test_skipped_workflow_runs_cannot_replace_a_pending_bisect(self):
        # Separate workflows keep skipped completed-run events out of the manual bisect queue.
        flow = (ROOT / '.github/workflows/e2e-bisect.yml').read_text()
        self.assertNotIn('workflow_run:', flow)
        self.assertNotIn('  revert:', flow)
        revert = (ROOT / '.github/workflows/e2e-revert.yml').read_text()
        self.assertIn("&& 'e2e-revert' || 'e2e-revert-skipped'", revert)
        self.assertNotIn('group: e2e-bisect', revert)

    def test_completed_after_merge_runs_reach_the_revert_proof_not_the_bisect(self):
        flow = (ROOT / '.github/workflows/e2e-revert.yml').read_text()
        trigger = flow.split('\njobs:')[0]
        self.assertIn("workflows: ['CI · End-to-end on Mac + Linux']", trigger)
        self.assertIn('types: [completed]', trigger)
        revert = flow.split('\n  revert:', 1)[1]
        self.assertIn("startsWith(github.event.workflow_run.display_title, 'E2E after merge · ')", revert)
        self.assertIn('github.event.workflow_run.head_repository.full_name == github.repository', revert)
        self.assertIn('python3 tools/backbone_red.py --repo "$GITHUB_REPOSITORY" --run "$RUN_ID" --open', revert)
        self.assertIn('permission-actions: read', revert)
        self.assertIn('actions: write', revert)
        self.assertIn('RERUN_TOKEN: ${{ github.token }}', revert)


if __name__ == '__main__':
    unittest.main()
