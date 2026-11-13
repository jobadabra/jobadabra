"""tools/red-main.sh (11 Oct 2026): main's state from the CI runs of its newest commits. The newest commit with a finished verdict decides; a fix still building proves nothing (the old exemption let four landings through on top of a fix that ended red); the counted workflows are listed in one place and every workflow is classified here."""
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / 'tools' / 'red-main.sh'
TESTS, PAGES = 'CI · Tests', 'CI · Integration · Page cases (all cases, real extension, Linux)'

# Every workflow of .github/workflows, counted for red main or ignored with the reason (a new workflow fails the last test until it is put here: a conscious choice).
CLASSIFIED = {
    'CI · Re-run a grey beta once': 'ignored: a completed beta hold retries grey jobs once, never tests a push to main',
    # Why (30 Oct 2026, owner, JOB-45): nightly model drift is its own warning/rate check, never a PR or beta gate.
    'CI · Stored AI answer drift': 'ignored: nightly drift rates, warm-up warnings and a deduplicated lasting-red issue; never required',
    'Extension · Chrome Web Store publish': 'ignored: started by tools/release-stable.sh on a stable release, a PR editing it, or by hand; never runs on a push to main',
    # Why (3 Nov 2026, owner: stable only): tells the feedback reporters; started by tools/release-stable.sh after a promotion, never a push or PR check.
    'Release · Tell the feedback reporters': 'ignored: started by tools/release-stable.sh once a build is stable, or by hand; never runs on a push to main',
    'Release · Weekly Microsoft Store submission': 'ignored: started on Mondays by the Worker (and by hand); never runs on a push to main; a red run tells the owner itself (its alert job)',
    'Release · Watch the Microsoft Store review': 'ignored: started hourly by the Worker (and by hand); never runs on a push to main; a red run is its own finding (a status that cannot be read)',
    # Why (3 Nov 2026, owner: Send to AI on one feedback): started by the site when the owner clicks it (workflow_dispatch) and by a closed fd-ai/ pull request; never a push or PR check.
    'CI · AI fixer': 'ignored: started by hand (workflow_dispatch) for one item; never runs on a push to main',
    'CI · Agent harness stats': 'ignored: report (the numbers of the admin page Agent harness); a red run blocks nothing',
    'CI · AI fixer follow': 'ignored: started by the AI fixer\'s own jobs (workflow_dispatch) to watch one draft PR; never runs on a push to main',
    'AI fixer': 'ignored: feedback-ai-closed.yml reports closed fixer pull requests; never runs on a push to main',
    'Extension · Web Store zip': 'ignored: by hand or on an extension-v* tag; builds the store package, never runs on a push to main',
    # Why (1 Nov 2026, owner via a8: "Nightly report"): the clock-moved time-bomb report is report only, called by night pass 1, never a push or PR check.
    'CI · Clock moved (nightly, report only)': 'ignored: nightly report of tests that fail with the clock moved; called by night pass 1, never counted for main',
    # Why (1 Nov 2026, owner via a8: "Yes, nightly report"): the coverage report is report only, called by night pass 1, never a push or PR check.
    'CI · Coverage report (nightly, report only)': 'ignored: nightly line % per layer and GTM journeys with a test; called by night pass 1, never counted for main',
    # Why (1 Nov 2026, owner via mac-07: "Let the prompts being checked nightly and report"): the prompt-case replay is report only, called by night pass 1, never a push or PR check.
    'CI · Prompt cases (nightly, report only)': 'ignored: nightly replay of the live prompt-case set on the Codex plan; called by night pass 1, never counted for main',
    # Why (5 Nov 2026, owner via mac-32: "Judge first"): the judge exam is report only, started by hand, never a push or PR check.
    'CI · AI judge exam': 'ignored: by hand only; scores the AI user agent\'s judge on 11 recorded notes through the broker, never runs on a push to main',
    'CI · Tests': 'counted',
    'CI · Re-run jobs that did not run': 'ignored: after a beta or e2e run ends; only re-runs jobs that got no runner or failed in setup before their suite, never tests a push to main',
    "CI · Start the What's new publish": 'ignored: after a beta approval or a promotion to stable only, never on a push to main; it starts the site repo\'s publish and never fails a release',
    'Proof · LibreOffice add-on on Mac and Windows': 'ignored: pull requests that edit the add-on, and by hand; downloads LibreOffice for real on Mac and Windows runners, never on a push to main',
    'Proof · Screenshot review scored on the judged issues': 'ignored: by hand only (it spends a few cents on Claude); scores a review model, never runs on a push to main',
    'Proof · Codex subscription broker': 'ignored: pull requests that edit it, and by hand; proves the OIDC Codex broker without an AI key, never on a push to main',
    # Why (2 Nov 2026, owner: "the same workflow on all repos"): the shared PR-description check other org repos call (workflow_call); it never runs on this repo's main.
    'CI · PR description (reusable)': 'ignored: workflow_call only, run for another repo\'s pull request; checks that PR\'s description, never runs on a push to main',
    'CI · Claude review (reusable)': 'ignored: workflow_call only, a Claude review of one PR (claude-review.yml calls it); a reviewer, not a check, never runs on a push to main',
    'CI · Claude review': 'ignored: started by a PR comment, by hand or by pr-verdict.yml (workflow_dispatch / issue_comment); reviews one PR, never runs on a push to main',
    'CI · PR labels (reusable)': 'ignored: workflow_call only, run for a repo\'s own labels caller (pr-labels.yml); sets labels, tests nothing, so its result says nothing about main',
    # Why (2 Nov 2026, owner: "One script + weekly check"): the weekly org-setup check is report only (one issue), started by the Worker timer or by hand, never a push or PR check.
    'CI · E2E weekly summary': 'ignored: Mondays and by hand only; posts the week\'s e2e issue and Telegram message from the site snapshot, never runs on a push to main',
    'CI · Integration intelligence': 'ignored: hourly and by hand only; reads finished integration runs and publishes one snapshot to the site, never runs on a push to main',
    'CI · Org repos on the shared setup (weekly, report only)': 'ignored: weekly report of org repos that drift from templates/org-repo; keeps one issue, never runs on a push to main',
    'PR': 'ignored: PR housekeeping (pr-labels.yml labels conflicts on a push to main; pr-closed-cancel.yml cancels a closed PR\'s runs); it tests nothing, so its result says nothing about main',
    # Why (2 Nov 2026, owner: "A PR adding a new e2e or modifying the e2e.. should have it as a PR CI check"): E2E (named by layer since 5 Nov 2026) is the planner of a PR's changed e2e steps; pull_request only, never runs on main.
    'E2E': 'ignored: pull_request only; plans and starts e2e for the steps a PR adds or edits, never runs on a push to main',
    # Why (3 Nov 2026, AI user agents 7/12): the daily AI user agent is started by the Worker timer at 04:40 UTC or by hand, spends AI credit through the broker and files its own issues; never a push or PR check.
    'CI · AI user agent': 'ignored: the Worker timer once a night and by hand only; a session of the AI user agent files issues through the Finder, never runs on a push to main',
    'CI · Prompt cases (by-hand re-ask)':'ignored: by hand only (broker calls); compares the selected ref with main, never a push check',
    'Guard': 'ignored: runs on pull requests only, never on main; its checks gate the merge',
    'CI · PR verdict': 'ignored: writes a pull request\'s "All checks passed" status when its workflows end; it runs on main\'s copy but judges PR commits only',
    'E2E · Bisect a red main suite': 'ignored: started by e2e.yml after a red main suite (gate G2b); it bisects, it never runs on a push to main',
    'E2E · Revert a red backbone merge': 'ignored: after an "E2E after merge" run on main ends; it reads that run and offers one revert PR (plan PR 18), never tests a push to main',
    'E2E · Suspend a flaky step': 'ignored: after an e2e run on main ends; it reads that run\'s failed steps and opens one owner issue per flaky step, never tests a push to main',
    'E2E · Weekly root causes': 'ignored: a Monday report (gate G6); it reads runs and writes one issue, never runs on a push to main',
    'CI · E2E steps after a merge': 'ignored: it only plans and starts e2e.yml on main; that run\'s red is filed on the merged PR and counted by the beta gate (tools/main_e2e_state.py), not a block on every landing',
    'CI · Search check (18 personas)': 'ignored: a night report on live public job sites; started by the Worker, never by a push to main',
    'CI · Search reference (18 personas)': 'ignored: a report on a live public job portal (EURES), started by hand; never by a push to main',
    "CI · Search pair (a PR's before/after, by hand)": 'ignored: a PR\'s before/after searches on live public job sites, started by hand for one PR; never by a push to main',
    'CI · Search profiles (by hand)': 'ignored: a report of the fictional profiles\' first search on live public job sites, started by hand; never by a push to main',
    'CI · E2E suites for a PR': 'ignored: runs on pull requests only (on: paths:), never on main; its red blocks the PR through All checks passed',
    'CI · Hosted Always on e2e': 'ignored: pull requests that touch the hosted code, and nightly; never on a push to main',
    'Tooling': 'ignored: alone only on pull requests that change the harness (on: paths:); on main build.yml calls it as a job of CI · Tests (1 Nov 2026), so its red is CI · Tests\' red',
    'Smoke': 'ignored: alone only on pull requests that touch the app (on: paths:); on main build.yml calls it as a job of CI · Tests, so its red is CI · Tests\' red',
    'Integration': 'ignored: integration.yml and page-cases.yml, alone only on pull requests that touch what they reach (on: paths:); on main build.yml calls it as a job of CI · Tests (1 Nov 2026), so its red is CI · Tests\' red',
    'CI · E2E tooling tests · daily': 'ignored: its own daily run alerts the CI chat; not a main push check',
    'Unit': 'ignored: python, app-core and desktop (Linux, Windows); on main each runs inside CI · Tests (build.yml calls it); alone only on pull requests',
    'CI · Tests · site': 'ignored: on main it runs inside CI · Tests (build.yml calls it); alone only on pull requests',
    'CI · Flow e2e (apply + applyflows, optional)': 'ignored: runs on pull requests only (an optional check), never on main',
    'CI · Lab Job Search · PR replay (offline)': 'ignored: pull requests that touch the search only, never on main; a real Worse fails the PR, a stale tape does not',
    'CI · Lab Job Search · replay (offline)': 'ignored: on a push to main that touches the search, daily and by hand; a worse or stale candidate shows on /admin/job-search/lab, it is not a red main',
    'CI · Site replays · all (offline)': 'ignored: scheduled once a day, alerts on a real drop by itself, never required',
    'CI · Fix verdicts (offline replays)': 'ignored: informational verdicts for /admin/form-filling/lab after the nightly replay, never required',
    'CI · Journeys (card and panel per step)': 'ignored: by hand only, tells Telegram itself, never required',
    'CI · Replay refill': 'ignored: by hand, or on main after a prompt change; a failed run sends its own Telegram alert and must never block a push',
    'CI · End-to-end on Mac + Linux': 'ignored: the e2e suites run on schedule and by hand with live-site and AI flakiness; a red one is an issue, not a block on every landing',
    'CI · End-to-end on Windows': 'ignored: same, slower and by schedule', 'CI · Python tests on Windows (by hand)': 'ignored: started by hand',
    'CI · Fresh-install smoke (daily, report only)': 'ignored: report only, a red day is a finding (the published installer no longer installs) and blocks nothing (owner, 1 Nov 2026)', 'CI · Upgrade + data test (weekly, report only)': 'ignored: report only, a red day is a finding for the Testing Overview and blocks nothing (owner, 1 Nov 2026)', 'Spike · Windows Store package (MSIX)': 'ignored: by hand, a one-off spike', 'Build · Windows Store package (MSIX)': 'ignored: by hand, owner uploads the file', 'CI · Pool smoke (by hand)': 'ignored: by hand, live sites', 'CI · Record sites (by hand)': 'ignored: by hand, live sites', 'CI · Daily watch list': 'ignored: daily, live sites', 'CI · Random draw (every 2nd day)': 'ignored: daily, live sites, a weak draw is data not a red main', 'CI · Edge check (Windows, by hand)': 'ignored: by hand', 'CI · Windows smoke (weekly)': 'ignored: weekly',
    'Release · Build, test, beta': 'ignored: the release run, its own gates and rollback (pipeline gates)', 'Release · Promote to stable': 'ignored: release', 'Release · Guard Latest': 'ignored: release; hourly check that only a desktop build is Latest', 'CI · Promotion dry run': 'ignored: release rehearsal',
    'CI · Release to beta': 'ignored: release', 'CI · Stable canary': 'ignored: release', 'Release · Website': 'ignored: site deploy', 'Release · Ready to send runner': 'ignored: site deploy', 'CI · Ready to send image': 'ignored: pull requests only, never main', 'Release · Website preview (next)': 'ignored: site deploy',
    'Release · Product media': 'ignored: makes the site\'s pictures and videos after a screen change; a broken scene fails its own run, not main\'s tests',
    'Release · Worker': 'ignored: worker deploy', 'CI · Judge exam': 'ignored: AI eval', 'CI · Control tests (measure, not required)': 'ignored: a measure of the fill ladder; a miss never fails it', 'CI · Planted code bugs': 'ignored: nightly measurement',
    'CI · AI code review': 'ignored: advice on a PR', 'CI · AI cost billed': 'ignored: report', 'CI · Schedule watchdog': 'ignored: report', 'CI · Hosted Always on cost probe (one-off)': 'ignored: pull requests (a label) and by hand only, never main', 'CI · Server proof (one-off)': 'ignored: pull requests (a label) and by hand only, never main', 'CI · Self-heal stats': 'ignored: report', 'CI · Ops overview': 'ignored: report', 'CI · E2E intelligence': 'ignored: report', 'CI · Daily build digest': 'ignored: report', 'CI · PR checks scorecard': 'ignored: report', 'CI · Agent coding stats': 'ignored: report', 'CI · Changelog publish': 'ignored: report',
    'CI · UI findings': 'ignored: UI loop', 'CI · UI fixer': 'ignored: UI loop', 'CI · UI verdicts': 'ignored: UI loop', 'CI · Top issues list': 'ignored: UI loop', 'CI · Bug Tracker rows': 'ignored: UI loop', 'CI · Fixed-issue labels': 'ignored: UI loop',
    'CI · Sentry fixer': 'ignored: fixer loop', 'UI loop · Finder self-review': 'ignored: UI loop',
    'Pipeline · Find new jobs': 'ignored: product pipeline', 'Pipeline · Gmail and Calendar': 'ignored: product pipeline', 'Pipeline · Find new employers': 'ignored: product pipeline',
    'Product brain · Daily brief': 'ignored: report',
    'Lab CI': "ignored: lab PRs (dispatched by ship.sh), a 20-minute sweep and a daily run of the private lab's tests; it never runs on a push to main and must never block a landing here",
    'Central scout':"ignored: scheduled every 6 h; a failed run tells the owner on Telegram by itself and must never block a push",
}


