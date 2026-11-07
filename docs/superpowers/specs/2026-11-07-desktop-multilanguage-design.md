# Desktop multi-language

Status: approved by the owner on 7 November 2026. Latest UX clarification: start in English; flagged dropdown in a full-row card directly below the Welcome card; no additional wizard step; later switch in Settings → Overview. Source: https://trello.com/c/FYPQEB0i and the owner's 7 November request. Desktop remains the first delivery phase. Owner expanded the scope on 7 November to include extension UI, with an inherited Language setting in extension options.

## Intent

Let people use the complete Jobadabra desktop interface in English, German, French, Italian, Spanish, Romanian, or Russian. The owner prioritizes desktop over future email, website, and store-listing translations. The coordinator owns the backbone and integration; a visible Codex worker handles disjoint screen migration tasks. Workers use the owner's local Codex subscription, not a translation API.

## Current structure

- `desktop/renderer/index.html` contains the setup wizard, navigation, page sections, dialogs, and Settings markup.
- `desktop/renderer/app.js` initializes page modules. `pages/shared.js` obtains startup settings through `window.pilot.state()`.
- Text is embedded throughout renderer modules, including components, tooltips, placeholders, accessible names, empty states, errors, and the command palette.
- `desktop/renderer/os.js` is platform wording substitution, not language localization. It currently watches text added to the DOM on Windows.
- `desktop/lib/app-menu.js`, notification helpers, and dialog callers contain app-authored native text.
- Display settings such as theme already live in this installation's settings. The language choice follows that pattern; it does not duplicate profile or application data.
- `desktop/package.json` currently packages only English Electron locales.

## Audit evidence

The independent visible worker measured 1,306 static letter-bearing text occurrences (1,063 distinct), 238 text attributes, and 38 dialogs in the 2,651-line HTML entrypoint. Renderer JavaScript has 460 files; 4,116 lines in 321 files are heuristic rendering candidates, not a count of translation keys. There are 34 native dialog/picker/notification call sites in 21 files and 95 locale-format calls across renderer and main helpers. At least 136 test files reference index.html. The coordinator checked the currently open PR list and found no overlapping localization PR.

The worker's design review identified packaging inclusion, HTML ownership, early module initialization, and the Windows observer as material risks. The decisions below resolve those implementation questions.

## Goals and completion criteria

1. All seven languages are available through a flagged dropdown in a full-row card directly below the existing Welcome card and in Settings → Overview, identified by their native names. No extra wizard step is added.
2. A fresh install starts in English. The person can switch using the Welcome dropdown; an optional System default choice resolves the operating system’s supported preference with English fallback. A saved explicit choice wins. Regional tags such as de-CH resolve to a supported base language.
3. The choice survives app restarts. Language switching respects the existing unsaved-change protection; it must not silently discard a Profile or Strategy draft.
4. App-owned desktop chrome is translated: setup, navigation, every page and drawer, ordinary dialogs, command palette, labels, statuses, empty/loading/error messages, placeholders, tooltips, accessibility names, and app-authored native menu/dialog/notification text.
5. Dates, numbers, relative times, and plural forms follow the selected display language. Currency amounts retain their original currency and meaning; time zones retain their existing semantics.
6. English remains the source/fallback catalog, and existing English behavior remains available for tests and users.
7. Catalog keys, interpolation parameters, and plural forms are validated, with representative rendered states checked for overflow and Cyrillic glyphs.
8. A coverage inventory explicitly accounts for all app-owned string surfaces. The task is not complete when only the language selector or main navigation is translated.

## Non-goals and boundaries

Emails, Telegram, the website, store listings, and external web pages are outside this change. Extension UI is an authorized follow-up after the desktop work, as specified below. Do not change the application form filling engine, submission policy, store schemas, scoring, or search language preferences.

Do not translate or rewrite personal data, CV contents, job postings/titles, employer names, URLs, saved answers, generated application documents, raw technical logs, or third-party error details. Translate the app's surrounding explanation instead. The display language is separate from the language used to draft applications. Generated analysis prose retains its existing behavior in this phase; translating or regenerating stored AI output is a separate product decision.

## Approaches

**Selected proposal: explicit message keys and bundled catalogs.** A small shared module supports both renderer and main process. Screens opt in to translating app-owned text; no network, model, account, or additional runtime dependency is needed. This provides deterministic fallback and avoids changing user data.

**Rejected: translate all DOM text by matching English.** This would also encounter user content, break on interpolation, obscure missing coverage, and conflict with the existing platform observer.

