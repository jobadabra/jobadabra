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
| 1/4 | A PR's Windows job runs `--app-only`: no lint, no tooling tests (owner's choice, 4 Nov) | Windows job about 5.7 → 4.3 min, estimated |
| 2/4 | A PR's `desktop (ubuntu)` runs only the files its change reaches | a small PR's Linux job near its setup time |
| 3/4 | The picker can pick site tests (owner, 4 Nov: "We run "site tests" (which are all tests) no matter what's the PR change") | nothing yet: no web PR asks for a pick |
| 4/4 | A web PR's Site tests run only what its change reaches | Site tests 89 s → about 70 s on a page PR, 10-25 s on a CI or test PR |

- 2/4 always runs guards, class tests and tests that read source or data files. Shared config, package files, the test runner or anything the graph can't resolve runs everything. One log line says which files ran and why.
- main keeps running everything after each merge, on both systems.
- After a week: compare red-on-main before and after, and bring the numbers to the coordinator. Windows follows only on the owner's yes.

## Would it have missed anything? (replay, 4 Nov 2026)
The last 40 red `desktop (ubuntu)` PR runs, through `tools/affected-tests.py` with each PR's changed files:

| Reds | Runs | Caught |
|---|---|---|
| A test failed | 29 | 29, after one fix |
| Lint failed, before any test | 11 | 11, lint still runs on every PR |

- The one fix: `rename-guard` runs a tool as a process, so neither imports nor its text named what it reads. It missed 2 runs before the fix.
- 2/4 uses that picker, already proven by the push gate: no new list. Files are matched by name on today's tree, so this is strong evidence, not proof; the week's red-on-main count is the proof.
- Last 25 PRs: median 358 of 1,018 files, 5 run everything. Test time 164 s → about 58 s, estimated.

## Web PRs: Site tests (replay, 4 Nov 2026)
Run 41867775615: 276 files, 232 s of tests, 89.5 s on the step. The 8 slowest files hold 160 s, 4 of them page walkers.

| 30 merged web PRs | Files | Modelled step time, of 72 s for all |
|---|---|---|
| Median | 106 of 276 | 55 s |
| Page, API or Worker change (22) | 90-186 | 52-68 s |
| CI, job or test change (7) | 42-55 | 8-19 s |
| Everything: the test runner changed (1) | 276 | 72 s |

- **Why not less:** a page change really reaches the page walkers, and the ⌘K walk alone takes 50 s. Making that walk faster is the next lever, not a better pick.
- **Why a name is not a scan:** 93 of 97 "scanners" only listed `db/migrations/` to seed a database. Treated as tree scans, every PR ran the slowest tests: 64 s at best.
- **Reach an import line doesn't show:** a walker starts its tool as a process, and the tool loads the Worker or serves `web/public` by a joined path. A page's html or css counts as the Worker. Top-level `shared/` is followed.
- **Reds:** of the last 40 red runs, 25 name a failed site test and 24 of those are picked. The other broke on a public rename, not on the PR's files (`needs-fix-causes`, run 41370411166): rightly not picked, and it shows the cost. A public change that breaks a site test now shows on the next web merge or the daily run, not on an unrelated PR.
- **Order:** this PR first, against the usual "site PR first": web's job runs public main's picker, and until this lands a pick prints paths `node --test` can't find.

## Progress
- [x] 1/4 Windows job leaves out lint and tooling tests on a PR: 5 min 44 s → 4 min 26 s (proof: .github/workflows/tests-desktop-windows.yml @08129648)
- [x] 2/4 Linux job runs only what a change reaches (proof: tests/guards/rules/test_pr_desktop_picks.py @f30adcc2)
- [x] 3/4 The picker can pick site tests (proof: tests/guards/rules/test_pr_site_picks.py)
- [ ] 4/4 A web PR's Site tests run only what they reach
- [ ] Red-on-main compared after a week
