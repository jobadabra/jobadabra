# Final desktop and extension localization coverage

7 November 2026. This record reconciles the final read-only producer-to-consumer audits with merged work and current ownership. It does not claim whole-app completion or a string-coverage percentage.

## Verified merged work

- Focus/Jobs producer-copy repair: [#3526](https://github.com/jobadabra/jobadabra/pull/3526), owner-merged at `5247f269967ff407fc22f85bd470e9d6c403cef8`. The watcher emitted READY on `3ca934d62e7deac794d2f8f9b3610531059b60bb`: every check green, Gitar Approved, zero open review threads and MERGEABLE/CLEAN. Includes real German card/dialog tests, seven-language catalogs, Windows fallback-zone regression and unchanged canonical control/raw values.
- End-user email/Telegram phase: all ten delivery/verification milestones complete. Final Python producers [#3499](https://github.com/jobadabra/jobadabra/pull/3499) and verification [#3505](https://github.com/jobadabra/jobadabra/pull/3505) are owner-merged. All twelve email templates support seven languages. Owner/admin/CI notifications remain English. See [notification verification](2026-11-07-user-notification-language-verification.md) for supplied-content limits and test evidence.

## Remaining authored display gaps

Source-audit snapshots: primary pages/extension `63ac25faa78d7038fbb5bf1e63221458b0ef1265`; settings/native `e3fbc289` with reported gap files unchanged from the earlier snapshot. Findings identify actual consumers rather than counting English source literals. The source names below identify those audited producers; later follow-up commits may move lines.

| Slice and owner | Confirmed display paths | Boundary to preserve |
|---|---|---|
| Primary pages — visible Sol-low pages pane | Profile known section titles (`experience-profile-model.js` → `pages/experience-profile.js`); Strategy field/side/option/placeholder labels, empty/overflow summaries and proposal labels (`preferences-model.js` → `pages/job-preferences.js`, `preferences-review.js`); applied suffix in interview picker (`interview-lists.js`); known report/review/Actions headings; palette labels/hints/groups (`pages/nav.js` → `palette.js`); shared Notion gate button | Canonical model keys, matching regexes, document headings, stored option values and action callbacks remain unchanged. Unknown custom/user/AI headings and prose stay raw. Keyed readers project fixed metadata at display time. |
| Extension — visible Sol-low extension pane | Site-reading banners and authored stop/refusal reasons (`visit.js` → `popup.js`); typed authored errors (`flow.js`, `ai-reply.js` → options/background/panel consumers); Chrome description metadata; 45 eligible bundled tip bodies | Keep existing pairing, inherited language/override precedence, diagnostic/control strings, read-stop decisions, form-filling and submission behavior. Never change manifest version. External/site/user/AI content stays raw. |
| Settings/wizard/native — visible Sol-low native pane | Updater steps (`updater.js` → `app-updates.js` → `pages/update.js`); native resume task names; startup notification-permission/AI-key/retry wrappers; API-key prerequisite label; notification saved-channel labels; data reset readiness/skipped copy; logs today/number formatting; SQLite local-store label; wizard rebuild/review framing; live wizard drafting/save progress wrappers | Keep installer commands/timing, task IDs, persistence and stream/cache values, consent/channel payloads, typed RESET safety, raw logs/provider errors and supplied content unchanged. Resolve authored framing only at the established presentation/IPC boundary. |

**Tip exposure correction:** `extension/review.js` has `SHOW_TIPS=false`. The 45 bundled tip bodies are latent coverage, not visible on ordinary panels. The follow-up translates them without enabling the feature; screenshots that force them visible are labelled preview-only. The initial extension audit's normal-path characterization of these tips was incorrect and is corrected in the Notion evidence record.

## Current delivery state and decisions

Each pane owns a new isolated worktree, all seven locale catalogs, meaningful raw/control invariants, targeted checks, concrete previews, its own PR and CI/review to exact-head READY. No pane edits another slice's files; pages owns palette/nav and the shared component gate button, settings owns startup/wizard/native/update.

- `ml-extension-final-copy`: implementation/checks and concrete German light/dark previews prepared. The owner explicitly said “I approve” for these previews; Coordinator27 independently relayed the same approval. Publication is authorized; the worker owns shipping and exact-head readiness. Tips stay disabled by default.
- `ml-desktop-pages-final`: implementation and verification in progress. Its concrete preview decision is separate from the extension approval.
- `ml-desktop-settings-native-final`: implementation and verification in progress. Its concrete preview decision is separate from the extension approval.

Completion requires the remaining scoped fixes, reviewed previews, green/approved PRs without open comments and final integrated checks. A catalog's identical key set does not prove every producer/consumer uses it. Owner merges every PR manually. No live application submission, paid translation calls, real message sends or owner-data mutation is part of these checks.

## Progress reporting

The [original desktop checklist](2026-11-07-desktop-multilanguage-design.md#progress) remains the overall milestone source: 6/10 currently ticked after the audit reopened full extension migration. This measures deliverable completion, not translated screens/strings. The [Focus/Jobs repair checklist](2026-11-07-focus-language-3507.md#progress) is complete; the [notification checklist](2026-11-07-user-notification-language-design.md#progress) is complete. Pane-specific follow-up specs track their own implementation work.

Findings and progress are also saved in the owner-requested [Notion record](https://app.notion.com/p/41162be8fd8681f9a8e8ce827978f676), including 32 audit-evidence blocks and the tip-exposure correction, read-back verified on 7 November 2026.
