# Extension panels localization implementation plan

**Goal:** Finish milestone 2 of the approved seven-language extension UI.
**Spec:** [Approved extension localization design](../specs/2026-11-07-extension-localization.md).
**Tier:** 1, named tests plus fictional mocked panel/permission previews. No live app, accounts, AI calls, form fills or submissions.

## Architecture and invariants
Reuse milestone 1 catalogs, stored preference, effective desktop cache and Intl formatting. Inject one classic shared message formatter and a display bootstrap before panel helpers. The bootstrap asks the existing extension worker message router for only the effective locale and trusted bundled message dictionaries, then redraws only extension-owned shadow roots when language changes. No new HTTP endpoint, host permission, web-accessible resource, account data or DOM translation.
Keep raw application status, action IDs, worker step tokens and AI/employer/applicant content unchanged. Fixed app-authored step words are localized only at their display seam; no judgments depend on translated copy. All interpolated text uses textContent or existing escaping at HTML boundaries. No legal, consent, submit or filling decisions change.

## Ownership and inventory
Runtime/transport: `extension/i18n.js`, new `i18n-format.js`, new `panel-i18n.js`, new `display-cache.js`, `messages-panel.js`, `panel-files.js`; seven existing `locales/*.js` catalogs.
Panel presentation: `panel-markup.js`, `panel-review-view.js`, `panel-written.js`, `panel-report.js`, `panel-claude.js`, `panel-learn.js`, `letter-notice.js`, `review.js`.
Remaining extension controls: `allow.html/js`, `linkedin.html/js`, `stop.js`, display-only portions of `background.js`, `site-allow.js`, `visit.js`, `fill-tab-inputs.js` and the existing app-authored tooltip in `page/fill-marks.js`. `visit-page.js` will be audited for app-owned UI separately from employer readers. No `account-act`, `account-fill`, `background-submit`, `next-step`, `on-top`, `panel-form`, `panel-overlay`, or `panel-overlay-fx` decision/DOM logic changes; audited files without literal app-owned copy remain unchanged.
Final product inventory: 28 existing extension files + 3 new display helpers (31). Six test/fixture files, two plans and the apply map are additional: 40 files total. No binary previews are committed. Tests and this plan are additional.

## Progress
- [x] Verify milestone 1 merged and create isolated ml-extension-panels branch (proof: none: merged PR #3426, coordinator acknowledged branch).
- [x] Add shared formatter and classic bootstrap tests, preserving English and external text. (proof: desktop/test/unit/extension/panel-i18n.test.js).
- [x] Translate fixed panel markup and state/action messages in seven catalogs. (proof: extension/locales/ru.js).
- [x] Translate written review, cover letter, report privacy UI and remaining permission controls. (proof: extension/panel-report.js).
- [x] Verify language switches, plural categories, unchanged employer/applicant values and action payloads. (proof: desktop/test/unit/extension/panel-i18n.test.js).
- [x] Show fictional before/after previews; run only named tests and affected lint. (proof: none: fictional previews published under pr-assets-ml-extension-panels and sent to coordinator).
- [ ] Ship [ml-ext] 2/2, resolve review/checks, watch exact-head READY and owner merge.

## PR sequence
1. `[ml-ext] 1/2 Add inherited language setting and translate extension options/popup` — merged #3426, 317c337.
2. `[ml-ext] 2/2 Translate app-authored extension panels and remaining UI` — this branch.

## Validation budget
At most twelve named files locally, each under a minute: the new panel localization tests, existing extension-i18n, panel-claude, written-draft, report-failures, report-panel, panel-click-through, extension-panel-notes, extension-stop, extension-permissions and app-core panel-files tests as reached. Tests that only read moved English fallback strings keep their behavior assertion and follow the explicit key/catalog. No whole suites or local e2e. Publish only fictional previews via the standard publisher with TMPDIR inside this worktree (explicit coordinator authorization).

## Verification record
Twelve named JS files passed: panel-i18n, extension-i18n, panel-claude, report-failures, report-panel, panel-click-through, extension-panel-notes, extension-stop, extension-permissions, app-core panel-files, journeys and extension-site-allow. The required workflow-path file passed separately. These are local named checks; the PR checks are the authoritative CI evidence. No suites or live app ran locally.

Mocked previews exercised Russian panels, report preview and privacy copy, a Russian-to-Romanian live switch, Romanian written-answer review, German permission pages and Russian denied statuses. Employer wording, AI output, candidate values and the report note remained literal. The report regression also proves a language switch does not repeat prepare/upload or replace a disabled Send button.

The shared formatter moved out of i18n.js without moving its exported API. Tests naming the old module: extension-i18n, extension-localized-ui and extension-site-allow are okay as is (imports/API remain); the journey cover-letter fixture and report-failures fixture now load the required classic bootstrap; both fixed. No decision code moved.
