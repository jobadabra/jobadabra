# AI user agent: a summary loop, then runs chained into deep flows

> **Verdict:** one run is capped at 250,000 tokens (owner, 5 Nov 2026) and a large-tier call costs **15.0–17.5k tokens from its first step to its last**, so a run gets about **13 steps** (210k for the actor, 40k kept for the second opinion). That is too few for a flow of 40 steps. **A, the summary loop, is dropped**: it would save ~3–5% a call (the history adds ~0.1k a step), measured 5 Nov 2026, owner: "Drop A, build B, measure the floor". **B, chained runs** (a run ends with a summary and a snapshot of the app's data; the next restores both and goes on, each with its own 250k cap) reaches a flow over **at most 4 runs**. The ~11k floor per call is the engine's, measured by `ca`. Report only, never a gate. Parent spec: [2026-11-03-ai-user-agents-design.md](2026-11-03-ai-user-agents-design.md) (B is the "snapshot saved and restored" of its 11/12, cut down to chains).

**Owner's words (5 Nov 2026):** "we can start with 250k tokens then. Assuming the initial context/harness would be max 20k"; chosen: "Both: summary loop + chained runs (Recommended)"; earlier: "It doesn't need to stop on the first bug. It needs to advance as much as possible through the app, through the flows. And note/report all the bugs it found."

## Why (measured, 5 Nov 2026)

| What | Number | Source |
|---|---|---|
| Fixed part of a call (instructions + answer shape + goal + knowledge) | ~1.5k tokens, limit 20k, checked at start | `harnessTokens`, `lib/agent-tier.mjs` |
| An actor call, large tier, first to last step of a goal | 15.0–17.5k (goal 1: 15,293 → 16,377 over 14 steps; goal 5: 15,025 → 16,416 over 10) | run 41952722418 (87 calls), night 41969305445 (11 calls), 42040707448 (7 calls) |
| Input vs output per call | ~15.1k in, ~0.1k out | `agent-session.json` cost of 41952722418: 1,552,708 in, 10,612 out, 103 calls |
| Steps that fit the actor's 210k (250k less the judge's 40k reserve) | ~13 | 210k / 16.5k |

**What the first draft of this spec got wrong:** it took a 34.5k median over 193 earlier calls and blamed a growing history. Today's large-tier calls show the history is ~0.1k a step (older page views are already dropped), and the cost is a floor of ~15k a call that no summary removes. A summary loop was built and tested (worktree `ag-summary-loop`, not shipped) and not opened as a PR: no outcome.

## A. The summary loop — dropped (measured 5 Nov 2026)
Each call would send the goal, the current screen and a short code-written summary instead of the conversation. Measured, it saves ~3–5% a call (see Why), about half a step in a 250k run. Not built into the product. The code and its tests stay in the worktree `ag-summary-loop` if the floor ever drops and the history becomes the cost.

## B. Chained runs

**Behaviour.** A **chain** is up to **4 runs** of one plan on one app commit. A run ends with: its **summary** (the goals done, the steps so far per goal, the notes made, where it stopped and why) and a **snapshot** of the app's state. The next run restores the snapshot, reads the summary and **continues the goal where the last one stopped** (the summary line "Continue: goal 3 of 6, Strategy → search, at step 14: results page not reached" goes where the goal goes). Each run keeps its own 250k cap, its own minute limit and its own report.

**The snapshot.** The app's data folder as the run left it (store, settings, seeded data; caches, logs and the browser profile's cache excluded), packed as `agent-chain-<chainId>-<n>.tgz`. Fictional data only; the existing artifact secret scan runs on it before it is kept. Size is printed by the first run; if it is over 20 MB the trim list grows, never the retention.

**Who owns what.**
| Thing | Owner | Where |
|---|---|---|
| The chain's id, link number, plan, seed, app commit, next goal | the suite (`lib/agent-chain.mjs`) | `agent-chain.json` beside the snapshot |
| The snapshot of link n | the run that made it | an Actions artifact, kept 7 days; a run that makes a note also copies the snapshot it started from to `agent-evidence` so the issue outlives the artifact |
| Starting the next link | the last step of the workflow, only when the chain goes on | `workflow_dispatch` with `chain_from=<run id>` |
| What a run may change | only its own folder | the app is launched on a copy; a restored snapshot is never edited in place |

**Chain states.** `new → running(n) → ended`. A chain **ends** (and says why in the last report) when: every goal is done; a link made no progress (it stopped on `repeat`, or its first and last screens are the same and it made no note); the app commit differs from the chain's (a snapshot of another build is not restored); a link hit a broker failure (`api:`; the notes so far are kept, the chain does not retry); or link 4 ended. A chain never starts a 5th link and never continues across midnight UTC (a new night starts a new chain).

**A note names its snapshot.** A note made in link n carries `{chain, link: n, snapshot: <artifact name or evidence path>, steps since the snapshot}`; the issue and the Admin tab show it, so a person (or an offline replay) restores that folder, runs those steps and reaches the same screen. The replay without AI is a later piece (parent spec 11/12); this spec only guarantees the pointer exists and the snapshot restores.

**The deep flow shown.** The PR body shows one flow reached over 2–4 links (Strategy → search → results, or a full apply stopped before Submit; Submit is never pressed, as always): per link, steps, tokens, the screen it ended on, and the restored snapshot's hash equal to the one the previous link saved.

**Safety.** Unchanged: the test account, fictional data, no Submit, the owner-guard test. A snapshot is built from the suite's own folder, never the owner's app or Keychain; the restore refuses a folder that does not carry the suite's marker file.

## Not in this spec (parked)
- The offline replay of a note from its snapshot (parent 11/12).
- Living personas over days, a moving world, aged-state generation (parent 10/12, 12/12).
- More than 4 links, or a chain across nights.

## Progress
- [x] Spec and plan written; the owner chose both pieces (5 Nov 2026) (proof: none: the answer came in the chat through the coordinator and is quoted under Owner's words in this spec)
- [x] [ag] A. The summary loop: dropped, the history is ~0.1k a step (proof: none: owner decision 5 Nov 2026 "Drop A, build B, measure the floor"; the numbers are in Why above)
- [ ] [ag] B. Chained runs: the snapshot, the chain state, the dispatch, the note's pointer, one deep flow over 2–4 links (proof: PR body; `desktop/e2e/test/pool/agent-chain.test.mjs`)
