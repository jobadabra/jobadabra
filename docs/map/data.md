---
area: data
paths: [src/stores, tests/store_contract.py, docs/rules/data-ownership.md, docs/notion-schema.md, config/notion_schema.json, tools/notion_schema.py, desktop/lib/schema.js, desktop/lib/notion-gate.js, desktop/lib/migrate.js, desktop/lib/backup.js]
updated: 2026-11-03
---
# Data and stores
> The person's data lives behind one store interface with one copy: SQLite by default, Notion when they choose. The Mac keeps only keys, large files and rebuildable caches.

## Rules
- One store interface (`src/stores/`, `open_stores()`); every adapter passes `tests/store_contract.py`. New stored data goes through the interface and every adapter, never straight to Notion.
- One copy, never a sync. Moving to Notion is the person's choice and one-way. "Always on" needs Notion.
- No cache-only fields and no local fallback copies of user data: if a screen needs a field, it is a store column. Writes go to the store first; if it refuses, nothing changes locally and the person is told.
- A reader of an old data shape is removed only once the stored data is migrated, never because every install is past a version.
- A new Notion database, column or page also goes into `config/notion_schema.json` and `docs/notion-schema.md` (`tools/notion_schema.py`); tests fail when the code uses a column the schema lacks.
- A reset clears this Mac only; a fresh profile starts a new Notion workspace and never reuses an old page.
- Wrong data is a bug: fix the root cause with a regression test, then repair the owner's rows through the Notion tool. No one-off repair code.
- Say "your store" (this Mac or Notion) to the person, not "Notion" as the one database.
- Secrets only in the macOS Keychain, GitHub and Worker secrets; never in the store, logs, Notion or docs.
- Nothing central keeps job texts or postings; only stats and key facts.

## Key files
- `src/stores/`: the interface and adapters (`sqlite`, `notion`); `tests/store_contract.py` the contract every adapter passes.
- `config/notion_schema.json`, `docs/notion-schema.md`, `tools/notion_schema.py`: the workspace as code; `desktop/lib/schema.js` repairs a workspace at connect and start.
- `desktop/lib/notion-gate.js`: "trying" without a store connected; `migrate.js` moves local files in at connect; `backup.js` the weekly backup.
- More: `node desktop/scripts/codemap.mjs store notion schema`.

## Live specs
- [Store adapters](../superpowers/specs/2026-10-09-store-adapters.md): the interface and its owners.
- [Notion later](../superpowers/specs/2026-10-03-notion-later.md): trying the app before connecting a store.
- [What we learned about you](../superpowers/specs/2026-10-28-what-we-learned-design.md): facts versus learned answers.

## Ask the sources
ask: notion page id=<page id>
ask: github issues label=bug state=open
ask: sentry issues is:unresolved culprit=stores

## Lessons
- A file read while it is being written is fixed at the writer (temp file, fsync, rename), never by a retry in the reader.
- A review queue asks only what the store does not already hold: check the contact fields and the other saved lines first.
- Two values that disagree are a conflict for the person to settle in the app's drawer, not a silent overwrite.

## Go deeper
[data-ownership rules](../rules/data-ownership.md) · [Notion schema](../notion-schema.md) · [Notion surface](../notion-surface.md) · [architecture](../ARCHITECTURE.md)
