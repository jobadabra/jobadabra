---
area: ci
paths: [.github/workflows, .gitar, tools/ship.sh, tools/pre-push-check.sh, tools/pr-verdict.py, tools/affected-tests.py, tools/beta-release.sh, tools/worktree.sh, desktop/e2e, desktop/integration, TESTS.md, docs/rules/change-loop.md]
updated: 2026-11-03
---
# CI, tests and shipping
> Every PR runs unit and integration tests; e2e proof is CI only. `tools/ship.sh` lands a branch as a PR, the owner merges by hand, and Gitar must read Approved before a PR is ready.

## Rules
- Test layers: the beta runs smoke plus the Tier 1 journeys (`desktop/e2e/critical-journeys.json`); every other check is an integration test (`desktop/integration/`: store, app, extension); measurements run nightly and only report. A new check goes to the lowest layer that proves it; a new e2e step needs a registry entry and the owner's yes.
- On this Mac run only the named unit or integration files of the area you touched, in seconds. Never e2e, `npm test`, `tools/check.sh` or a whole suite. A PR runs unit and integration plus the e2e steps it adds or changes (Linux); journeys run after each merge, nightly and in the beta.
- A red e2e: repair by design first ([e2e reliability rules](../superpowers/specs/2026-10-28-e2e-reliability-design.md)), the private skills `fix-failing-e2e` and `e2e-harness` for the how. Red on code unchanged since its last green is flaky: say so first, fix the non-deterministic input class, never one step and never a re-run.
- E2E and integration tests wait for states, not for fixed seconds; locators by role or name; isolated state; one green proves nothing.
- A new gate, hook or CI check only if it would have caught at least 2 real escapes in the last 30 days, or it guards a safety step. No new tests of our own tooling unless they guard safety, data, money, privacy or the release verdict, with a `Guard:` line ([change loop](../rules/change-loop.md)).
- One required check, "All checks passed" (`tools/pr-verdict.py`); a PR's own jobs stay under 10 minutes. Tests also run on Windows and Linux: temp dirs via `os.tmpdir()`, compare paths after normalising slashes.
- A PR is ready only when all checks passed, Gitar reads Approved, and no comment is unanswered. Fix red at once and name the cause.
- Delegated PRs register `branch.<worker-branch>.shipCoordinator` with the coordinator's cmux surface UUID; the watcher independently escalates actionable events there. Verify the worker acts, rather than treating queue acceptance as acknowledgement ([change loop](../rules/change-loop.md)).
- A small fix several open PRs need goes into each branch as one shared commit; no PR waits for another to merge.

## Key files
- `tools/ship.sh`: lands a worktree branch as a PR and watches it (`--background`); `tools/worktree.sh <topic>` makes the worktree.
- `tools/pre-push-check.sh`, `tools/affected-tests.py`: the fast checks and which tests a change can break.
- `tools/pr-verdict.py`, `.github/workflows/pr-gate.yml`, `pr-verdict.yml`: the one required check.
- `.github/workflows/pr-e2e-steps.yml`, `integration.yml`, `journeys.yml`, `e2e.yml`: the layers in CI.
- `desktop/test/nightly/`: real-container release proofs run by harness-daily.yml; PRs keep the network-free declarations/arguments guard. Folder map: [TESTS.md](../../TESTS.md).
- `desktop/e2e/lib/`: the harness; `desktop/e2e/suites/`: the Tier 1 journeys; `desktop/integration/`: integration tests.
- `tools/beta-release.sh`: a beta by hand; no beta starts while main's e2e is red.
- `.gitar/`: the review rules Gitar applies to every PR.

## Live specs
- [E2E reliability design](../superpowers/specs/2026-10-28-e2e-reliability-design.md): the repair rules, the PR plan, the Progress list.
- [Test folders plan](../superpowers/plans/2026-11-03-test-folders.md): tests move into a folder per type, intent and scope ([TESTS.md](../../TESTS.md)).
- [CI agents plan](../superpowers/plans/2026-11-03-ci-agents.md): the registry of AI jobs in CI.

## Ask the sources
ask: github actions runs workflow=pr-verdict status=failure
ask: github prs state=open
Red main list (public): GET https://www.jobadabra.top/ci-state/red-main (the Red main list)

## Lessons
- Timers go in the Worker's scheduler (`app-core/src/scheduler.js`), not GitHub cron: scheduled GitHub runs came hours late or not at all.
- Re-running an older red PR-check run replays the PR body it started with; the newest run decides.
- A test that replays modules in a child process lives in its own module; a self-including replay spawned a chain.
- A hook that blocks a compound shell command blocks its heredoc too: write a PR body file in its own call.
- Count PRs per area at each round-up: a third fix on the same files within a week is a design problem, not a patch.

## Go deeper
[JS lint](../rules/agent-detail.md#js-lint) · [shared verification](../rules/agent-detail.md#shared-verification) · [offline app scenarios](../rules/agent-detail.md#offline-scenarios) · [change loop](../rules/change-loop.md) · [TESTS.md](../../TESTS.md) · [files and size rules](../rules/files.md) · [release guide](../../RELEASE.md) · [AGENTS.md git and tiers](../../AGENTS.md)