**Rejected: translate at runtime with AI or a service.** This adds latency, cost, privacy concerns, and online dependency to ordinary screen rendering.

The owner approved this implementation direction on 7 November 2026.

## Backbone

### Shared messages

Use `desktop/i18n/` for a dependency-free module and catalog namespaces usable by Electron main and browser modules. Catalogs are ordinary JavaScript data modules, so browser and Node loading use the same source without introducing a bundler or network fetch.

- `t(key, variables)` resolves an explicit key in the active locale, then English. Missing keys produce a stable diagnostic in development and do not blank the screen.
- Named interpolation inserts text, never executable HTML. Untrusted interpolated values remain text nodes or pass through the existing escaping function at an existing HTML construction boundary.
- Counted messages use `Intl.PluralRules`; Russian and Romanian must not be reduced to English singular/plural rules. Each message supplies the category forms required by its locale.
- Formatting helpers use explicit selected locales through `Intl.DateTimeFormat`, `Intl.NumberFormat`, and `Intl.RelativeTimeFormat` where their output fits the UI.
- Split catalogs by functional namespace and keep files below the repository's size limit. Internal enum/status/IPC identifiers remain stable and untranslated.

### Startup and language choice

Add a small renderer bootstrap module: resolve and set the display locale, then dynamically import app.js. This happens before importing page modules, so their module-level messages cannot capture an uninitialized default. Reload after a successful language change rather than maintaining a second runtime repaint lifecycle. Save a validated display preference using the existing local display-settings path. A narrow IPC handler exposes locale information and validates selection against the seven supported languages; no profile or Notion migration is needed.

Add an existing-style select menu to Settings → Overview and a full-row language card directly below the existing Welcome card, with flags and native language names in its dropdown. Keep the four existing wizard steps and the current Start action. The language card is a sibling of the Welcome card, outside its full-card Start button overlay. Include System default and the seven native language names. Expose the action through the existing command palette. Set the document's `lang` attribute.

A switch checks the existing save-bar anyUnsaved() registry first. When edits exist, keep both the saved and active language unchanged, restore the selector, and ask the person to save or discard their edits using the existing save bar. Do not auto-discard drafts. With no drafts, persist the validated choice; only on success update native locale and reload the renderer. Explain beside the selector that changing language reloads the view. A failed write retains the prior selection. The existing beforeunload guard stays in place. Running background jobs stay in the main process and are not restarted by a renderer reload.

### Static and dynamic renderer text

Annotate app-authored HTML with explicit `data-i18n` keys and narrowly scoped attribute keys. Preserve nested icons and markup; translating a parent must not erase child controls or listeners. Dynamic renderer text calls `t()` before interpolation. No global monkey-patching of DOM setters or heuristic translation of arbitrary values.

Replace the arbitrary Windows text observer with explicit platform-aware localized messages at app-owned string boundaries. Never observe or rewrite user content. Internal helper compatibility is retained only for callers that still need it during migration; all their call sites are accounted for before declaring completion. The English fallback continues to preserve existing Mac/Windows behavior.

### Native desktop surfaces

