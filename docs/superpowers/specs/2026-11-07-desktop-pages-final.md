# Remaining desktop page translation gaps

Owner authorization: supervisor assignment f06702f3, accepted final renderer audit. Scope is the confirmed gaps in `/tmp/jobadabra-ml/final-desktop-pages-audit.md`, with own PR and exact-head READY. Preview approval for #3507 does not authorize this PR.

## Design and ownership

Use explicit bundled display keys for known authored values. Profile part keys, preference field/side/option identities, report/review section identities and palette command identities select templates. Canonical document headings, regexes, option values, action IDs, cache/engine records and unknown/user/provider/AI content stay unchanged. No translated string becomes a control input. All seven languages: en/de/fr/it/es/ro/ru.

Reuse existing catalogs where they already express the same meaning; an isolated finalPages namespace owns missing templates and display readers. Do not rewrite arbitrary finished text or use translation services. The prior approved localization architecture already rules out global DOM or English-message substitution. Maintain existing components/layout/styles; translate at their input boundaries.

Owned: Profile known headings; Strategy preference fields/options/hints/empty+overflow/proposal labels; Interviews picker applied suffix; known Reports/review/Actions headings; renderer command palette labels/hints/groups; shared Notion gate button; affected tests and isolated catalogs. Coordinate nav.js/components.js overlap before editing. Excluded: Focus/Jobs (#3507 root), shared display-copy runtime, wizard/settings/native, extension, other pages and main-process behavior.

## Verification and publication

Tier 1: named logic/consumer tests plus focused fictional demo views. Failing-first tests retain canonical values, unknown raw values, interpolation and dispatch. Catalog keys/placeholders/plural categories align across seven languages. No live accounts, AI spending or sends. Open light/dark before-after previews, inspect them, and ask the owner through an actual decision prompt before publishing. Ship only after that answer, via tools/ship.sh; handle own CI/Gitar feedback through exact-head READY. Never merge.

## Progress

- [x] Confirm shared-file ownership and write the implementation plan. (proof: docs/superpowers/plans/2026-11-07-desktop-pages-final.md)
- [x] Add failing focused tests for the confirmed display leaks and invariants. (proof: desktop/test/unit/renderer/final-pages-copy.test.js)
- [x] Implement keyed readers and seven catalogs across the bounded page families. (proof: desktop/renderer/final-pages-copy.js)
- [x] Pass named tests, catalog/placeholder/plural and required changed-source checks. (proof: desktop/test/unit/renderer/final-pages-copy.test.js)
- [x] Render/open light and dark before-after previews and obtain owner approval. (proof: none: external owner approval via Coordinator27 message ebfc4f18 and explicit owner instruction; six opened comparisons published as PR evidence)
- [ ] Ship own PR, address CI/review feedback and report exact-head READY.
