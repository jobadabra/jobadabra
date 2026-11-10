# Find jobs: collect, rank once, then spend (short name sf, 10 Nov 2026)

Owner, 10 Nov 2026 (session sa, asked via AskUserQuestion): picked "W2 right jobs scored first", "W1 score 20-30 jobs a run", "W3 job boards redesign", "W4 more sources than EURES"; then "Do we need to redesign our code to have a more solid agloritm. To avoid regressions." · "I meant the overall job search algoritm, code cleanliness.." · "Let's improve the design". In session sf, after the sketch: "Let's improve" · "Let's do the fixes".

Assessment: [10 Nov search assessment](https://claude.ai/artifact/BnQ2D4Zdt6bGpPGUWoQcoq). Sketch: [collect, rank once, then spend](https://claude.ai/artifact/Xr8Xf4LCv7FeVkPSTS4b23). Builds on [the press](2026-11-07-the-press-design.md) (one clock, one ranker, the fix ledger).

## Verdict
- 🔴 A run scores jobs outside the person's city (#3670): 31% of scored jobs were the right role and city; in 14 of 55 presses that found right jobs, none was scored.
- 🔴 Two causes, both of shape: the place of a EURES job is learned by an AI call that answers after the run has picked its titles and scores; and the thread that collects jobs also scores them, so new jobs wait while it scores.
- 🟢 Target: each job carries its place when it is read; one order decides every queue; one scorer spends the AI; the collecting thread only collects.

## Design: a job's states, their one owner, the verdicts that change them
| State | One owner | Changes when |
|---|---|---|
| **Listed** | the reader that read it (`src/sources/*`) | the reader reads a page; it records title, place, link and the place fact it already has (EURES: Eurostat's point for the job's area, `src/sources/nuts_points.py`) |
| **Placed** | the map (`src/geo.py`, read through `time_budget.near_best`) | from the reader's fact, the kept answers or the shared pack, at once; an AI answer only for what is left, never waited for; unknown stays unknown |
| **Kept** | title sorting (`src/ai/title_triage.py`, the AI) | the AI says fits / does not; unanswered stays unknown, never guessed |
| **Scored** | the one scorer (`src/daily_search_scoring.py` beside the readers, claims in `src/press/scorer.py`) | it takes the best Kept jobs by the one order and the AI scores them; nobody else scores during a run |

Rules:
- **Rank once.** Every queue (title batches, scoring, enrichment) orders by `src/press/rank.py`'s weights; a weight reads facts that exist, it never waits for one.
- **Collect only.** The thread that imports jobs (`first_jobs` hub) never calls the AI scorer; the first-jobs step starts the scorer, it is not a second one.
- **One run, passed in.** The clock, the claims and the counts travel in one Run object; no module-level state in the search path.
- **Say why a stage stopped.** A stage returns done, cut by the clock, or failed with its reason; no catch-all that hides it.

## Plan (7 PRs, in order; titles `[sf] n/7 …`)
1. EURES jobs are placed from Eurostat's map when read (W2; no AI).
2. The collecting thread only collects; one scorer scores (W2, W5; Fixes #3670; changes ledger L38 with the owner's words).
3. One Run object carries clock, claims and counts (clean code).
4. Score 10-15 jobs in one AI call, the full score for the best (W1; prompt case set replayed).
5. Job boards: one entry point; proven boards from the pack at second 0; new boards found after the list is shown (W3; its own Design block and the owner's yes).
6. Each stage says why it stopped; catch-alls out (clean code).
7. Delete what never runs: steps that never start, the `time_budget` shim, the old board entry points.
W4 (sources beyond EURES) gets its own plan after this one.

## Progress
- [x] Sketch + owner's yes (10 Nov 2026: "Let's improve" · "Let's do the fixes") (proof: none: the owner's answers in the sf session, 10 Nov 2026)
- [ ] 1/7 EURES jobs placed from Eurostat's map when read (proof: tests/unit/press/test_home_region_first.py; replay of 55 presses 31% -> 49%)
- [ ] 2/7 The collecting thread only collects
- [ ] 3/7 One Run object
- [ ] 4/7 Batch scoring
- [ ] 5/7 Job boards, one entry point
- [ ] 6/7 Stages say why they stopped
- [ ] 7/7 Delete what never runs
