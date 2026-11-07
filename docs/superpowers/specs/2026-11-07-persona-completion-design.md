# AI persona: useful partial runs and honest completion

The owner approved all five improvements after run 42327808352: completion reporting, unfinished-goal continuity, verification room, token labels, and video for manual investigations. Start with completion and continuity, which recover coverage without raising AI spend.

## Problem and evidence

Run 42327808352 reached 2 of 8 goals, attempted 2 others, and never started 4. Its token planner logged that goals 5–8 could not be funded, but exported `stopped: goals` and published `last.json`. Thus an incomplete night advanced the changed-since checkpoint. Job preferences used its final turn on Done without a final observation/verdict. Reports mix 373,705 gross tokens with 159,561 counted against a 250,000 cap. Manual recording defaulted off.

## Approach

Extend the current run, memory, and Admin contracts. Keep the existing budget meter and actor safety checks. Alternatives considered: raising the cap would spend more without fixing false completion; automatically chaining every night would introduce extra runs and state restoration. Neither is needed. The owner chose the five targeted improvements above; routine implementation choices below belong to the coordinator.

## Observable behavior and acceptance

1. A run exports its real stop reason: completed goals, insufficient remaining token budget, calls, minutes, or broker failure. A goal never started has verdict `not-started`; an attempted goal without a final verdict remains `could-not-finish`. The actor cannot claim `not-started` itself.
2. Partial nights publish their useful notes and pending goal identities, but preserve the last fully completed night's changed-since checkpoint. Coverage includes only goals whose actor returned a final verdict, not interrupted or unstarted goals. Pending goals receive priority next night against the current palette; removed goals are discarded, duplicate goals are suppressed. A new night uses fresh fictional state and starts these goals anew; it never pretends to restore a prior night's data. Existing explicit same-commit snapshot chains retain their separate behavior.
3. Budget/call/time-interrupted goals precede unattempted goals in the next plan. An actor-declared inability to finish remains pending after unattempted work, so one inaccessible goal cannot permanently prevent untested areas from being explored. No new workflow dispatches or AI calls are triggered by the memory queue.
4. The agent reserves its final allowed turn for observing the result and returning a verdict. That turn permits `done` only, does not mutate the app, and remains inside the existing step/call/time/token limits. An unsuccessful final verification is reported honestly, never automatically marked worked.
5. Markdown and Admin distinguish gross input-plus-output tokens from tokens counted against the unchanged 250,000 cap. New run records retain `cost.tokens` as gross for compatibility and add optional `cost.countedTokens` and `cost.capTokens`. Older records remain readable without invented metered values.
6. Manual workflow runs record video by default; a person can turn it off. Scheduled runs keep recording off. Existing size limits, retention, fictional data, and upload authentication remain unchanged. No retrospective video is invented.
7. Admin run and list views include not-started goals, partial coverage, and readable stop reasons. Legacy zero-step goals explicitly saying the session ended before the goal can be shown as not started, without rewriting stored evidence.

## Ownership and delivery

- Coordinator: public runner, summary, budget-safe verification turn, memory/checkpoint/planner, record fields, manual video workflow.
- Existing rw Luna pane: web Admin rendering/metadata and actual rendered before/after screenshots; no public runner edits. Existing eg pane retains PR #3429.
- Two PRs: web compatibility/reporting first; public runner improvements second. Owner merges both. No merge, live model rerun, or production deployment without the corresponding existing authorization.
- UI commit waits for approval of actual screenshots opened in Preview. Internal runner work can proceed meanwhile.

## Constraints and non-goals

Tier 1, offline scripted regression checks and the normal fast gate only. Never Submit, never access real applicant data or the owner's app, never make paid/model calls locally. No higher token cap, new model tier, automated chain, cross-night snapshot, release gate, or broad refactor. New harness tests must guard money or data integrity; formatting changes are verified by rendering the tool once.

## Progress

### 1. Persona coverage and evidence

- [x] Capture the owner's approved scope and measured failure (proof: none: owner approved all five improvements in chat on 7 Nov 2026)
- [x] Accurate stop and goal completion states (proof: desktop/e2e/test/pool/agent-steps.test.mjs)
- [x] Pending goals and checkpoint integrity (proof: desktop/e2e/test/pool/agent-completion.test.mjs)
- [x] Final verification within existing limits (proof: desktop/e2e/test/pool/agent-completion.test.mjs)
- [x] Gross and counted token labels (proof: desktop/e2e/lib/agent-run-record.mjs)
- [x] Manual video default (proof: .github/workflows/ai-user-agents.yml)
- [ ] Admin preview approval and compatibility PR
- [ ] Focused checks, review, fast gate, and public PR
