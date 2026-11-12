---
name: change-find-jobs
description: Before and after changing what Find jobs reads, keeps, scores or orders (src/press, first_jobs, job_rank, feeds, places, sources, the clock): what to read first, how to read the 18-person yardstick table (the daily one on main since 12 Nov 2026, no longer on PRs), what each measure can and cannot see, when to re-run on the Mac, and what never to do. Use before editing any Find jobs stage and before saying a Find jobs PR is done.
---

# Changing Find jobs without worsening another person

Owner, 10 Nov 2026: "each session that tries to improve a case, does this without worsening/affecting other improvements done previously." One change helps one person and quietly hurts another (time to first job, coverage, a place, a profile). The yardstick on the PR is how you see it. The rule is in `docs/map/search.md`.

## Before you edit
1. `git log --format='%h %ad %s' --date=short -15 -- <file>` and the PR of each line's `Why`: a past fix is a named row of the press ledger (`tests/unit/press/ledger.py`, run by `test_ledger.py`). A red row names the fix you undid: read its PR first; a change or removal needs the owner's words (`Ledger-change: L<nn> "…"`).
2. Find the one owner, never add a second:
   - order and weights: `src/press/rank.py` (a call site names weights, never sorts itself);
   - the clock and budgets: `src/press/clock.py`, `src/time_budget.py` (one deadline from the press, never a second scheduler);
   - "in your places": `wanted_location` in `src/sources/feeds.py` (worldwide remote never counts);
   - what a title or place means: the AI (`src/ai/decide.py`, `src/places.py`); an unjudged job stays unknown, never a keyword's guess.
3. Say the intended behaviour for the person it helps, and name the people it could hurt (same role family, same country, remote-heavy, small city).

## Read the table
The daily yardstick table (`press-yardstick.yml`, called by `press-tapes-auto.yml` once a day on main after the recordings are renewed; the job summary of that run; owner, 12 Nov 2026, "Off PRs, nightly on main"): 18 people × coverage, quality, speed, listed in the right place. A PR no longer gets it: its proof is the live same-minute pair plus the Search night; to replay your branch by hand: `gh workflow run press-yardstick.yml --ref <branch> -f mode=pr`. Each cell reads `main → this ref` (on main, main again).
- First line: `N better, N no change, N worse, N not measured; worse: <people>`. Then the lowest listed-in-the-right-place shares, how many people repeat exactly on main, and any press that failed (that person is left out of both sides).
- **Worse** = beyond one job (5 s of speed) and beyond the person's own band (2 sd of main's 5 replays). A 1-job change still shows in the cell even when it reads "no change".
- **Noisy** people (their replays do not repeat on main) carry their band: read their "worse" with it. "Not measured" (no recording, no band yet) is no proof either way.
- Report only, no red. Your PR names each worse person's cause or says why it is fine; a person who got worse and you did not look is the gap this table exists to close.
- EURES is on only in the installed app (`JOBADABRA_EURES=1`, `src/features.py`); source and CI runs have it off. A replay uses it when the recording was made with it (`recorded.json` `eures`, replay `--with-eures`), so compare like with like: a recording made without it never shows what EURES adds.
- It no longer starts on a PR (the paths list and `paths.py` are gone, 12 Nov 2026).

## What each measure can and cannot see
| Measure | Sees | Cannot see |
|---|---|---|
| Press ledger (`test_ledger.py`) | order and clock rules a past fix set | what a person gets from it |
| Yardstick table | recorded runs replayed offline, per person, main beside PR | the product's speed (recordings carry CI's slow AI: a Mac scored 15 jobs a run against 2), an AI call made slower or larger (answers replay at the recorded pace), a change in what a site lists now, people with no recording |
| Night check (`search-personas.yml`) | live sites, judge through the relay, one press at a time | some people unmeasured, report only, a day late |
| Mac run (skills `check-job-search-locally`, `fictional-candidate-runs`) | fast AI, live sites, one person | the judge, other people |

## When the replay is not enough
A change that makes an AI call on the press path slower or larger is invisible to the replay (12 Nov 2026, #3891: a think-first title call took ~5 s against ~3 s, a press sorted 947 titles against 1,169 and listed ~24 fewer right jobs; the yardstick said no person below main): put titles sorted per press, or per second on the fixed set (`tools/pick-cases.py`, both paths), main beside the PR, and run the live proof on a person whose title queue fills the budget (p10): one search a side, both at once (`local-proof.mjs --together`).

A change in **what is kept or scored** (filters, place tests, ranking weights) changes jobs the recordings never listed: the replay can only reuse what was recorded. Re-run live for the people it touches: one search before and one after, started in the same minute, on CI or the Mac (owner, 12 Nov 2026: "Let's do only 1 live search before and after"; `check-job-search-locally`, or a batch with `fictional-candidate-runs`); put the numbers next to the table in the PR and say which people you ran. A loss larger than the person's usual run-to-run difference holds the PR; a gain is claimed only with its mechanism proven by a test.

## Never
- A second sort key, a second scheduler or deadline, a second "in your places" test.
- A keyword or threshold guess for an item the AI left unjudged.
- A fix that helps the person in front of you without naming who it could hurt.
- Reading a green ledger or "no change" on 12 people as proof for the other 6.
