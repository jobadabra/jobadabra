# A PR runs the tests of what it touched (short name ts)

Owner, 7 Nov 2026: "desktop unit tests still take crazily long" · "We should test only the touched parts" · chose "Touched only + fix the slow file".
Board draft: "PR unit tests: touched parts only (and the 110 s test file)". Main keeps running everything; a miss shows there and a red merge is reverted (the accepted trade).

## Design

**Why this area went round (4+ selection PRs in 7 days: #3153, #3256, #3302, #3208, #2971):** each added a case to `tools/affected-tests.py`; none stated what a test kind is picked by.

**States (kinds of file under `desktop/test`):** unit (946 files), guard (98), tooling (23).

**One owner:** `pick_node_area` for the desktop area in `tools/affected-tests.py`. One rule for every kind: a test is picked when what it imports, spawns, mentions or declares it reads includes a changed file.

**Measured causes (counts only, 7 Nov 2026, #3439 = 2 files under `desktop/e2e`, picked 341 desktop tests; #3434 348; #3431 673):**
1. `pick_node_area` picks every guard for any desktop change (`'/guards/' in rel(t)`) and any test flagged `scanner` (`scanner and scan_ok`, always true for desktop).
2. `scanner` is one boolean ("its text or an imported helper under scripts/tools/test/e2e matches `SCANNER_RE`"). `desktop/test/toast-scan.js` (152 importers), `activity-source.js` (25) and `main-source.js` (14) each read one named folder with `fs`, which the import graph cannot see, so 219 unit tests and 15 of 23 tooling tests count as whole-tree scanners.
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
- [x] 1/2 The slowest tooling test builds its git history in one process (59.9 s → 29.9 s on a Mac; same 30 assertions) (proof: desktop/test/tooling/ci/e2e-reliability-check.test.js)
- [ ] 2/2 Selection: declared reads, guards, Windows chunking, count check; proof on #3439, #3431 and a renderer-only PR (files picked, estimated seconds), positive controls (renderer/lib change, docs only, the helper itself)
