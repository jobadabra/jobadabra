# Apply to jobs marked not eligible

## Problem

Automatic Apply pickers skip a kit whose explicit eligibility verdict is false. The owner wants one opt-in in Settings → Apply to include those jobs across Apply modes.

## Observable behavior

- `settings.apply.allowIneligible` defaults to `false` when absent and is shared by every Apply mode.
- Settings shows one switch labelled **Apply to jobs marked not eligible** with helper text: **Include jobs even when the application kit says you are not eligible.**
- With the setting off, automatic pickers continue to skip explicit `eligible: false` kits. With it on, they may select them.
- The setting only overrides an explicit false verdict. Unknown eligibility remains distinct and retains each path's existing behavior; the opt-in never turns unknown into true.
- Stage/startability checks, already-started deduplication, background page proof, and Full automation confirmation remain required.
- The setting changes picker selection and the existing Full automation kit-eligibility check. Submission authorization, mode confirmation, background page proof, and consent handling stay unchanged.

## Constraints and non-goals

- One persisted setting, no per-mode switches or extra confirmation.
- No automatic eligibility verdict changes or invented facts. Submission authorization and page-proof rules do not change.
- No bypass of stage state or existing-session protections.

## Acceptance checks

- Tests cover off/on behavior for the JS pickers, Full automation's pre-submit eligibility gate, and Python `ready_jobs` / `--next` selection.
- Tests distinguish explicit false from unknown eligibility.
- The Settings → Apply screen renders the switch and helper in demo mode, matching the existing consent switch row in light and dark.
- UI change remains uncommitted until the owner approves the rendered preview. Approval was received for this preview in the coordinator chat.

## Progress

- [x] Settings preview prepared and approved. (proof: none: owner approved the rendered eligibility preview in the coordinator chat on 7 November 2026)
- [x] Shared setting threaded through Apply pickers and the existing Full automation eligibility gate. (proof: desktop/test/unit/main/background-apply-store.test.js)
- [x] Focused tests and preflight review complete. (proof: desktop/test/unit/main/app-apply.test.js)
- [x] Saved-row `NOT_ELIGIBLE` opt-in regression fixed and verified red/green. (proof: tests/unit/ai/test_apply_batch.py)
