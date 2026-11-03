# AI user agents: the PR plan

Spec: `docs/superpowers/specs/2026-11-03-ai-user-agents-design.md` (owner's answers 3 Nov 2026: evolve the explorer; file anything with an argument; daily, one ~30-minute diverse session; any bug type; three-layer knowledge; no week brake, a cost view and control).
Layer: a report-only measurement. No gate, no beta step, no `critical-journeys.json` entry, no other session's suite touched. a8 (jobadabra-63) knows what is added under `desktop/e2e/`.

## The 7 PRs (named up front; titles `[ag] n/7 <what>`)

| n/7 | Repo | What it does | Proof it works | Who gets what |
|---|---|---|---|---|
| 1/7 | `jobadabra-web` | the AI broker tallies each accepted call by the workflow file name in the verified OIDC claim (`job_workflow_ref`), per UTC day: calls, tokens, ms, engine; `/health` returns it; /admin/ai-cost shows every workflow's tokens for 7 days | a worker test: two claims, two workflows, two rows; a caller-sent `x-workflow` header is ignored | the owner sees tokens per CI workflow before the agent exists (the baseline the agent is compared to) |
| 2/7 | `jobadabra` | **spike + skeleton**: the explorer runs on `askBroker` only (API-key path deleted); one ~30-minute session with minute/call caps read from repository variables (`AI_USER_AGENT`, `_MINUTES`, `_CALLS`); a by-hand workflow run prints tokens, seconds per call and per tier, and the observation comparison (`ariaSnapshot` vs the explorer's text) per view | the by-hand run's log: measured numbers replace the spec's ceilings; a pure test for the caps and the loop with a fake broker and a fake page | the owner gets the real cost of a session and the answer to "tree or text" |
| 3/7 | `jobadabra` | **diversity**: persona + CV-shape generator, move vocabulary read from the ⌘K action registry, the seeded planner (goals, order, ≥ 50% new move/state pairs), the coverage record; stored-value re-check; a planted bug | planner unit tests on fixed seeds (two seeds differ ≥ 50%); a recorded-page test that the re-check reads a label-as-value | every day's session is different and replayable by seed |
| 4/7 | `jobadabra` | **knowledge**: `docs/app-expectations/` seed (the owner's examples + one-line rules the specs already state, each with its source), the `agent-memory` branch write-back, "changed since last session" from `git log` + PR verdict lines mapped by the code map | tests: a changed file puts its area into the plan; an entry citing changed code is marked stale; the write-back merges duplicates | the agent starts every session knowing how the app should work and what changed today |
| 5/7 | `jobadabra` | **findings and the daily workflow**: notes with arguments, the Send-feedback evidence package on an `agent-evidence` branch (same registry, screenshot and redactor), the step trace and session summary, the second-opinion call, detector `ai-user-agent` in `triage-findings.mjs`, labels, the 12-a-session flood guard, `ai-user-agents.yml` (+ its slot in the Worker timer, `app-core/src/scheduler.js`, on its own lines), the cost line in each report | tests: a note without an argument is dropped; the cap ranks proved → judge agrees → severity; the workflow's `paths:` equal `replay-files.mjs --paths`; the owner-guard env test | issues the owner can see and judge, per type, on /admin/testing/self-healing |
| 6/7 | `jobadabra-web` | **the sessions page** `/admin/testing/agent`: a row and a story per session, the coverage map, precision per `agent-type`; fed by the self-heal publish (`SELFHEAL_PUBLISH_KEY`, existing; no new secret) | a page test on demo sessions (a pass with evidence, a could-not-finish, a bug); `tools/page-shot.mjs` light + dark | the owner sees what the agent did every day, bugs or not |
| 7/7 | `jobadabra` | **the replay proof** on `b4d64112` (before #3027), `b6014b04` (before #3026) and `df66db14` (fixed): named plans × 3 runs, 2 free sessions, the planted bug; results into the spec and the PR body | the table: bug × runs found × method; target ≥ 3 of 4 by named plans, 0 filed about the four on the fixed commit | the owner learns whether the agent beats today's methods, in numbers |

Order: 1/7 first (it also stands alone); 2/7 needs no 1/7; 3/7 and 4/7 need 2/7; 5/7 needs 3/7 and 4/7; 6/7 needs 5/7; 7/7 last. A small fix several PRs need goes into each branch (CLAUDE.md), never "merge X first".

## Rules for every PR
- Tier and test method stated in the body; named tests only on the Mac, never an e2e (skill `e2e-harness`); a harness test is pure, injected clock and seed, generous hang caps.
- a8's push-gate list: every `desktop/e2e` lib or top-level file touched carries exactly one `// Job: <job>` line from the allowed list; commits carry `Harness-job: <job>` and `E2E-cause: none <why>`; changing a line under a `Why` updates it and adds `Why-changed:`; `clean-code` is re-run after committing; a new workflow's `paths:` equals `node tools/replay-files.mjs --paths <workflow>`.
- The Worker timer's daily slot (5/7) is its own entry on its own lines in `app-core/src/scheduler.js` (a8's [a8] 2/4 adds one too: whoever lands second rebases; if a shared daily-slot helper appears, use it).
- A fresh `/code-review` subagent before each ship (this is a new method, not a bug the owner saw, but the owner's instruction for this session is one before each ship); `tools/ship.sh --background`, watch the PR to READY (All checks passed + Gitar ✅ Approved + no unanswered comment); the owner merges by hand.
- Park what the outcome does not need in Linear (team JOB), by ROI, and say "parked as JOB-n".
- SendMessage mac-07 at each PR's open, READY and MERGED.
- Fictional data only; never the owner's app, accounts, Claude login or `~/.claude.json`.

## Parked from this plan (to file in Linear when built)
- A Windows daily session (the app layer runs on Windows; the agent runs on Linux only at first).
- A week brake as one more repository variable, if the cost view shows the agent starving PR checks.
- Promoting a confirmed agent note to an expectation by a bot PR (today a person does it).
