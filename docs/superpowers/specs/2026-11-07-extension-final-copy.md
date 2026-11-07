# Extension final display-copy coverage

Approved implementation scope: Supervisor assignment 869f9723, following accepted final extension audit. Owner preview approval remains required before publishing.

## Design

Localize remaining extension-authored display copy in en/de/fr/it/es/ro/ru. Preserve existing UI/layout and desktop inheritance/override behavior. Read progress and stop/refusal messages carry explicit display keys/values alongside unchanged canonical strings used by diagnostics, protocol and matching logic. Resolve tips by stable ID and retain the selected ID across locale redraw. Authored errors carry typed metadata; unknown/external reasons stay byte-for-byte raw. Chrome-native `_locales` supplies the manifest description; version stamping is untouched.

Approach: extend trusted bundled messages and render seams. Rejected alternatives: translating stored/control strings would break reason matching; heuristic string translation would alter external data. No desktop/shared runtime edits, AI calls, live filling, navigation/consent/submit changes, or new dependencies.

Ownership: extension display helpers/catalogs, visit.js/popup.js/messages-learning.js for read display metadata, messages-panel.js/review.js for tips, flow.js/ai-reply.js and existing error display consumers, manifest/_locales, named desktop/test/unit/extension regressions only; this spec and plan.

## Progress

### 1. Isolation

- [x] Read accepted audit, confirm scope and create isolated worktree (proof: extension/read-display.js).

### 2. Regression evidence

- [x] Add failing typed-boundary/raw-value and actual callback regressions (proof: desktop/test/unit/extension/final-display-copy.test.js).

### 3. Seven-language display copy

- [x] Implement read display, 45 tip bodies, authored errors, Chrome metadata in seven locales (proof: extension/locales/de.js).

### 4. Named verification

- [x] Pass named regressions and affected checks (proof: desktop/test/unit/extension/final-display-copy.test.js).

### 5. Owner preview approval

- [ ] Render and inspect light/dark before-after previews; obtain actual owner approval.

### 6. Shipping and exact-head review

- [ ] Commit and ship through tools/ship.sh; inspect exact-head CI/Gitar/threads to READY.


## Exposure correction

`review.js` keeps `SHOW_TIPS=false` from the prior owner decision. The45 tips are a latent coverage gap, not currently shown by default. Their localization is explicitly authorized; previews force the existing tip visible only for review. The flag remains untouched.

## Acceptance

All new keys/parameters/plural branches have seven-language parity. Real display callbacks show selected-locale authored copy and preserve external values including braces/HTML-like text. Canonical read reasons and diagnostics remain unchanged. Locale switches redraw selected tips without selecting another or resetting seen history. Pending/rejected storage retains current nonblocking fallback. Preview uses fictional stand-ins only.

Verification evidence: original tellStep callback assertion fails (English/untyped rendering); patched actual callback preserves the protocol words and renders German. Named locale, callback, panel injection, permission/storage, report, read-board and plain-error regressions pass. Light/dark before-after previews opened; owner publishing decision pending.
