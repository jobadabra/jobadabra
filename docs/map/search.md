---
area: search
paths: [tests/unit/press, src/scout.py, src/daily.py, src/first_jobs.py, src/employer_index.py, src/job_rank.py, src/places.py, src/regions.py, src/sources, tools/persona-search, .github/workflows/scout.yml, .github/workflows/search-personas.yml, docs/ARCHITECTURE.md]
updated: 2026-11-10
---
# Search and scoring
> Find jobs crawls employer feeds and boards that match the person's strategy, scores them with AI, and delivers the best first. A central scout grows the shared employer index; every install downloads it and nothing about the user goes up.

## Rules
- A job search is global across Europe, for every role, not a tech search: a tech-leaning default, seed list, prompt example or test persona is a bug. Measure non-tech personas too.
- Sites a run reads or offers fit the current search (AI-judged for roles and places; a strategy change re-judges). Find jobs takes at most 3 minutes wall clock, every stage on one deadline from the press.
- **The press's fix ledger** (owner, 7 Nov 2026: "we overwrite one another and we never get it right"): every past fix to Find jobs' order or clock is a named row in `tests/unit/press/ledger.py`, run by `tests/unit/press/test_ledger.py`. A red row names the fix you undid: read its PR first. A new fix adds its row; changing or removing one needs the owner's words in the PR (`Ledger-change: L<nn> "…"`). Design: [the press](../superpowers/specs/2026-11-07-the-press-design.md).
- First jobs in seconds: a small slice of fast feeds is scored three at a time and saved as scored, so a new list has its first job while the full crawl runs (`src/first_jobs.py`). The free ranking spends AI on the best candidates first (`src/job_rank.py`).
- Never past a login wall or captcha; no disguised browser; a 401, 403 or 429 is not retried (one slower retry of a 403 right after our own burst). LinkedIn jobs and refused public sites are the two opt-in exceptions, each with its gate (CLAUDE.md "Safety").
- robots.txt and site terms are not consulted for public job listings; `Sitemap:` lines still help.
- Check a place with jobs located there (at most remote that names the country); worldwide remote never counts toward a place.
- The AI decides what a title or place means (`src/ai/decide.py`, `src/places.py`); a capped AI leaves leftovers unknown, never a default such as "other". Nothing from the network becomes prompt text.
- No job texts are stored centrally: only counts, place names and key facts, aggregated with k of at least 3.
- The Search check runs once a night, a report that blocks nothing: 18 fictional personas in a row (one role family and one city each; about 80-85 minutes, see SEARCH_SLOT in app-core/src/scheduler.js), scored by right role and right place, red when a press takes over 180 s (`tools/persona-search/`). A search PR relies on its unit and integration tests. By hand for now, `search-reference.yml` counts the right jobs EURES lists per persona, outside the app, as the Night search tab's yardstick.

## Fair EURES comparison
Night totals include EURES; source counts are not coverage. By-hand input `eures_comparison=true` pairs fresh searches with/without the reader, one strategy, fresh reference and blind judge (twice the presses; no nightly-history change). Actions summaries/artifacts show conservative overlap and first-job/70+ timing. [Design and limits](../superpowers/specs/2026-11-10-eures-comparison-design.md).

## Key files
- `src/daily.py` and `daily_*.py`: orchestrates a search run; `src/first_jobs.py`, `job_rank.py`, `score.py` (in `src/ai/`): first jobs, ranking, scoring.
- `src/sources/`: feed adapters, boards, careers pages; `src/sources/refused_reads.py` reads refused sites in the person's own browser.
- `src/scout*.py`, `src/employer_index.py`: the central scout and the index every install downloads.
- `src/places.py`, `regions.py`, `geo.py`: place words worked out by AI and kept locally.
- `tools/persona-search/`: the persona gate; skills `check-job-search-locally`, `fictional-candidate-runs`.
- More: `node desktop/scripts/codemap.mjs scout search sources`.

## Live specs
- [The press](../superpowers/specs/2026-11-07-the-press-design.md): one pipeline, budget table, ranker and fix ledger for Find jobs (plan [ps](../superpowers/plans/2026-11-07-the-press.md)).
- [First jobs fast](../superpowers/specs/2026-10-16-first-jobs-fast.md) and [search learns sources](../superpowers/specs/2026-10-18-search-learns-sources.md).
- [Job board discovery](../superpowers/specs/2026-10-08-job-board-discovery.md) and [locations, one source](../superpowers/specs/2026-10-17-locations-one-source.md).
- [LinkedIn headless](../superpowers/specs/2026-10-31-linkedin-headless-design.md): the opt-in LinkedIn read.

## Ask the sources
ask: github runs workflow=scout status=failure
ask: github runs workflow=search-personas days=7

## Lessons
- Before tuning a discovery prompt for a missed site, search the site's own name on the same engine: if even that fails, the gap is the engine's index and no prompt will fix it.
- A step that "finds nothing": read its start and end times against its cap and what it saves when cut off. A capped step that saves only at the end repeats the same lost work every run.
- A substring keyword in front of the AI answers wrongly and invisibly ("office" made "First Officer" a finance role). Kept answers, then the pack, then the model; seeds are only the offline floor.
- When a shared AI cap leaves items unjudged, publish nothing for them: a default looked like a real answer and filled 42% of the index.
- "Jobs in places" counts worldwide remote as everywhere. Classify from the saved location field and report the local count first.

## Go deeper
[architecture](../ARCHITECTURE.md) · [data ownership](../rules/data-ownership.md) · [rounds](../rules/rounds.md) · [check-central-scout skill](../../.claude/skills/check-central-scout-locally/SKILL.md) · [check-job-search skill](../../.claude/skills/check-job-search-locally/SKILL.md)
