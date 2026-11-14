---
name: change-find-jobs
description: Before and after changing what Find jobs reads, keeps, scores or orders (src/press, first_jobs, job_rank, feeds, places, sources, the clock): what to read first, what each measure can and cannot see, when to re-run on the Mac, and what never to do. Use before editing any Find jobs stage and before saying a Find jobs PR is done.
---

# Changing Find jobs without worsening another person

Owner, 10 Nov 2026: "each session that tries to improve a case, does this without worsening/affecting other improvements done previously." One change helps one person and quietly hurts another (time to first job, coverage, a place, a profile). The live same-minute pair on the PR is how you see it. The rule is in `docs/map/search.md`.

## Before you edit
1. `git log --format='%h %ad %s' --date=short -15 -- <file>` and the PR of each line's `Why`: a past fix is a named row of the press ledger (`tests/unit/press/ledger.py`, run by `test_ledger.py`). A red row names the fix you undid: read its PR first; a change or removal needs the owner's words (`Ledger-change: L<nn> "…"`).
2. Find the one owner, never add a second:
   - order and weights: `src/press/rank.py` (a call site names weights, never sorts itself);
   - the clock and budgets: `src/press/clock.py`, `src/time_budget.py` (one deadline from the press, never a second scheduler);
   - "in your places": `wanted_location` in `src/sources/feeds.py` (worldwide remote never counts);
   - what a title or place means: the AI (`src/ai/decide.py`, `src/places.py`); an unjudged job stays unknown, never a keyword's guess.
3. Say the intended behaviour for the person it helps, and name the people it could hurt (same role family, same country, remote-heavy, small city).

## The proof
The offline replay of recorded runs (its recordings, band and daily table) is retired (owner, 13 Nov 2026, asked via AskUserQuestion: "Retire the replay (Recommended)": "Proof stays the live search pair and the Search night"). A Find jobs PR's proof is one live search before and one after, started in the same minute, on a person the change reaches (see below), plus the Search night. Name each person you ran and the people it could hurt.

## What each measure can and cannot see
| Measure | Sees | Cannot see |
|---|---|---|
| Press ledger (`test_ledger.py`) | order and clock rules a past fix set | what a person gets from it |
| Night check (`search-personas.yml`) | live sites, judge through the relay, one press at a time | some people unmeasured, report only, a day late |
| Mac run (skills `check-job-search-locally`, `fictional-candidate-runs`) | fast AI, live sites, one person | the judge, other people |

## What the live pair must cover
A change that makes an AI call on the press path slower or larger shows only in a live run (12 Nov 2026, #3891: a think-first title call took ~5 s against ~3 s, a press sorted 947 titles against 1,169 and listed ~24 fewer right jobs): put titles sorted per press, or per second on the fixed set (`tools/pick-cases.py`, both paths), main beside the PR, and run the live proof on a person whose title queue fills the budget (p10): one search a side, both at once (`local-proof.mjs --together`).

A change in **what is kept or scored** (filters, place tests, ranking weights) is judged live for the people it touches: one search before and one after, started in the same minute, on CI or the Mac (owner, 12 Nov 2026: "Let's do only 1 live search before and after"; `check-job-search-locally`, or a batch with `fictional-candidate-runs`). A loss larger than the person's usual run-to-run difference holds the PR; a gain is claimed only with its mechanism proven by a test. `local-proof.mjs --same-draw` replays one recorded draw on both sides, offline, when the boards must be the same.

## The before/after, yourself, on CI (13 Nov 2026)
Owner, 13 Nov 2026: "But why sessions don't know to do this by themselves. No skill is telling them to do this. No PR CI guardrail is requested them a before/after". A PR that changes what Find jobs reads, keeps, scores or orders starts its own pair as soon as it is pushed; nobody queues it for you:
1. Pick up to 3 people the change reaches (night people 1-18 by number, profiles by id, `tools/persona-search/search-profiles.json`), at least one it could hurt.
2. Write one line per person in the PR body with the number still pending: `Moves: p3 right jobs 0 → pending (1 run a side, same minute, usual difference 2)`, then `tools/ship.sh --background` as always. Ship holds a PR with a pending line (draft, "DONT MERGE" after the tag, label `search-hold`); the PR's verdict starts `search-pair.yml` by itself for EVERY PR that changes a search file, for the people of the pending lines, else the last pair's people (none: the row says "pair needed"), once per head (`tools/pr_verdict_pair.py`; at most 4 starts per PR a day; a row "Search before/after" is on the PR's checks), so nothing to dispatch by hand (owner via sa, 14 Nov 2026: "to start the pair by themselves").
3. The pair claims 2 searches per person at the broker and waits its place in line (first come, first served; each run takes only what it needs: `tools/persona-search/claim.py`), then main and your PR search at the same minute on one runner, with one strategy draft for both; a PR touching `desktop/lib/strategy*.js` drafts per side and searches twice a side.
4. Its one comment on the PR (updated in place) gives right jobs main → PR, found, first relevant, the first two board words a side, the broker wait and the minutes per part, and writes the numbers into your pending lines. No person fell beyond their usual difference (1 job when not measured yet): it lifts ship's hold and the watcher marks the PR ready at READY. A loss: the hold stays, with who fell; name the cause or fix it. A side whose broker wait p90 is over 20 s is not counted: the pair runs once more, then reports. A hold you set yourself (no label) is never lifted by the pair.
5. By hand still works (`gh workflow run search-pair.yml -f pr=<n> -f people='[3, "b02"]'`, `-f tiers=small` only for a small-tier comparison asked for); several PRs' pairs run side by side while the broker has room.

## Never
- A second sort key, a second scheduler or deadline, a second "in your places" test.
- A keyword or threshold guess for an item the AI left unjudged.
- A fix that helps the person in front of you without naming who it could hurt.
- Reading a green ledger or "no change" on 12 people as proof for the other 6.
