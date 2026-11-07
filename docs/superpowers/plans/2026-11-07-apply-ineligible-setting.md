# Configurable ineligible Apply Implementation Plan

> **For agentic workers:** Use this plan task-by-task in the current session.

**Goal:** Let a person opt into applying to jobs whose kit explicitly says they are not eligible.

**Architecture:** Persist one boolean at `settings.apply.allowIneligible`, default false. Thread it through renderer policy, desktop batch pickers and Full automation's store gate, then pass it to Python's automatic pickers. Keep stage, already-started, page-proof, and confirmation checks independent.

**Tech Stack:** Electron renderer, desktop JS modules, Python CLI, existing unit tests and demo screenshot tooling.

**Spec:** `docs/superpowers/specs/2026-11-07-apply-ineligible-setting-design.md`

## Global Constraints

- `eligible === false` is the only verdict this option overrides.
- Unknown eligibility is not converted to true.
- Do not alter answer drafting, legal consent, page proof, stage checks, deduplication, or submit confirmation.
- Commit only after the approved Settings preview; owner approval was reported in the coordinator chat.

## Review Focus

- An old settings object without the field defaults off: model and UI tests.
- A false verdict is skipped off and selected on: JS and Python picker tests.
- Unknown eligibility stays distinct: JS/background/Python tests.
- A started or disallowed-stage job stays blocked with the option on: apply and store tests.
- The batch re-read after drafting uses the same option: start-flow test.

---

### Task 1: Settings control and preview

**Files:** `desktop/renderer/apply-settings-model.js`, `desktop/renderer/pages/apply-settings.js`, `desktop/renderer/index.html`, focused renderer tests.

- [x] Add `allowIneligible: false` to Apply settings normalization and patch behavior. (proof: desktop/test/unit/main/app-apply.test.js)
- [x] Add the consent-style switch row with the approved label/helper copy and seven-locale screen catalog. (proof: desktop/test/unit/main/app-apply.test.js)
- [x] Add a focused default/persistence test and render Settings → Apply in light and dark demo mode; side-by-side preview opened in Preview and approved. (proof: none: owner approved the rendered eligibility preview in the coordinator chat on 7 November 2026)

### Task 2: Shared JS Apply policy

**Files:** `desktop/lib/apply.js`, `desktop/lib/apply-handlers.js`, `desktop/lib/background-apply-store.js`, focused apply/store tests.

- [x] Add explicit false opt-in while retaining independent stage and already-started guards. (proof: desktop/test/unit/main/background-apply-store.test.js)
- [x] Thread the setting through `pick`, `draftMissing`, post-draft reread, and Chrome, Background, and Claude batch selection. (proof: desktop/test/unit/main/app-apply.test.js)
- [x] Let Full automation pass its existing true-eligibility gate only for explicit false when opted in; unknown remains blocked and all other submit proof/confirmation remains enforced. (proof: desktop/test/unit/main/background-apply-store.test.js)
- [x] Add focused off/on, unknown, disallowed-stage, and reread tests; duplicate protection passes. (proof: desktop/test/unit/main/background-apply-store.test.js)

### Task 3: Python automatic pickers

**Files:** `desktop/lib/apply.js`, `src/ai/apply_batch.py`, `tools/apply-batch-claude.sh` only if needed for the app's `--next` caller, `tests/unit/ai/test_apply_batch.py`.

- [x] Pass the same setting as an explicit CLI flag from the app's Python `--next` call. (proof: tests/unit/ai/test_apply_batch.py)
- [x] Apply it to Python automatic `ready_jobs` and `--next` selection; opt-in also admits Saved rows proved kitted by the `NOT_ELIGIBLE` marker. (proof: tests/unit/ai/test_apply_batch.py)
- [x] Add focused off/on, unknown, and saved-marker regression tests; all touched Python and JS tests pass. (proof: tests/unit/ai/test_apply_batch.py)

## Progress

- [x] Preview prepared, opened in Preview, and approved. (proof: none: owner approved the rendered eligibility preview in the coordinator chat on 7 November 2026)
- [x] Shared setting implemented across the renderer, JS apply paths, background eligibility gate, and Python automatic pickers. (proof: tests/unit/ai/test_apply_batch.py)
- [x] Focused behavior, renderer, i18n, and Python tests pass. (proof: tests/unit/ai/test_apply_batch.py)
- [x] Saved-row opt-in gap closed with red/green proof. (proof: tests/unit/ai/test_apply_batch.py)
