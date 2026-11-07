# A PR runs the tests of what it touched (short name ts)

Owner, 7 Nov 2026: "desktop unit tests still take crazily long" · "We should test only the touched parts" · chose "Touched only + fix the slow file".
Board draft: "PR unit tests: touched parts only (and the 110 s test file)". Main keeps running everything; a miss shows there and a red merge is reverted (the accepted trade).

## Design

**Why this area went round (4+ selection PRs in 7 days: #3153, #3256, #3302, #3208, #2971):** each added a case to `tools/affected-tests.py`; none stated what a test kind is picked by.

**States (kinds of file under `desktop/test`):** unit (946 files), guard (98), tooling (23).

**One owner:** `pick_node_area` for the desktop area in `tools/affected-tests.py`. One rule for every kind: a test is picked when what it imports, spawns, mentions or declares it reads includes a changed file.

**Measured causes (counts only, 7 Nov 2026, #3439 = 2 files under `desktop/e2e`, picked 341 desktop tests; #3434 348; #3431 673):**
1. `pick_node_area` picks every guard for any desktop change (`'/guards/' in rel(t)`) and any test flagged `scanner` (`scanner and scan_ok`, always true for desktop).
2. `scanner` is one boolean ("its text or an imported helper under scripts/tools/test/e2e matches `SCANNER_RE`"). `desktop/test/toast-scan.js` (152 importers), `activity-source.js` (25) and `main-source.js` (14) each read named files or one named folder with `fs` (main-source.js: `main.js` and `lib/*-handlers.js`), which the import graph cannot see, so 219 unit tests and 15 of 23 tooling tests count as whole-tree scanners.
3. Windows: a pick longer than `WINDOWS_ARGS_BUDGET` runs every non-tooling test by glob (`tools/check.py` `desktop_app_only`), while the check line prints the pick's size: "598 test files" then "started · 1069 files".
4. `desktop/test/tooling/ci/e2e-reliability-check.test.js` (30 tests) made 61 temp git repos of about 10 git processes each, plus the checker's own 11: 59.9 s on a Mac, about 110 s on Windows.

**Verdicts (changed path → tests):**
| Changed | Picks |
|---|---|
| app, extension or app-core file | unit tests that reach it (import, spawn, or a declared `// Reaches:` read), and guards that declare a read of it |
| `tools/`, `.github/`, `desktop/e2e`, `desktop/integration`, `desktop/scripts` | tooling tests that reach or declare it; tooling runs only then |
| `.md`, `docs/` | none (unchanged) |
| dependency files, the test runner | all (unchanged) |
| main | everything (unchanged) |

A fs-reading helper says what it reads once, on a `// Reaches:` line that `desktop/e2e/lib/test-reach.mjs` already parses; its importers inherit it through the import closure. A guard whose header says `Guard: safety|data|money|privacy|release` stays always-picked; a guard leaves "always" only with a declared reach; the "always" list is printed in the PR.

The runner fails when the number of files it runs differs from the number it printed. A long Windows pick is split into several commands under the budget; there is no glob fallback.

## Progress
- [x] 1/3 The slowest tooling test builds its git history in one process (59.9 s → 29.9 s on a Mac; same 30 assertions) (proof: desktop/test/tooling/ci/e2e-reliability-check.test.js @6cd86343)
- [x] 2/3 Windows runs only the files it picked: a long pick is several commands under the budget, never the glob; the runner fails when the files it runs differ from the files it printed (proof: tests/guards/rules/test_pr_desktop_picks.py)
- [x] 3/3 Selection: folder readers and tree walkers told apart, tooling tests only for tooling changes, five classes of reader the folder rule alone dropped picked again (proof: tests/guards/rules/test_pr_desktop_picks.py)
- [x] 4/5 A package.json change runs every test only when more than its scripts changed: a scripts-only edit (#3475 added one script line and ran all 1068 tests) picks like any file, plus the tests that name a changed script (proof: tests/guards/rules/test_pr_desktop_picks.py)
- [ ] 5/5 On a PR the Windows job runs only the picked tests that are OS-sensitive (decided from the test's code); Linux runs the whole pick, main and the nightly everything (owner: "Only windows OS sensitive tests")

Changed from the Design above, on measurement (7 Nov 2026): no guard file needed a declared `// Reaches:` line. 90 of the 98 guards read named folders with `readdirSync` and name them in their own text, so the picker matches a changed file's folder against the quoted folder names in the test and its helpers. The fresh review found five kinds of reader this alone dropped, each now picked with a positive control: a recursive walk from a root held in a variable (`readdirSync(dir)` and `isDirectory()`; such a new walker must name its folder), a tooling test that names a folder (recorded-cases), the ratchets that read `git ls-files` (hardcoded-page-words, unpinned-clock, file-size), and guards over the test files (picked when a test file changes). A second review added: a reader names any folder on the changed path (not only the first), or the file itself when it sits directly under `desktop/` (main.js is read by name through a helper). Import lines do not count as naming a folder. Tooling tests run for a change to `tools/`, `.github/`, `desktop/e2e`, `desktop/integration`, `desktop/scripts` or `desktop/test/tooling`.

## Design: tests that start a git process per case (6/7; owner, 7 Nov 2026: "windows unit tests are still very slow", "Make the slow tests faster")

**Why a Design block:** `e2e-reliability-check.test.js` was made fast once already (#3442: one repo, one `git fast-import` per history; 110 s → 72 s on Windows) and is still the slowest file (70.9 s of the 468 s Windows file-time on main run 42379362652). A third change to the same file in a week is a redesign, not another patch.

**Measured cause of the 70.9 s:** 1,207 git processes for 30 tests (Mac, a `git` shim counting calls): 107 histories × (1 fast-import by the test + 11 by `checkPush`: merge-base, 2 diffs, log, and 2 per changed file for `ls-tree` + `show`, both sides, plus the registry). Mac 25.8 s ≈ 21 ms a process; Windows 70.9 s ≈ 59 ms a process. #3442 removed the 61 repos × 10 processes but not the checker's own spawns.

**Intended behaviour (states, their one owner, the verdicts):**
- *What a case needs from git:* the merge base, the changed names, the hunks, the messages, and the text of each changed file on both sides. One owner: `checkPush` in `tools/e2e-reliability-check.mjs`.
- *Reading files:* all of a case's `<revision>:<path>` reads go through ONE `git cat-file --batch` process (`readBlobs`), never one `ls-tree` + `show` per file. A path that is not in the revision is `null`; anything that is not a file, or a name with a line break, fails closed (as every git error does).
- *The tests:* the same 30 assertions on the same real git history (renames, hunks and messages are git's own); a new test of `readBlobs` on its own (missing path, multi-byte text, a directory, a line break).
- *Not done, on purpose:* an in-memory fake of git. It would test a re-implementation of `diff -U0`, not the checker; the cost of real git is the number of processes, not git.
- *The same cause in `why-changed.test.js`* (417 processes for 16 tests, 27.3 s on Windows): its pushes were built by ~10 processes each (init, config × 3, add, commit, branch, add, commit); now one shared repo and one fast-import per push, as in #3442.

**Result (Mac, git processes / seconds):** `e2e-reliability-check` 1,207 → 643 and 25.8 s → 16.2 s; `why-changed` 417 → 162 and 8.4 s → 3.9 s. Windows seconds come from the PR's own run.
