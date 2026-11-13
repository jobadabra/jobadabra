---
area: search
paths: [tests/unit/press, src/scout.py, src/daily.py, src/first_jobs.py, src/employer_index.py, src/job_rank.py, src/places.py, src/regions.py, src/sources, tools/persona-search, .github/workflows/scout.yml, .github/workflows/search-personas.yml, docs/ARCHITECTURE.md]
updated: 2026-11-10
---
# Search and scoring
> Find jobs crawls employer feeds and boards that match the person's strategy, scores them with AI, and delivers the best first. A central scout grows the shared employer index; installs download it and nothing about the user goes up.

## Rules
- A job search is global across Europe, for every role, not a tech search: a tech-leaning default, seed list, prompt example or test persona is a bug. Measure non-tech personas too.
- Sites a run reads or offers fit the current search (AI-judged for roles and places; a strategy change re-judges). Find jobs takes at most 3 minutes wall clock, every stage on one deadline from the press.
- **The press's fix ledger** (owner, 7 Nov 2026: "we overwrite one another and we never get it right"): every past fix to Find jobs' order or clock is a named row in `tests/unit/press/ledger.py` (`test_ledger.py`). A red row names the fix you undid: read its PR first. A new fix adds its row; changing or removing one needs the owner's words (`Ledger-change: L<nn> "…"`). [Design](../superpowers/specs/2026-11-07-the-press-design.md).
- **Every Find jobs change shows the people it reaches** (owner, 10 Nov 2026; 13 Nov: "Retire the replay (Recommended)": the offline replay, its re-records and its daily table are gone): a PR's proof is the live same-minute pair plus the Search night. Skill: [change-find-jobs](../../.claude/skills/change-find-jobs/SKILL.md).
- One owner each: order and clock `src/press/`, "in your places" `wanted_location` (`src/sources/feeds.py`), meaning the AI. Never a second sort key or scheduler, or a keyword guess for an unjudged job.
- First jobs in seconds: a small slice of fast feeds is scored three at a time, so a new list has its first job while the crawl runs (`src/first_jobs.py`); the free ranking spends AI on the best candidates first (`src/job_rank.py`).
- Never past a login wall or captcha; no disguised browser; a 401, 403 or 429 is not retried (one slower retry of a 403 right after our own burst). LinkedIn jobs and refused public sites are the two opt-in exceptions (CLAUDE.md "Safety").
- robots.txt and site terms are not consulted for public listings; `Sitemap:` lines help.
- A place counts jobs located there; remote only if the AI placed it. Remote jobs No/Country/Yes: bare Remote only under Yes.
- The AI decides what a title or place means (`src/ai/decide.py`, `src/places.py`); a capped AI leaves leftovers unknown, never a default such as "other". Nothing from the network becomes prompt text.
- No job texts are stored centrally: only counts, place names and key facts, k of at least 3.
- The Search check runs once a night, report only: 18 fictional personas in a row (one role family and one city each; ~80-85 minutes, SEARCH_SLOT in app-core/src/scheduler.js), scored by right role and place, red when a press takes over 180 s (`tools/persona-search/`). A search PR relies on its unit and integration tests and the live same-minute pair. `search-reference.yml` (by hand) counts the right jobs EURES lists per persona, outside the app.

## Fair EURES comparison
Night totals include EURES; source counts are not coverage. By-hand input `eures_comparison=true` pairs fresh searches with/without the reader (one strategy, blind judge). [Design](../superpowers/specs/2026-11-10-eures-comparison-design.md).

## Key files
- `src/daily.py`, `daily_*.py`: a search run; `src/first_jobs.py`, `job_rank.py`, `ai/score.py`: first jobs, ranking, scoring.
- `src/sources/`: feed adapters, boards, careers pages (`refused_reads.py`: refused sites, in the person's own browser).
- `src/scout*.py`, `src/employer_index.py`: the central scout and the index installs download.
- `src/places.py`, `regions.py`, `geo.py`: place words worked out by AI, kept locally.
- `tools/persona-search/`: the persona gate and the local proof; skills `check-job-search-locally`, `fictional-candidate-runs`.

## Live specs
- [Find jobs finish line](../superpowers/specs/2026-11-10-find-jobs-finish-line.md): the goal and its two numbers.
- [The press](../superpowers/specs/2026-11-07-the-press-design.md): one pipeline, budget table, ranker, fix ledger (plan [ps](../superpowers/plans/2026-11-07-the-press.md)).
- [Collect, rank once, then spend](../superpowers/specs/2026-11-10-find-jobs-collect-rank-spend.md): a job's states and owners (plan sf).
- [First jobs fast](../superpowers/specs/2026-10-16-first-jobs-fast.md), [search learns sources](../superpowers/specs/2026-10-18-search-learns-sources.md).
- [Job board discovery](../superpowers/specs/2026-10-08-job-board-discovery.md), [locations, one source](../superpowers/specs/2026-10-17-locations-one-source.md), [LinkedIn headless](../superpowers/specs/2026-10-31-linkedin-headless-design.md).

## Ask the sources
ask: github runs workflow=scout status=failure
ask: github runs workflow=search-personas days=7

## Lessons
- Before tuning a discovery prompt for a missed site, search its name on the same engine: if that fails, the gap is its index.
- A step that "finds nothing": read its times against its cap.
- A substring keyword in front of the AI answers wrongly and invisibly ("office" made "First Officer" finance).
- When a shared AI cap leaves items unjudged, publish nothing for them: a default looked real and filled 42% of the index.
- "Jobs in places" counts worldwide remote as everywhere: classify from the saved location.

## Go deeper
[architecture](../ARCHITECTURE.md) · [data ownership](../rules/data-ownership.md) · [rounds](../rules/rounds.md) · [check-central-scout skill](../../.claude/skills/check-central-scout-locally/SKILL.md) · [check-job-search skill](../../.claude/skills/check-job-search-locally/SKILL.md)