Use the same catalog module for app-owned menu labels, notifications, native confirmation text, and picker titles. Retain Electron role names, accelerators, button ordering, defaultId/cancelId, and callback behavior. Add i18n/** to build.files and ship all supported Electron locale packs. Electron/OS-owned control text may follow the process/OS locale and require the next app launch; app-owned labels follow the chosen language. Do not promise that third-party native controls can hot-switch independently of the OS. Third-party sign-in pages and operating-system permission panels remain controlled by their provider or OS.

## Delivery and ownership

Use one branch/worktree per pull request and the project's ship script. Only the owner merges.

0. **[ml] 1/6 Desktop localization specification and plan** — coordinator: this design, audit evidence, implementation plan, and links to the requested Notion progress record.
1. **[ml] 2/6 Desktop language foundation and selector** — coordinator: shared i18n runtime, startup/settings/IPC wiring, selectors, core formatting, packaging, and focused unit tests. Establish and publish the exact worker API and namespaces before screen migration.
2. **[ml] 3/6 Translate desktop static screens in seven languages** — first Sol-low worker: HTML annotations and static screen catalog namespaces. This PR depends on the foundation. It must not alter backbone code or behavior. The migration may be divided into explicit sequential commits within this PR, never declared finished with known untranslated app-owned screens.
3. **[ml] 4/6 Translate dynamic desktop pages in seven languages** — second Sol-low worker: renderer/pages except coordinator-owned startup, core, shared, nav and language modules, plus page catalogs and their registration.
4. **[ml] 5/6 Translate desktop helpers and drawers in seven languages** — third Sol-low worker: top-level renderer helpers and job-drawer modules, plus helper catalogs and their registration.
5. **[ml] 6/6 Translate native desktop text and verify coverage** — coordinator: app-authored menus/dialogs/notifications, remaining locale formatting, cross-screen coverage, and final integration checks. Can proceed in parallel with screen migration once the foundation is stable because file ownership is disjoint.

Ownership: the coordinator owns bootstrap/app.js, pages/shared.js, pages/core.js, os.js, i18n runtime and common/formatting/native namespaces, IPC, packaging, and native lib files. The coordinator mounts selector markup in pages/language.js in the foundation PR; the only foundation edit to index.html is the bootstrap script entrypoint. After that foundation is available, the worker alone owns index.html and renderer page/drawer/component migration, including screen catalog namespaces; it does not edit the coordinator-owned files. Screen-specific date/number calls belong to the worker; shared formatter runtime belongs to the coordinator. Before worker implementation, publish exact exports and namespace conventions in the brief. Shared dependencies wait for foundation PR rather than colliding on a file. Do not ask workers to maintain conflicting copies of the runtime or catalogs. A worker owns and ships its own PR; the coordinator reviews and sends corrections back.

## Extension follow-up (owner scope update, 7 November 2026)

The Chrome extension must support the same seven display languages, including its options/settings, popup and app-authored panel text. Desktop stays the priority. Preserve employer pages, form labels, applicant answers, generated documents, raw technical errors and all form-filling/submission behavior.

Add a Language setting to extension options. The coordinator's implementation choice is a default **Follow desktop app** option plus the seven explicit language overrides with native names and flags. A desktop preference change updates the effective extension language while following; an explicit override remains unchanged. This preference changes UI display only, never application answer language.

Use the existing authenticated desktop connection to convey the effective display locale; validate supported locales. Retain only the last known effective locale as a rebuildable cache for disconnected UI, falling back to English for an unpaired install. Do not expose other desktop settings or add a separate data sync. Never invent a new network endpoint until the existing pairing/state response has been audited. Extension UI must remain usable with older desktop versions that omit the locale.

Deliver through a separate follow-up PR after the original six desktop PRs, with a file-level inventory and focused tests for inherited locale changes, explicit override, missing/invalid desktop locale, disconnected fallback, catalog parity, and preservation of user/employer content. Render options and a representative extension panel with fictional data before declaring complete. Do not change extension/manifest.json version; the build stamps it.

## Verification

Tier 1 for display localization. Run named unit tests for resolution/fallback, interpolation, Russian/Romanian plurals, formatting, persistence/validation, startup selection, and modified native menu/dialog behavior. Test user-provided strings are preserved. Keep English compatibility assertions and add locale cases; do not weaken old behavior checks to make translations pass.

Use fictional demo data for representative first-run, Settings, Jobs/drawer, Profile/Strategy, and session states. Render one representative changed state per PR in light and dark and inspect the longest translation plus Russian text. Build the required before/after preview and obtain the owner's visual approval before shipping a UI PR. Heavy suites remain on CI. Never touch the owner's running app, credentials, private data, or paid AI.

## Progress

Live findings/progress/report: [Notion record](https://app.notion.com/p/41162be8fd8681f9a8e8ce827978f676).
Spec PR: [#3360](https://github.com/jobadabra/jobadabra/pull/3360).

### 1. Scope and design

- [x] Confirm desktop-only scope and seven languages (proof: none: owner supplied the Trello card and desktop priority).
- [x] Create isolated worktrees and finish visible Codex audit (proof: none: worker thread 01a1b34c-2bd7-7c81-bec4-34613cd7a0a2 completed read-only audit).
- [x] Owner design approval (proof: none: owner said "Open a PR with the spec then proceed to implement it").

### 2. Implementation and review

- [x] Implement and verify the translation backbone and selectors (proof: desktop/test/unit/renderer/language.test.js).
- [ ] Migrate all desktop screen text and seven catalogs.
- [ ] Translate app-owned native desktop text and finish formatting.
- [ ] Verify coverage, previews, and focused tests; open and supervise PRs.

### 3. Extension follow-up

- [x] Audit extension UI surfaces and desktop locale transport (proof: desktop/test/unit/extension/extension-locale-transport.test.js).
- [ ] Translate extension UI in seven languages and add inherited Language setting in options.
- [x] Verify inheritance, explicit override, offline fallback and previews; supervise extension PR (proof: desktop/test/unit/extension/extension-i18n.test.js @397c32c5c294847a48b63ed4b30afccc927e7f6e on main).
