# Test folders by type, intent and scope

> **Verdict:** every test file in a folder `TESTS.md` maps; 3 PRs. Owner, 3 Nov 2026: "our tests are being spread randomly across the codebase", "a clear folder structure with: unit tests, integrations tests, e2e tests... guards", "easy to find each folder", "properly structured by type/intent/scope"; option "B: same names per home" (sketch https://claude.ai/artifact/C1Qxb2sAxggRxXUGXURTu1).

| PR | What | State |
|---|---|---|
| 1/3 | `TESTS.md`, the runners read the new folders (`tools/affected-tests.py` `python_tests`/`desktop_tests`), the guard `tests/guards/rules/test_test_folders.py` with a shrinking allowlist | this PR |
| 2/3 | `tests/`: the 449 flat files into `unit/<scope>`, `guards/<scope>`, `tooling/<scope>`, each placed by reading its header (the import-based classifier filed app tests as tooling); helpers stay beside the tests; references rewritten | merged #3110 |
| 3/3 | `desktop/test/`: the 1,010 flat files the same way (none launches a real browser: the 3 counted first read code or use a fake); `e2e-step-timings.test.mjs` and `e2e/test/fidelity-report.test.js` (run by no command) deleted (owner, 3 Nov 2026: "Delete both"); the allowlist goes | this PR |

Each move ships while few other PRs are open (a move conflicts with any open PR editing the same tests).

## Progress
- [x] 1/3 map, runners, guard (proof: tests/guards/rules/test_test_folders.py @fe19dbdf)
- [x] 2/3 Python tests moved (proof: tests/guards/data/test_store_env.py)
- [x] 3/3 desktop tests moved (proof: tests/guards/rules/test_test_folders.py)
