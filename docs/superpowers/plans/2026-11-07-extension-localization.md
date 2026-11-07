# Extension localization implementation plan

**Goal:** Seven bundled display languages, following the desktop by default, with a persistent extension override.
**Architecture:** Explicit app-owned message keys and plain-text interpolation. Reuse trusted-origin pairing and authenticated review responses for the current effective desktop locale; keep only a rebuildable locale cache offline. Never translate employer DOM, applicant answers, AI output, or filling decisions.
**Spec:** [Owner-approved extension localization design](../specs/2026-11-07-extension-localization.md), committed here for reviewers and future agents.
**Tier:** 1, named unit files and fictional options/popup preview. No dependencies, live accounts, live app, paid calls, manifest version, consent or submit changes.

## Ownership and inventory
First milestone: 4 existing UI files (`extension/options.html`, `options.js`, `popup.html`, `popup.js`); 1 connection module (`extension/flow.js`, display transport only); 2 desktop transport files (`desktop/lib/server-routes.js`, `extension-contract.js`); new `extension/i18n.js`, `extension/locales.js`, seven locale catalogs; named i18n/UI and route tests. Existing route characterization assertions follow additive locale fields. Plan and four fictional PNGs in `docs/previews/ml-extension/` are also owned here. Total milestone inventory: 28 files (24 implementation/spec/plan/test files + four preview images).
Remaining app-authored UI inventory: 21 modules: `extension/account-act.js`, `extension/account-fill.js`, `extension/allow.js`, `extension/background-submit.js`, `extension/background.js`, `extension/linkedin.js`, `extension/next-step.js`, `extension/on-top.js`, `extension/panel-claude.js`, `extension/panel-form.js`, `extension/panel-learn.js`, `extension/panel-markup.js`, `extension/panel-report.js`, `extension/panel-review-view.js`, `extension/panel-written.js`, `extension/review.js`, `extension/stop.js`, `extension/visit-page.js`, `extension/letter-notice.js`, `extension/panel-overlay.js`, `extension/panel-overlay-fx.js`. Page-control modules that manipulate employer DOM are excluded; only app-authored badges/overlays will be audited for milestone 2. No whole-DOM replacement.

## PR sequence
1. `[ml-ext] 1/2 Add inherited language setting and translate extension options/popup`
2. `[ml-ext] 2/2 Translate app-authored extension panels and remaining UI`
No stacked PR before parent merges. Work on disjoint remaining inventory while waiting.

## Progress
- [x] Read brief, rules, map and desktop runtime; inventory first milestone (proof: docs/superpowers/plans/2026-11-07-extension-localization.md).
- [x] Add failing locale inheritance and catalog parity tests. (proof: desktop/test/unit/extension/extension-i18n.test.js).
- [x] Implement locale transport/cache, seven catalogs and explicit UI keys. (proof: desktop/test/unit/extension/extension-i18n.test.js).
- [x] Verify fallback, overrides, later desktop changes, locale formatting and untouched external text. (proof: desktop/test/unit/extension/extension-i18n.test.js).
- [x] Send fictional options/popup preview to coordinator (proof: docs/previews/ml-extension/options-ru.png).
- [ ] Commit and ship milestone 1; fix required checks/review through exact-head READY.
- [ ] Milestone 2: audit and translate remaining app-owned panels after milestone 1.

## Checks
Run `node --test desktop/test/unit/extension/extension-i18n.test.js`, `extension-localized-ui.test.js`, `server-routes.test.js`, `extension-contract.test.js` individually. Run `python3 -m unittest tests.tooling.ci.test_workflow_paths`. Inspect selected-locale options/popup with mocked Chrome APIs, blocked network and fictional read progress. Verify English default compatibility and native names/flags, all seven key/parameter parity, Russian/Romanian plurals. Use existing review polling for later desktop changes; opening popup/options refreshes too. Offline cache survives network errors; an answered older desktop missing locale resolves English.

Ruling: reuse review responses plus options focus refresh, with no new endpoint or timer. Existing managed-tab review polling refreshes the cache, and reopening popup or returning to options refreshes it as well.

Verification uses the named locale, UI, transport, route, contract, popup-control and site-permission files; CI evidence is recorded on [PR #3426](https://github.com/jobadabra/jobadabra/pull/3426/checks). The workflow test moved to `tests.tooling.ci.test_workflow_paths`; two newly loaded desktop i18n paths added to `page-cases.yml`. Existing e2e suites/lib do not consume the changed visible copy (checked explicit text consumers); static fallback HTML stays English. No files moved.

Preview delivery: coordinator acknowledged ownership; preview paths and before/after pairs sent via cmux agent inbox. Inbox messages remained queued while the coordinator had a draft prompt; never submitted or overwrote that draft. Four fictional previews are bundled. On retry, the coordinator explicitly authorized the standard publisher with TMPDIR inside the worktree; the PR uses its exact published pr-assets-ml-extension tag URLs.

Review follow-up: portable approved design committed under specs; desktop locale/name parity guards the separately bundled extension catalog. The existing site-permission source check now follows the explicit message key and asserts its English catalog content.
