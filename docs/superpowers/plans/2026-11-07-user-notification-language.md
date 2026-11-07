# End-user Notification Localization Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for each isolated task. Run the failing-first named checks; preserve other workers' changes.

**Goal:** Localize end-user email templates and Telegram notifications in the seven desktop languages while owner/admin/CI messages stay English.
**Architecture:** Desktop preference is authoritative. Pass resolved locale explicitly through user producers and cache it for off-app delivery. Shared renderers default English and have no global active locale. Keep canonical logs and control identities separate from outbound copy.
**Tech Stack:** Existing JavaScript/Electron/Worker and Python runtimes; bundled catalogs, Intl plural rules for JavaScript and tested Python locale rules, fake transports.
**Spec:** docs/superpowers/specs/2026-11-07-user-notification-language-design.md (owner approved7Nov2026).

Delivery status is tracked only in the design’s `## Progress` checklist and its linked verification record. The steps below are the implementation sequence, not a second completion checklist.

## Global constraints
No live sends, owner data, new AI calls, runtime prose replacement, recipient/channel/consent/schedule changes or agent merges. Private service support lands first. Changes use isolated worktrees and the existing ship tool. Each worker fixes its review/CI/conflicts through exact-head READY.

## 1/7 Spec and audience inventory — coordinator
- Finish audited producer/template matrix and explicit operational exclusions.
- Add approved contract/cache-refresh policy and this PR list; ship documentation.

## 2/7 Service foundation — coordinator
- Write failing pure locale/format tests (seven languages, unsupported values, plural forms, interpolation and concurrent independent requests).
- Implement supported-locale normalization and catalog formatting without a global language.
- Add a derived account delivery-language cache through the existing service identity/persistence mechanisms; refresh before first welcome and on a later authenticated update.
- Default compose to English; explicitly pass end-user locale to all template components. Owner/admin previews and owner test sends force English regardless of payload values; the end-user Test action can localize.
- Fake-account/fake-email tests prove cache, fallback, audience and unchanged recipient/consent/limits/headers; ship service PR.

## 3/7 Email templates — email pane
- Localize all twelve template IDs, subjects, HTML/text, buttons, frame/footer and release labels with named interpolation and real plurals.
- Keep default English output and raw user/job/code/URL/prose values; no markup rewrite.
- Use isolated locale context; test all12×7, escaping/HTML language, provider/header invariants and English operational/test rendering.
- Produce fictional HTML/text examples and exact template/key coverage; integrate with foundation, review and ship.

## 4/7 Desktop/scheduled propagation — coordinator
- Write failing tests at notifyEnv/pipeline/GitHub/bot and locale-change/startup boundaries.
- Export JOBADABRA_NOTIFICATION_LANGUAGE from the resolved saved display choice, preserving channel/secret/off-row variables.
- Refresh service delivery cache and scheduled environment on the contract's normal events; failed refresh retains last acknowledgement and retries on the next event.
- Initial email registration carries current locale; no new wizard/settings step.
- Land public callers only once service accepts the metadata; PR review may run in parallel; keep offline/fake-network checks and no live writes.

## 5/7 Python runtime/digests — Python pane
- Add failing locale/plural tests and explicit display projection at send/deliver; calls without projection stay unchanged.
- Preserve English MESSAGES/markers/diagnostics while user Telegram/email fields receive localized copy.
- Localize digest framing/buttons without duplicate job/AI/store reads; callback IDs/ranking/raw values unchanged.
- Named fake-transport/digest tests across all7; ship.

## 6/7 Remaining Python producers — Python pane
- Extend explicit authored projections to daily commands, reminders/focus, mail/calendar, insights/weekly/rejection/scout and user credit/recovery/app-stopped messages.
- Keep generated/user content and CLI/operational diagnostics canonical; classify audience at actual callers.
- Test each bounded producer through actual callbacks, fake transport and stored-record invariants; ship.

## 7/7 Desktop user messages and bot — helper pane
- Localize waiting/application/few-jobs/user-test wrappers and bot HELP/buttons/command replies using the same effective locale.
- Preserve raw personal text, command/callback IDs, private-chat authorization and action ownership.
- Verify negative operational-English cases and full inventory coverage, render fictional examples, report remaining dynamic-prose fallbacks.
- Ship exact-head green/reviewed work and update shared progress report. Owner merges.
