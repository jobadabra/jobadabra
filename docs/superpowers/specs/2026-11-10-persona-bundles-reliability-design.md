# Persona evidence and useful work per token

Owner, 10 Nov 2026: finish the persona bundle integration, make the tester more reliable, and target one confirmed bug per 100k tokens. This extends the approved 7 Nov tester-bug design; no new approval or paid investigation is needed for implementation.

## Design

Use the existing app tester IPC and store, not a second uploader. A note captures an immutable, bounded main-process snapshot before the agent moves on. After deduplication and judgment, selected notes send that snapshot. Failed uploads keep the note with an explicit error; they never fall back to real-user feedback. Replays neither upload bundles nor receive the publisher key. The Finder keeps the bundle link through normalization and into the issue; GitHub remains the tracker.

The existing independent screen read also verifies completion from observed steps and state. Unknown or incomplete evidence never counts as worked. A bug verdict without an argued note is downgraded. The language goal must show the requested locale on every requested page. The app's safe file picker is primed with the fictional CV before acting, and empty job state is recorded for the planner to avoid unsupported document-producing goals. These are test capabilities, not relaxed safety filters.

Keep the 250k incremental token ceiling and also enforce 250k gross across actor, reader and judge. Scope knowledge to the goal's areas, omit duplicate screen findings before judging, and do not spend judge calls on low notes that cannot be filed. Never change the approved disagreement/closed-verdict filing rule. The target is confirmed bugs per all workflow tokens, not candidate-note count; it must be measured on future scheduled runs, never claimed from fake-model tests.

## Approaches

Chosen: extend the existing tester handlers and persona loop. A separate direct uploader would duplicate redaction and drift from the twin. Hiding gross usage or counting candidates as confirmed would improve the number without improving the tester and is rejected.

## Progress

### 1. Per-note bundles
- [x] Capture isolation, credential boundary and end-to-end finding link verified (proof: desktop/e2e/test/pool/agent-bundles.test.mjs).
### 2. Reliable completion
- [x] Unsupported and unverified success claims rejected; prerequisites handled (proof: desktop/e2e/test/pool/agent-run.test.mjs).
### 3. Cost
- [x] Gross cap and avoidable duplicate calls verified with offline inputs (proof: desktop/e2e/test/pool/agent-tier.test.mjs).
### 4. Delivery
- [ ] Focused checks, independent review, and PR handoff.

No new schedules, paid model runs, auto-closing issues, or dashboard redesign. Old run artifacts are not reconstructed as contemporaneous bundles.
