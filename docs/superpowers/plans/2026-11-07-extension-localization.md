# Extension localization implementation plan

**Goal:** Seven bundled display languages, following the desktop by default, with a persistent extension override.
**Architecture:** Explicit app-owned message keys and plain-text interpolation. Reuse trusted-origin pairing and authenticated review responses for the current effective desktop locale; keep only a rebuildable locale cache offline. Never translate employer DOM, applicant answers, AI output, or filling decisions.
**Spec:** Owner-approved `/tmp/jobadabra-ml/extension-brief.md`.
**Tier:** 1, named unit files and fictional options/popup preview. No dependencies, live accounts, live app, paid calls, manifest version, consent or submit changes.

## Ownership and inventory
First milestone: 4 existing UI files (`extension/options.html`, `options.js`, `popup.html`, `popup.js`); 1 connection module (`extension/flow.js`, display transport only); 2 desktop transport files (`desktop/lib/server-routes.js`, `extension-contract.js`); new `extension/i18n.js`, `extension/locales.js`, seven locale catalogs; named i18n/UI and route tests. Existing route characterization assertions follow additive locale fields. Plan and preview assets are also owned here.
Remaining app-authored UI inventory: 18 modules: `extension/account-act.js`, `extension/account-fill.js`, `extension/allow.js`, `extension/background-submit.js`, `extension/background.js`, `extension/linkedin.js`, `extension/next-step.js`, `extension/on-top.js`, `extension/panel-claude.js`, `extension/panel-form.js`, `extension/panel-learn.js`, `extension/panel-markup.js`, `extension/panel-report.js`, `extension/panel-review-view.js`, `extension/panel-written.js`, `extension/review.js`, `extension/stop.js`, `extension/visit-page.js`. Page-control modules that manipulate employer DOM are excluded; only app-authored badges/overlays will be audited for milestone 2. No whole-DOM replacement.

## PR sequence
1. `[ml-ext] 1/2 Add inherited language setting and translate extension options/popup`
2. `[ml-ext] 2/2 Translate app-authored extension panels and remaining UI`
No stacked PR before parent merges. Work on disjoint remaining inventory while waiting.

## Progress
- [x] Read brief, rules, map and desktop runtime; inventory first milestone (proof: this plan).
- [x] Add failing locale inheritance and catalog parity tests. (proof: desktop/test/unit/extension/extension-i18n.test.js; desktop/test/unit/extension/extension-localized-ui.test.js; desktop/test/unit/extension/extension-locale-transport.test.js).
- [x] Implement locale transport/cache, seven catalogs and explicit UI keys. (proof: desktop/test/unit/extension/extension-i18n.test.js; desktop/test/unit/extension/extension-localized-ui.test.js; desktop/test/unit/extension/extension-locale-transport.test.js).
- [x] Verify fallback, overrides, later desktop changes, locale formatting and untouched external text. (proof: desktop/test/unit/extension/extension-i18n.test.js; desktop/test/unit/extension/extension-localized-ui.test.js; desktop/test/unit/extension/extension-locale-transport.test.js).
- [ ] Show fictional options/popup preview to coordinator.
- [ ] Commit and ship milestone 1; fix required checks/review through exact-head READY.
- [ ] Milestone 2: audit and translate remaining app-owned panels after milestone 1.

## Checks
Run `node --test desktop/test/unit/extension/extension-i18n.test.js`, `extension-localized-ui.test.js`, `server-routes.test.js`, `extension-contract.test.js` individually. Run `python3 -m unittest tests.test_workflow_paths`. Inspect selected-locale options/popup with mocked Chrome APIs, blocked network and fictional read progress. Verify English default compatibility and native names/flags, all seven key/parameter parity, Russian/Romanian plurals. Use existing review polling for later desktop changes; opening popup/options refreshes too. Offline cache survives network errors; an answered older desktop missing locale resolves English.

Ruling: reuse review responses plus options focus refresh, with no new endpoint or timer. Existing managed-tab review polling refreshes the cache, and reopening popup or returning to options refreshes it as well.

Verification: 56 JS assertions across six named files and 19 workflow-path tests passed. The workflow test moved to `tests.tooling.ci.test_workflow_paths`; two newly loaded desktop i18n paths added to `page-cases.yml`. Existing e2e suites/lib do not consume the changed visible copy (checked explicit text consumers); static fallback HTML stays English. No files moved.
