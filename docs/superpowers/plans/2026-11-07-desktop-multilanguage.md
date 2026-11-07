# Desktop Multi-language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the coordinator's backbone; use the owner's explicit delegate-to-codex workflow for the visible screen worker. Steps use checkbox syntax for tracking.

**Goal:** Deliver the desktop UI in en, de, fr, it, es, ro, and ru with a saved display-language choice.
**Architecture:** Dependency-free shared message runtime and bundled functional catalogs. A bootstrap resolves locale before page imports; explicit HTML annotations and dynamic t() calls translate only app-owned strings. Native surfaces share the runtime.
**Tech Stack:** JavaScript ES modules, Electron, Intl, existing Node test runner and demo shots.
**Spec:** docs/superpowers/specs/2026-11-07-desktop-multilanguage-design.md

## Global Constraints

- Desktop only; no translation API, new dependencies, website/email/extension changes, or application-content translation.
- Preserve user data, raw external errors/logs, internal status/IPC identifiers, unsaved drafts, native button behavior, and running main-process jobs.
- Seven locales: en,de,fr,it,es,ro,ru. English fallback. Unsupported/invalid locale choices never break startup.
- Worktrees, ship.sh, owner-only merges; named tests locally, heavy suites on CI; fictional demo data only.
- Coordinator owns the backbone and native files; worker owns migrated screen files and screen catalogs after the foundation commit.

## Review Focus

- Regional/unsupported OS languages resolve predictably; saved explicit choice wins.
- An unsaved draft prevents language persistence and reload.
- Interpolation of a company or answer containing markup is text, not executable HTML.
- Russian/Romanian counts use their own plural forms; no English-only singular shortcut.
- Windows wording changes only app text, preserving CV/job/answer content.

## PR sequence

1/6 Specification and plan; 2/6 language foundation and selectors; 3/6 static screens; 4/6 dynamic pages; 5/6 helpers/drawers; 6/6 native text and coverage. The worker's PR depends on the foundation. Each PR uses the repo PR template and is merged only by the owner.

### Task 1: Publish spec and persistent progress

**Files:** this plan and the linked spec. External: one Notion progress page beneath the project Progress section, containing findings, status, PR links, and test evidence; code/spec remain canonical in git.
**Interfaces:** produces spec PR URL and Notion progress URL.
- [x] Check spec against the worker audit and owner's approved scope.
- [x] Commit docs and open with tools/ship.sh --background; verify PR exists.
- [x] Create/update the requested Notion progress record without exposing credentials.

### Task 2: Translation runtime and explicit static binding

**Create:** desktop/i18n/index.js, desktop/i18n/format.js, desktop/i18n/catalogs/common.js, desktop/renderer/i18n-dom.js.
**Test:** desktop/test/unit/renderer/i18n.test.js, desktop/test/unit/renderer/i18n-dom.test.js.
**Interfaces:** `SUPPORTED_LOCALES`, `resolveLocale(choice, preferred)`, `setLocale(locale)`, `getLocale()`, `registerMessages(locale, namespace, messages)`, `t(key, vars={})`; `number(value, options)`, `date(value, options)`, `relative(value, unit, options)`. Messages are strings or plural-category maps; count is `vars.count`. Keys use `namespace.message`. `translate(root)` touches only explicit data-i18n/data-i18n-title/data-i18n-placeholder/data-i18n-aria-label bindings and preserves nested icons and controls.
- [x] Write runtime tests for fallback, regional preferences, interpolation, plural categories, and Intl formatting; run to see missing module fail.
- [x] Implement the shared runtime with English fallback and all seven common catalogs.
- [x] Write DOM binding tests for mixed nested markup, attributes, and preservation of unmarked user content; watch fail, implement, rerun.

### Task 3: Startup, saved language and selectors

**Create:** desktop/renderer/bootstrap.js, desktop/renderer/pages/language.js, desktop/lib/locale-handlers.js.
**Modify:** desktop/renderer/index.html, desktop/renderer/app.js, desktop/preload.cjs, desktop/main.js, desktop/package.json, desktop/renderer/os.js, desktop/renderer/pages/core.js.
**Test:** desktop/test/unit/main/locale-handlers.test.js and relevant existing preload/IPC/OS tests.
**Interfaces:** Fresh installs resolve to English. Welcome keeps its existing step and Start action, with an optional dropdown above the full-card button overlay. `pilot.locale()` returns `{choice, locale, supported}`; `pilot.setLocale(choice)` accepts `system` or a supported locale and returns the persisted resolved state. `bootstrap` loads locale, sets runtime locale, translates annotated HTML and only then imports app.js. `language.init()` binds both selectors, checks existing `anyUnsaved()`, persists then reloads only when allowed. The coordinator publishes the exact final API before worker code begins.
- [x] Write failing handler tests for validation, OS resolution, persistence, and failed persistence; implement and pass.
- [x] Write failing selector tests proving a draft prevents both save and reload; implement with the existing save-bar registry.
- [x] Wire bootstrap, settings and first-run selectors, palette entry, document lang, and packaging i18n/** plus locale packs.
- [ ] Restrict/remove arbitrary platform observer text rewriting; keep existing English app behavior through explicit translation boundaries and tests.
- [ ] Render welcome/Appearance using fictional demo data in light/dark, inspect and prepare owner preview before shipping the UI PR.

### Task 4: Migrate desktop screen strings (visible worker)

**Files:** renderer/index.html after selector handoff; renderer page/drawer/component modules except backbone-owned app.js/pages/shared.js/pages/core.js/os.js/i18n-dom.js/pages/language.js/bootstrap.js; desktop/i18n/catalogs/screens/ namespace files; tests of changed screens.
**Interfaces:** consumes runtime from Task 2 and startup from Task 3. Worker adds one catalog-loader module that registers its screen namespaces, imported by bootstrap before app.js. Catalog registration module is worker-owned; coordinator initially supplies an empty loader to establish the path, then relinquishes it.
- [ ] Inventory app-owned screen strings without treating user content as messages.
- [ ] Add representative failing localized screen tests and translate explicit static labels, attributes, dynamic branches, menus and accessibility copy.
- [ ] Produce all seven catalog variants with consistent placeholders, plural forms, no identical English placeholders masquerading as translations, and bounded file sizes.
- [ ] Update relevant English source-reading tests and preserve English compatibility; run only named affected tests.
- [ ] Render representative long/Cyrillic translations, inspect overflow, report uncovered surfaces explicitly, and ship the worker-owned PR with the required preview approval.

### Task 5: Native desktop text, formatting and coverage

**Files:** desktop/lib/app-menu.js, app-updates.js, app-notify.js, app-reminders.js, unsaved-guard.js and remaining app-owned native dialog/picker callers; desktop/i18n/catalogs/native/; shared renderer formatting helpers.
**Test:** existing app-menu/unsaved-guard/notification tests and new locale cases, catalog contract tests.
**Interfaces:** consumes shared runtime; locale handlers activate native locale before renderer reload. No changes to role identifiers, accelerators, button indices, defaultId/cancelId, or callbacks.
- [ ] Add failing locale cases to native/menu/notification tests, implement catalog lookup, rerun.
- [ ] Replace hardcoded date/number locales in app-owned presentation with shared formatting helpers without changing currency/time-zone semantics.
- [ ] Check catalog key/parameter/plural parity and coverage of the audited app surfaces; do not call the feature complete with known untranslated app-owned screens.
- [ ] Perform focused final tests, inspect light/dark demo screenshots, update spec/Notion record with measured evidence and PR links.
- [ ] Open/supervise PRs through ship.sh; fix red checks/review issues; owner merges.
