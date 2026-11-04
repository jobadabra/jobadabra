# PR time: a typical PR's checks finish in under 3 minutes

**Verdict:** the last job sets the wait, and it's a desktop job. Windows leaves out what can't differ there; Linux runs only the tests a change reaches.
Owner, 4 Nov 2026: "can we activate/run only the ones that make sense, that are relevant for the PR changes?" · "Both steps, Linux first (Recommended)". Sketch: https://claude.ai/artifact/7fxrmRWqqmyjjyKRuFryJM

## Measured before (last 25 merged PRs, first job start to last required job end)
| Median | p90 | Under 3 min | Last job |
|---|---|---|---|
| 5.5 min | 7.1 min | 1 of 25 | desktop Windows on 10, desktop Linux on 6 |

Script: label, Gitar, verdict and `cancel` jobs left out, since they end long after the checks.

## What the time is (Windows run 41811466015, 5 min 44 s)
| Part | Time |
|---|---|
| Setup and `npm ci` | 44 s |
| Lint | 28 s |
| Tests, 1,017 files on 3 workers | 267 s |

- **"Stuck at 99" is one file:** `test/tooling/ci/e2e-reliability-check.test.js`, 109 s on Windows and 10 s on Linux. It makes about 1,000 git calls. The reporter prints files in order, so 100 finished files waited behind it.
- **Starting a file costs about 0.33 s on Windows:** about 40% of all test time goes to starts, so running fewer files helps more than faster tests.

## Plan
| PR | What | Who gets what |
|---|---|---|
| 1/2 | A PR's Windows job runs `--app-only`: no lint, no tooling tests (owner's choice, 4 Nov) | Windows job about 5.7 → 4.3 min, estimated |
| 2/2 | A PR's `desktop (ubuntu)` runs only the files its change reaches | a small PR's Linux job near its setup time |

- 2/2 always runs guards, class tests and tests that read source or data files. Shared config, package files, the test runner or anything the graph can't resolve runs everything. One log line says which files ran and why.
- main keeps running everything after each merge, on both systems.
- After a week: compare red-on-main before and after, and bring the numbers to the coordinator. Windows follows only on the owner's yes.

## Would it have missed anything? (replay, 4 Nov 2026)
The last 40 red `desktop (ubuntu)` PR runs, through `tools/affected-tests.py` with each PR's changed files:

| Reds | Runs | Caught |
|---|---|---|
| A test failed | 29 | 29, after one fix |
| Lint failed, before any test | 11 | 11, lint still runs on every PR |

- The one fix: `rename-guard` runs a tool as a process, so neither imports nor its text named what it reads. It missed 2 runs before the fix.
- 2/2 uses that picker, already proven by the push gate: no new list. Files are matched by name on today's tree, so this is strong evidence, not proof; the week's red-on-main count is the proof.
- Last 25 PRs: median 358 of 1,018 files, 5 run everything. Test time 164 s → about 58 s, estimated.

## Progress
- [x] 1/2 Windows job leaves out lint and tooling tests on a PR: 5 min 44 s → 4 min 26 s (proof: .github/workflows/tests-desktop-windows.yml @08129648)
- [x] 2/2 Linux job runs only what a change reaches (proof: tests/guards/rules/test_pr_desktop_picks.py)
- [ ] Red-on-main compared after a week
