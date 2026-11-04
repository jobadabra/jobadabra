# Where tests live

> **One folder per kind of test.** The path says its type (unit, integration, e2e), its intent (a guard of a rule, a test of our own tooling) and its scope (the code it is about). A new test goes in the row that fits; `tests/guards/rules/test_test_folders.py` fails a test file anywhere else.
> Owner, 3 Nov 2026: "a clear folder structure with: unit tests, integrations tests, e2e tests... guards", "easy to find each folder", "properly structured by type/intent/scope".

## The folders

| Folder | What goes there | Run one file |
|---|---|---|
| `tests/unit/<scope>/` | Python unit tests of the engine; scope = the code: `engine` (src/*.py), `ai`, `notion`, `sources`, `stores` | `python3 -m unittest tests.unit.ai.test_x` |
| `tests/guards/<scope>/` | Python checks that a rule holds across the repo (reads code as text); scope = what it protects: `safety`, `data`, `money`, `privacy`, `release`, `rules` | `python3 -m unittest tests.guards.rules.test_x` |
| `tests/tooling/<scope>/` | Python tests of our own CI, PR and ship scripts; only with a `Guard:` line ([why](docs/rules/change-loop.md#tests-of-our-own-tooling-owner-3-nov-2026)); scope = the tool: `ci`, `ship`, `release`, `hooks` | `python3 -m unittest tests.tooling.ci.test_x` |
| `desktop/test/unit/<scope>/` | JavaScript unit tests; scope = the code: `main` (desktop/main.js, desktop/lib), `renderer`, `extension`, `cv`, `ready-fill` | `cd desktop && node --test test/unit/renderer/x.test.js` |
| `desktop/test/guards/<scope>/` | JavaScript rule guards; same scopes as `tests/guards/` | `cd desktop && node --test test/guards/safety/x.test.js` |
| `desktop/test/tooling/<scope>/` | JavaScript tests of our own tooling, with a `Guard:` line; same scopes as `tests/tooling/` | `cd desktop && node --test test/tooling/ci/x.test.js` |
| `app-core/test/` | Unit tests of app-core (the code the app runs beside the engine) | `cd app-core && node --test test/x.test.js` |
| `desktop/integration/<layer>/` | Integration: `store` (Node + real SQLite), `app` (the app with a fake browser), `extension` (recorded pages in a real browser) | `cd desktop && node --test integration/app/x.test.js` |
| `desktop/e2e/suites/` | E2E: the Tier 1 journeys only (`desktop/e2e/critical-journeys.json`); CI only | `E2E_STEPS="<step>" node suite.mjs <suite>` (CI) |
| `desktop/e2e/test/<area>/` | Tests of the e2e harness itself; area = `ai`, `app`, `filling`, `harness`, `pool`, `record`, `replay` | `cd desktop/e2e && node --test test/harness/x.test.mjs` |

Helpers and stand-ins (fakes, fixtures, cases) stay next to the tests that use them, never named like a test.

<details><summary>Moving in (3 Nov 2026)</summary>

- The Python tests moved on 3 Nov 2026 (test folders 2/3), the desktop tests the same day (3/3); no test file is left outside a folder above. Guards that read every desktop test list them with `desktop/test/test-files.js`.
- The suite's setup is two helpers, not tests: `tests/suite_ids.py` (fake Notion IDs) and `tests/suite_store_guard.py` (no store chosen between tests). Every folder's `__init__.py` loads them first, so `unittest discover`, `tools/py-shards.py` and one module alone all get them.
- The runners already find tests in every folder above: `tools/affected-tests.py` (`python_tests`, `desktop_tests`) is the one list `tools/py-shards.py`, `tools/app-tests.py` and the PR picker read; `npm test` runs `test/*.test.js` and `test/{unit,guards,tooling}/**/*.test.js`.
- The beta's app-only leg leaves out everything under `tooling/`.

</details>
