# The CI agent that goes until green (plan)

Session hm, 4 Nov 2026. Spec: `docs/superpowers/specs/2026-11-03-ai-fixer-core-design.md` (section "Amendment 4 Nov 2026"). Sketch: https://claude.ai/artifact/965NLqUUEdcMDGAXFPTUuy (the harness map sketch; this plan's own sketch is linked in PR 1/6). Each PR is titled `[hm] n/N <what>`.

> **Verdict:** one agent fixes one item (a feedback card or a Linear issue), opens a draft PR, then keeps working that PR (red checks, comments, conflicts) the way `tools/ship.sh` does, until READY or one hour. Built in 6 PRs; the first two real runs are the evaluation.

## Owner decisions (4 Nov 2026)
- "Spin an CI agent to fix a specific feedback and let's see how it performs. It should be able to respond to PR comments, to fix tests, all until it's green. It should follow the local ship.sh approach."
- "We should test both with a Feedback Card and a Linear issue... resolving all the checks, all the PR comments... a max timeout of 1h."
- "It should work with ai-broker, of course, but Sonnet level of intelligence (or ChatGPT alternative to Sonnet)." "you can add a pane here to split the work".
- Standing (3 Nov 2026): "I agree/aprove." the one AI fixer core with an agent loop; the owner merges by hand; ask before spending on AI and show the measured cost.

## PRs
| n/N | What | Who gets what | Review |
|---|---|---|---|
| 1/6 | This plan and the spec amendment | The owner decides the until-green rules before any build | docs-only: skips `/code-review` |
| 2/6 | `tools/fixer/`: walls, proof, leaks, publish moved out of `tools/feedback-ai.mjs` (no behaviour change) | Every source shares one set of safety checks | `/code-review` (trust boundary) |
| 3/6 | `tools/fixer/loop.mjs` (read, search, edit, run_tests, finish), sources Feedback and Linear, `ai-fixer.yml` for one run, Sonnet-level engine pinned | One run opens a draft PR from a card or a Linear issue | `/code-review` |
| 4/6 | `tools/fixer/driver.mjs`: rounds on the PR from `ship-watch` events (new switch `SHIP_WATCH_DRAFT_OK=1`: READY for a PR that stays a draft), comment and log handling, the 1 h cap | The PR goes on to READY without a session | `/code-review` |
| 5/6 | First real run on a feedback card; cost shown and the owner's yes BEFORE it starts | The owner sees how the agent does | report only |
| 6/6 | Run on a Linear issue; harness map 8/8 (none, map, map+pack) on the same driver; one table | A measured yes or no, for the agent and for each map layer | report only |

## Order and dependencies
- 2/6 and the spec first; 3/6 needs 2/6; 4/6 needs 3/6; 5/6 needs 4/6 and a feedback card handle; 6/6 needs an `ai-ready` or an owner-named JOB issue.
- 2/6 runs in a pane (slot 1) while this spec waits for the owner.
- The PostHog key (harness map) is not needed for the first runs; the pack reads Linear, GitHub and Sentry today.

## Not PRs
- The owner's yes on this spec and sketch before 3/6 starts.
- The cost shown before 5/6 and 6/6 (about 20–50 broker calls for round 1, 10–20 per later round).
- `/resolve JOB-n` in `jobadabra-web` (`api/brain.js`) stays a later PR there.

## Progress
- [ ] 1/6 This plan and the spec amendment
- [ ] 2/6 Move walls, proof, leaks, publish into `tools/fixer/`
- [ ] 3/6 Loop, Feedback and Linear sources, one-run workflow
- [ ] 4/6 Until-green driver
- [ ] 5/6 Run on a feedback card
- [ ] 6/6 Run on a Linear issue and the harness map evaluation
