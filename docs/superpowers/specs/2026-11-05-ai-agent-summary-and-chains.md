# AI user agent: a summary loop, then runs chained into deep flows

> **Verdict:** one run is capped at 250,000 tokens (owner, 5 Nov 2026), and today a call costs a median 34.5k, so a run gets about **6 steps**, too few to reach a deep flow. Two changes, in this order. **A: the summary loop** (each call sends the fixed part, the current screen and a short summary of the steps so far, nothing else): about 15–17k a call, **13–15 steps** a run. **B: chained runs** (a run ends with a summary and a snapshot of the app's data; the next run restores both and goes on, each with its own 250k cap): a flow that needs 40 steps is reached over **at most 4 runs**. Report only, never a gate. Parent spec: [2026-11-03-ai-user-agents-design.md](2026-11-03-ai-user-agents-design.md) (B is the "snapshot saved and restored" of its 11/12, cut down to chains).

**Owner's words (5 Nov 2026):** "we can start with 250k tokens then. Assuming the initial context/harness would be max 20k"; chosen: "Both: summary loop + chained runs (Recommended)"; earlier: "It doesn't need to stop on the first bug. It needs to advance as much as possible through the app, through the flows. And note/report all the bugs it found."

## Why (measured, 5 Nov 2026)

| What | Number | Source |
|---|---|---|
| Fixed part of a call (instructions + answer shape + goal + knowledge) | ~1.5k tokens, limit 20k, checked at start | `harnessTokens`, `lib/agent-tier.mjs` |
| First call (fixed part + first page view) | 14.2–15k in 5 of 6 recorded runs; one 115.7k | `agent-trace.jsonl` of runs t1a, t1b, t2b, q2, t3, p41944866482 |
| An actor call over 193 steps | median 34.5k, p10 14.9k, p90 61.7k | same traces |
| Steps that fit 225k (250k less the judge's 25k reserve) | ~6 | 225k / 34.5k |

The conversation keeps the first message (with the first page view) for the whole goal and adds the current page view and every earlier answer and reply, which is why a call is 2–3× its floor. (A hypothesis from the sizes until PR A's table shows the split.)

## A. The summary loop

**Behaviour.** `explore()` (`lib/explore.mjs`) stops growing a conversation. Every call sends one user message:
1. the fixed part: the goal and what is known (`goalIntro`), unchanged;
2. **Steps so far**: one short line per step, written by code from the step record (`row.did`, the page it was on, whether it failed and why, the note it made by title), never by an AI call: `3. Press "Add job" (Jobs) → a form opened`. The last 12 steps in full; older ones as one line per page ("Jobs: 9 steps, 2 notes");
3. **The screen now**: the current page view, as today.

The answer is validated as today; the first message of a goal is not special any more. A goal starts with an empty summary.

**States and who owns them.** The summary is one list owned by the loop (`trace` rows are its only source); nothing else writes it. A step is added when its turn ends, with the verdict of that turn (done, failed, refused, note made). The repeat nudge (`REPEAT_NUDGE`, FR 2/4) reads the same rows.

**What can go wrong and is tested.** The summary must carry what the old history carried: the controls already tried (so it does not repeat them), the notes already made (so it does not file twice), a failed step's reason. Tests play a recorded 12-step goal through both loops and compare what the model is told about each of those three; a missing one fails.

**Measure (in the PR body).** The same plan before and after, one run each (same seed, app commit and tier). The plan is `tour` (6 goals through Profile, Jobs, Focus, Actions, Strategy, Settings), which exists only on the pushed branch `ag-fill-run`, not in `NAMED_PLANS` of `desktop/e2e/lib/agent-plans.mjs` on main: SC 1/2 adds it there (with its test) before measuring: tokens per step (median, p90), steps per run, goals reached, notes made and judged real. The target is steps per run ≥ 12 with notes no fewer than before; if it is not met, the spec says so and A is not merged as a win.

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
- [ ] [ag] A. The summary loop, with the before/after table (proof: PR body table; `desktop/e2e/test/pool/agent-summary-loop.test.mjs`)
- [ ] [ag] B. Chained runs: the snapshot, the chain state, the dispatch, the note's pointer, one deep flow over 2–4 links (proof: PR body; `desktop/e2e/test/pool/agent-chain.test.mjs`)
