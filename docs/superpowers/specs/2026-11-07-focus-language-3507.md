# Focus and Jobs producer-copy localization — #3507

German persona replay 42388528265 found English producer copy on Focus and Jobs. The repair covers the producer/renderer boundary, rather than replacing the reported sentences after rendering. Existing components and layout remain unchanged.

## Inventory and scope

| Producer | Authored display fields | Values that stay canonical/raw |
|---|---|---|
| `src/focus_items.py` | Every kind's headline, badge, meta, relative time and summary | Kind, priority, tone, company, role, contact, salary/location and unknown user content |
| `src/focus.py` | Item title/detail/link label and known history framing | Stored events, raw notes/feedback/AI text, URLs, IDs, stage/action decisions |
| `src/focus_state.py` | Prep explanations, missing-detail labels, questions and follow-up framing | Prep state/why enums, source markers, raw subject and user next step |
| `src/notion/funnel.py` | Outbound/inbound step names, advice and improvement summary | Step identities used by AI/Notion/license/onboarding, counts, benchmarks and URL sets |
| `src/suggestions*.py` and their Focus/Jobs pool | Fixed title/detail/evidence/action/source framing | Suggestion key/kind/topic, action.do/value, answers and generated insight content |
| `desktop/lib/letter-availability.js` | Seven reason variants, labels and setup framing | Readiness/precedence, text/PDF bytes, target/action identifiers and stored approval |
| Focus/Jobs main-process result producers | Known app-owned failure/fallback framing | Raw provider diagnostics and records |

`Board` is also the German word and is not changed. Raw user/employer/AI text is not classified by matching its English contents.

## Shared boundary

Python captures trusted authored templates as canonical strings with display recipes. Only the explicit Focus/Jobs JSON boundary serializes `displayCopy` recipes beside canonical fields. This is a deliberate public UI response schema, separate from private diagnostic metadata in `display-values.js`.

The renderer resolves only `focusCards.*` recipe keys through the existing localizer at paint time. Recipes carry raw interpolation values and can represent joined/list fields. Actions and persistence continue using the original canonical objects; renderers read individual display fields. Cached recipes are language-independent and therefore follow a later language switch without rewriting records.

Main-process UI producers use the same recipe shape. Unknown keys/untagged values retain their canonical fallback. English-looking user values remain unchanged. No ambient engine locale, global string replacement, new AI call or data migration is introduced.

## Verification

Keep the existing focused Focus/store/funnel/letter/renderer tests. Add a regression through real engine/main producers and actual card renderers in German, covering the reported strings and their sibling branches. Assert canonical fields, filter/action identities and raw values remain unchanged. Render Focus and Jobs in light/dark with fictional data; retain before/after previews for owner review. Ship one PR with `Fixes #3507`, and handle its review/CI through exact-head READY.

## Progress
### 1. Focus and Jobs producer localization
- [x] Audit producer and consumer bypasses and record raw/control exclusions. (proof: docs/superpowers/specs/2026-11-07-focus-language-3507.md)
- [x] Route authored producer fields through portable copy recipes and all seven catalogs. (proof: desktop/test/unit/renderer/focus-catalogs.test.js)
- [x] Render real cards in German with no uncataloged authored English; retain control/raw invariants. (proof: desktop/test/unit/renderer/focus-language-contract.test.js)
- [x] Review before/after previews and complete the required owner UI decision. (proof: none: German light/dark before-after previews opened; owner replied "I approve" on 7 Nov 2026)
- [ ] Publish one reviewed, green PR and report exact-head READY.

### Check evidence

Root integration: 43 named desktop tests pass (real engine/main German card rendering, preparation dialog, seven catalogs × 291 keys, six count values, raw interpolation/cached locale switching, existing letter/consumer guards). 98 named Python Focus/funnel/store/history/preparation/recipe tests pass. Worker checks additionally cover authored suggestions and workflow paths. A fresh read-only review found the prep dialog and pay-filter heading still reading canonical values; both consumers now resolve presentation fields while retaining original action objects. Before/after German demo screenshots cover Focus and Jobs; owner approved publication after reviewing the opened German light/dark previews on 7 Nov 2026. No live stores, AI calls or message delivery were used.

### PR review and CI repair

PR #3526 review identified the Windows fixed-offset fallback zone name being sent to Intl. New failing-first Python and renderer tests reproduced the invalid-zone path; producer recipes now include only an IANA key (fixed-offset ISO retained), and invalid formatter inputs retain canonical fallback copy. CI source guards were updated for the extracted More-action builder and localized button reader. The insight action contract now asserts the exact deliberate display recipe alongside unchanged canonical fields. The existing no-price UI guard found an inherited estimate: removed it from the producer and all seven catalogs, retaining the stale-kit explanation and earlier-kit retention warning; focused tests assert no price. Repair checks: 19 named desktop tests and 67 named Python tests pass; the actual German card/dialog regression also passes.