@unittest.skipUnless(shutil.which('bash') and shutil.which('jq') and shutil.which('git'), 'needs bash, jq and git')
class RedMainTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.repo = self.tmp / 'repo'
        self.repo.mkdir()
        git = lambda *a: subprocess.run(['git', '-C', str(self.repo), '-c', 'user.email=t@t', '-c', 'user.name=t', *a], check=True, capture_output=True, text=True).stdout.strip()
        git('init', '-q', '-b', 'main')
        self.shas = []
        for n in range(6):
            (self.repo / 'f').write_text(str(n))
            git('add', '-A'); git('commit', '-qm', f'c{n}')
            self.shas.append(git('rev-parse', 'HEAD'))
        git('update-ref', 'refs/remotes/origin/main', 'HEAD')
        bin_dir = self.tmp / 'bin'; bin_dir.mkdir()
        state = (self.tmp / 'gh').as_posix()
        (self.tmp / 'gh').mkdir()
        (bin_dir / 'gh').write_text('#!/bin/bash\n'
                                    f'state="{state}"\n'
                                    'case "$1 $2" in\n'
                                    '  "run list") cat "$state/runs.json" ;;\n'
                                    '  "run view") id="$3"; q=""; while [ $# -gt 0 ]; do [ "$1" = --jq ] && q="$2"; shift; done; jq -r "$q" "$state/jobs-$id.json" 2>/dev/null || echo 0 ;;\n'
                                    '  "run rerun") echo "$3" >> "$state/reruns" ;;\n'
                                    'esac\n')
        (bin_dir / 'gh').chmod(0o755)
        self.bin = bin_dir
        self.runs = []
        self.next_id = 100

    def run_at(self, commit, workflow, status='completed', conclusion='success', failed_jobs=0):
        self.next_id += 1
        self.runs.append({'workflowName': workflow, 'headSha': self.shas[commit], 'status': status, 'conclusion': conclusion if status == 'completed' else '', 'databaseId': self.next_id,
                          'updatedAt': f'2026-10-11T15:0{commit}:00Z', 'url': f'https://github.com/x/y/actions/runs/{self.next_id}'})
        (self.tmp / 'gh' / f'jobs-{self.next_id}.json').write_text(json.dumps({'jobs': [{'conclusion': 'failure'}] * failed_jobs + [{'conclusion': 'success'}]}))

    def green_at(self, commit):
        self.run_at(commit, TESTS); self.run_at(commit, PAGES)

    def state(self, **extra):
        (self.tmp / 'gh' / 'runs.json').write_text(json.dumps(list(reversed(self.runs))))   # gh lists the newest first
        env = {'PATH': f'{self.bin.as_posix()}:{__import__("os").environ["PATH"]}', 'RED_MAIN_REPO': str(self.repo), **extra}
        result = subprocess.run(['bash', str(SCRIPT)], capture_output=True, text=True, env=env, timeout=60)
        return result.stdout.strip(), result.returncode

    def test_green_when_the_newest_commit_with_a_verdict_is_green(self):
        self.green_at(3)
        self.assertEqual(self.state(), (f'green {self.shas[3][:7]}', 0))

    def test_the_old_name_of_page_cases_still_counts_until_28_oct_2026(self):
        self.run_at(3, TESTS); self.run_at(3, 'CI · Recorded pages (all cases, real extension, Linux)')
        self.assertEqual(self.state(), (f'green {self.shas[3][:7]}', 0))

    def test_red_names_the_commit_workflow_url_and_time(self):
        self.green_at(2)
        self.run_at(4, TESTS, conclusion='failure', failed_jobs=1); self.run_at(4, PAGES)
        out, code = self.state()
        self.assertEqual(code, 1)
        self.assertRegex(out, rf'^red\|{self.shas[4][:7]}\|CI · Tests\|https://\S+/runs/\d+\|2026-10-11T15:04:00Z\|\d+$')

    def test_a_run_github_refused_to_start_is_red_and_names_the_first_refused_commit(self):
        # 26 Oct 2026: build.yml's call asked for a permission it did not grant; "CI · Tests" was startup_failure on every push for an hour, main ran no tests,
        # and this said "unknown". Every later push is refused too: the red is the FIRST refused commit (the one to fix or revert), never the tip.
        self.green_at(1)
        self.run_at(2, TESTS, conclusion='startup_failure'); self.run_at(3, TESTS, conclusion='startup_failure'); self.run_at(5, TESTS, conclusion='startup_failure')
        out, code = self.state()
        self.assertEqual(code, 1)
        self.assertRegex(out, rf'^red\|{self.shas[2][:7]}\|CI · Tests did not start \(startup_failure\)\|https://\S+/runs/\d+\|2026-10-11T15:02:00Z\|\d+$')
        self.assertFalse((self.tmp / 'gh' / 'reruns').exists(), 'a refused workflow file fails the same way again: no re-run')

    def test_a_refused_streak_longer_than_the_window_still_names_its_first_commit(self):
        # 26 Oct 2026, live: the streak grew past the 20 commits read and the named commit moved 771c9fe -> fd3c7fc -> 2281de4 as merges landed.
        self.green_at(0)
        for commit in (1, 2, 3, 4, 5): self.run_at(commit, TESTS, conclusion='startup_failure')
        out, code = self.state(RED_MAIN_WINDOW='2')
        self.assertEqual(code, 1)
        self.assertTrue(out.startswith(f'red|{self.shas[1][:7]}|'), out)

    def test_a_refused_run_fixed_by_a_later_green_commit_blocks_nobody(self):
        self.green_at(1); self.run_at(2, TESTS, conclusion='startup_failure'); self.green_at(4)
        self.assertEqual(self.state(), (f'green {self.shas[4][:7]}', 0))

    def test_a_fix_still_building_on_top_of_a_red_commit_does_not_unblock_anyone(self):
        # 11 Oct 2026: b6dd70e (a fix attempt) was building when others pushed; it ended red
        self.green_at(2)
        self.run_at(3, TESTS, conclusion='failure', failed_jobs=1); self.run_at(3, PAGES)
        self.run_at(4, TESTS, status='in_progress'); self.run_at(4, PAGES, status='in_progress')
        self.assertEqual(self.state()[1], 1, 'red until a later commit has a completed green run')

    def test_a_red_fix_does_not_unblock_and_a_green_one_does(self):
        self.green_at(1)
        self.run_at(2, TESTS, conclusion='failure', failed_jobs=1); self.run_at(2, PAGES)
        self.run_at(3, TESTS, conclusion='failure', failed_jobs=1); self.run_at(3, PAGES)   # the fix attempt is red too
        self.run_at(4, TESTS, status='in_progress')
        out, code = self.state()
        self.assertEqual((code, out.split('|')[1]), (1, self.shas[3][:7]), 'the newest verdict is the red fix attempt')
        self.green_at(5)
        self.assertEqual(self.state(), (f'green {self.shas[5][:7]}', 0))

    def test_a_running_build_with_a_failed_job_is_already_red(self):
        self.green_at(2)
        self.run_at(4, TESTS, status='in_progress', failed_jobs=1); self.run_at(4, PAGES, status='in_progress')
        self.assertEqual(self.state()[1], 1)

    def test_a_page_cases_run_is_not_counted_any_more(self):
        # 15 Oct 2026: main runs the page cases as a step of CI · Tests; a (by-hand) page-cases run neither makes main red nor is needed for green
        self.run_at(3, TESTS); self.run_at(3, PAGES, conclusion='failure', failed_jobs=1)
        self.assertEqual(self.state(), (f'green {self.shas[3][:7]}', 0))

    def test_a_commit_with_no_tests_run_yet_is_not_green_yet(self):
        self.green_at(1)
        self.run_at(3, PAGES)   # its CI · Tests run does not exist yet: the verdict falls to the commit before
        self.assertEqual(self.state(), (f'green {self.shas[1][:7]}', 0))

    def test_a_cancelled_run_of_the_newest_commit_blocks_nobody_and_is_rerun(self):
        self.green_at(1)
        self.run_at(5, TESTS, conclusion='cancelled'); self.run_at(5, PAGES)
        out, code = self.state()
        self.assertEqual(code, 0)
        self.assertEqual((self.tmp / 'gh' / 'reruns').read_text().split(), [str(self.runs[-2]['databaseId'])])

    def test_a_cancelled_run_of_an_older_commit_is_not_rerun(self):
        # 15 Oct 2026: a push to main cancels the older commit's runs (the newest commit's run decides); re-running them would take the runners back
        self.green_at(1)
        self.run_at(3, TESTS, conclusion='cancelled'); self.run_at(3, PAGES)
        out, code = self.state()
        self.assertEqual(code, 0)
        self.assertFalse((self.tmp / 'gh' / 'reruns').exists(), 'no re-run of a superseded commit')

    def test_no_gh_answer_is_unknown_and_never_blocks(self):
        env = {'PATH': '/usr/bin:/bin', 'RED_MAIN_REPO': str(self.repo)}
        result = subprocess.run(['bash', str(SCRIPT)], capture_output=True, text=True, env=env, timeout=30)
        self.assertEqual((result.stdout.strip(), result.returncode), ('unknown', 0))

    def track(self):
        env = {'PATH': f'{self.bin.as_posix()}:{__import__("os").environ["PATH"]}', 'RED_MAIN_REPO': str(self.repo)}
        (self.tmp / 'gh' / 'runs.json').write_text(json.dumps(list(reversed(self.runs))))
        result = subprocess.run(['bash', str(SCRIPT), 'track'], capture_output=True, text=True, env=env, timeout=60)
        return result.stdout.strip(), result.returncode

    def reruns(self):
        path = self.tmp / 'gh' / 'reruns'
        return path.read_text().split() if path.exists() else []

    def test_a_red_run_gets_exactly_one_rerun_and_the_clock_does_not_move(self):
        self.green_at(1)
        self.run_at(3, TESTS, conclusion='failure', failed_jobs=1); self.run_at(3, PAGES)
        first, code = self.track()
        self.assertEqual(code, 1)
        self.assertEqual(len(self.reruns()), 1, 'the failed jobs are re-run once')
        self.runs[-2]['updatedAt'] = '2026-10-11T15:59:00Z'   # the re-run touched the run again: still red
        again, _ = self.track()
        self.assertEqual(len(self.reruns()), 1, 'never a second re-run of the same run')
        self.assertEqual(first.split('|')[4], again.split('|')[4], 'the 5 minute clock stays at the first red completion')

    def test_while_the_rerun_is_going_main_is_not_green_and_a_green_rerun_clears_the_red(self):
        self.green_at(1)
        self.run_at(3, TESTS, conclusion='failure', failed_jobs=1); self.run_at(3, PAGES)
        self.track()
        self.runs[-2].update({'status': 'in_progress', 'conclusion': ''})   # the re-run: no failed job showing, commit 3 unfinished, commit 1 green behind it
        (self.tmp / 'gh' / f'jobs-{self.runs[-2]["databaseId"]}.json').write_text(json.dumps({'jobs': [{'conclusion': None}]}))
        out, code = self.track()
        self.assertEqual((code, out.split('|')[0], out.split('|')[1]), (1, 'red', self.shas[3][:7]), 'the older green commit does not make main green while the red commit is being re-run')
        self.runs[-2].update({'status': 'completed', 'conclusion': 'success'})
        out, code = self.track()
        self.assertEqual((code, out), (0, f'green {self.shas[3][:7]}'))
        log = (self.repo / '.git' / 'gate-timing.log').read_text()
        self.assertRegex(log, r'red-main ended start=\S+ cause=CI_·_Tests sha=\S+ claim=- fix=\S+ minutes=')

    def test_every_workflow_is_classified_and_the_counted_ones_are_the_scripts_list(self):
        names = {re.search(r'^name:\s*(.+?)\s*$', p.read_text(), re.M).group(1).strip('"\'') for p in (ROOT / '.github' / 'workflows').glob('*.yml')}
        names = {re.sub(r'\((\d+ of )?\d+ pinned rows\)', '(N pinned rows)', n) for n in names}   # the PR replay check's name carries its counts ("<k> of <n> pinned rows")
        self.assertEqual(sorted(names - set(CLASSIFIED)), [], 'a workflow with no classification: add it to CLASSIFIED (counted or ignored with a reason)')
        listed = re.search(r'RED_WORKFLOWS=\(([^)]*)\)', SCRIPT.read_text()).group(1)
        counted = sorted(re.findall(r'"([^"]+)"', listed))
        self.assertEqual([c for c in counted if not any(n.startswith(c) and CLASSIFIED[n] == 'counted' for n in names)], [], 'every name in RED_WORKFLOWS is a counted workflow')
        self.assertEqual(sorted(n for n, how in CLASSIFIED.items() if how == 'counted' and n in names and not any(n.startswith(c) for c in counted)), [], 'every counted workflow is listed')


if __name__ == '__main__':
    unittest.main()
