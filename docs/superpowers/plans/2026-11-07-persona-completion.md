# AI Persona Completion Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for the coordinator's tasks; the existing delegated Luna pane owns the separate web PR.

**Goal:** Recover unfinished persona coverage and accurately report what a run proved.

**Architecture:** Add explicit partial states to the existing session, persist pending identities with notes, and preserve the completed-night checkpoint. Extend run records additively for the Admin reader.

**Tech Stack:** Node.js 22, existing scripted node:test guards, GitHub Actions, Worker Admin HTML.

**Spec:** docs/superpowers/specs/2026-11-07-persona-completion-design.md

## Global Constraints

- Keep the 250,000 token cap, existing safety rules, and existing workflow run count.
- No local model calls or broad suites. New tests guard money/data; formatting uses a rendered sample.
- Web compatibility lands first. Owner merges; actual UI approval precedes UI commit.

## Review Focus

- Partial work must not advance the completed-night checkpoint.
- Removed/duplicated pending moves must not block planning.
- The final verification cannot mutate state or add a call beyond existing limits.
- Legacy records have no counted token total; do not invent one.
- Scheduled runs must not start recording when manual defaults change.

### Task 1: Honest completion

**Files:** desktop/e2e/lib/agent-run.mjs, agent-session.mjs; existing pool/agent-steps.test.mjs and agent-run.test.mjs.
**Produces:** explicit session.stopped and completed goal numbers; `not-started` summary rows, distinct from actor verdicts.

- [ ] Write a money/data guard reproducing an unfunded later goal and an interrupted goal; expect a budget stop, no final-verdict credit, and distinct missing rows. Run and see failure.
- [ ] Implement explicit stop selection and completed-goal tracking. Render markdown against the real saved run record.
- [ ] Run the affected scripted tests.

### Task 2: Continuity and checkpoint

**Files:** desktop/e2e/lib/agent-plan.mjs, agent-nightly.mjs, agent-nightly.mjs entry point, suites/agent.mjs; existing pool tests.
**Consumes:** Task 1 completed/unfinished state.
**Produces:** pending.json on the memory branch; only a completed plan writes last.json.

- [ ] Write a data guard for a partial publish preserving the old checkpoint while saving pending work; a later completed run clears the queue and advances it. Add a current-palette ordering/dedup case.
- [ ] Implement pending priority, terminal-only coverage, partial memory publication and conditional checkpoint writing. Preserve chain/replay isolation.
- [ ] Run the focused guards and a scripted round trip.

### Task 3: Verification, accounting, video

**Files:** desktop/e2e/lib/explore.mjs, agent-run.mjs, agent-run-record.mjs, agent-session.mjs, suites/agent.mjs, .github/workflows/ai-user-agents.yml.
**Produces:** final observation-only verdict turn within existing caps; optional cost.countedTokens/capTokens; manual-only video default.

- [ ] Write a money/safety guard for a goal at its last turn: observe the changed page, allow done, refuse mutation, no extra call beyond its allowance. Run and see failure.
- [ ] Implement final-turn restriction, export metered cost beside gross, and enable recording by default only for unscheduled dispatches.
- [ ] Run focused guards; render a saved example summary; inspect workflow conditions for manual-on/manual-off/scheduled cases.

### Task 4: Review and shipping

- [ ] Delegate web compatibility/labels/preview to rw with the exact additive contract in the spec.
- [ ] Obtain independent review from rw of public changes once it can do so; address substantive findings together.
- [ ] Run changed-file lint, focused checks and fast ship gate, update progress proofs, open public PR with web merge ordering explicit. Watch current-head CI/review to exact readiness.
