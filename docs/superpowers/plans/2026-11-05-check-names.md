# PR checks named by layer (5 Nov 2026)

The owner's questions on the PR checks: "why we have 2 checks? Cna't we group into one ?", "what is this check for? It is useful?", and "Can we name the integrations tests consistently and with the same prefix… To know what's unit, what's integration and so on". Then on the sketch: "Yes, rename + fold (Recommended)" and "Labels later, keep tooling (Recommended)". On the page-cases row: "This one is too long. Let's make it shorter".

## The scheme
A workflow's name is its layer, and the job says what it runs, so a row reads `Integration / page cases 1/3`.

| Layer | Workflows |
|---|---|
| Unit | `tests-python.yml`, `tests-desktop.yml`, `tests-desktop-windows.yml`, `tests-worker.yml` |
| Integration | `integration.yml`, `page-cases.yml` |
| Smoke | `smoke.yml` |
| E2E | `pr-e2e-steps.yml` |
| Guard | `pr-gate.yml` |
| Tooling | `harness.yml` |
| PR | `pr-labels.yml`, `pr-closed-cancel.yml` |
| AI fixer | `feedback-ai.yml` (the site's click), `feedback-ai-closed.yml` (a PR's close, 1 row) |

The required status "All checks passed" is unchanged.

## PRs
1. `[a8] 1/4` jobadabra: the names. The verdict counts runs per workflow id, since names repeat; the CI stats name a row by layer and file.
2. `[a8] 2/4` jobadabra-web: the site also trusts the close notice from `feedback-ai-closed.yml`.
3. `[a8] 3/4` jobadabra: the close notice moves to its own file, so a merged PR draws 1 AI fixer row instead of 7.
4. `[a8] 4/4` jobadabra: the Tooling check keeps only the harness tests that guard something or caught a product change in their reds (the owner's 3 Nov rule).

Waiting on the owner, not a PR yet: the 2 PR labels rows become 1 only after the owner's answer on Gitar after its trial.

## Progress
- [x] 1/4 names by layer (#3208) (proof: tests/tooling/ci/test_pr_verdict.py @89bdb07)
- [x] 2/4 the site trusts the close file (jobadabra-web#381) (proof: none: the test is in jobadabra-web, test/unit/admin/feedback-ai.test.js @3719418)
- [x] 3/4 the AI fixer draws 1 row (proof: desktop/test/tooling/ci/feedback-ai.test.js)
- [x] 3/4, second half, in jobadabra-web: merged and closed trusted only from `feedback-ai-closed.yml` (jobadabra-web#385) (proof: none: the test is in jobadabra-web, test/unit/admin/feedback-ai.test.js @51c7eb6)
- [x] 4/4a the Tooling check drops 10 tests that guard nothing (#3226; the 5 step-picker tests stay: rules G/G2 name them) (owner: "Yes, as sketched", sketch https://claude.ai/artifact/V4yZobhiRyQBX2rdEL4tVt) (proof: none: removes tests; the picker's harness tests pass)
- [x] 4/4b the 2 real-browser tests move to `desktop/integration/extension/`; every harness test that stays says what it guards (`Guard:` line; the 11 AI user agent tests have no first-line guard kind and are listed on the PR) (proof: desktop/integration/extension/applying-report.test.mjs)
- [ ] Drop the old names from `pr-verdict.yml` once no open PR runs them (12 Nov 2026)
