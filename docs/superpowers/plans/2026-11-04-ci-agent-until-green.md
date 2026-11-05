# The CI agent that goes until green (plan)

Session hm, 4 Nov 2026. Spec: `docs/superpowers/specs/2026-11-03-ai-fixer-core-design.md` (section "Amendment 4 Nov 2026"). Sketch: https://claude.ai/artifact/965NLqUUEdcMDGAXFPTUuy (the harness map sketch; this plan's own sketch is linked in PR 1/6). Each PR is titled `[hm] n/N <what>`. Seven PRs since 4 Nov 2026 (the run record became its own PR, 5/7); the admin group below is numbered apart (`web n/3`, private repo `jobadabra-web`).

> **Verdict:** one agent fixes one item (a feedback card or a Linear issue), opens a draft PR, then keeps working that PR (red checks, comments, conflicts) the way `tools/ship.sh` does, until READY or one hour. Built in 7 PRs; the first two real runs are the evaluation.

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
| 4/7 | The until-green chain: `ai-fixer-follow.yml` (watches the PR with `ship-watch.sh`, new switch `SHIP_WATCH_DRAFT_OK=1`: READY for a PR that stays a draft), rounds of `ai-fixer.yml` on the PR's own branch, `tools/fixer/driver.mjs` rules, comment and log handling, the 1 h cap | The PR goes on to READY without a session | `/code-review` |
| 5/7 | Every fixer run writes a record (`ai-fixer-record` / `record.json`, schema v:1): what happened, steps, the agent's reason, errors | The owner can see WHY a run ended (run 1 ended needs-human with nothing in the log) | `/code-review` |
| 6/7 | First until-green run on a feedback card; cost shown and the owner's yes BEFORE it starts | The owner sees how the agent does | report only |
| 6b/7 | A refused action the agent can recover from does not end the run: walls stay final, the other refusals say how to try again, each refusal is one fixed word on its step | Run 41946389132 (issue #3180, 5 Nov 2026) ended `needs-human` after 4 turns / 4 broker calls: one refused search was read as final | the loop test plays that run |
| 6c/7 | A red proof names its failing tests: desktop and Python run as separate steps, their output goes through the redactor and a redacted log is kept even on failure (built by another pane) | The next red proof says which test failed (run 41948712197 left no output) | report only |
| 7/7 | Run on a Linear issue; harness map 8/8 (none, map, map+pack) on the same driver; one table | A measured yes or no, for the agent and for each map layer | report only |

### Admin: Agent harness tab (`jobadabra-web`, private repo, pane hm-ai-harness-tab; numbered `web n/3`, so the CI plan's N stays 7)
| n/3 | What | Who gets what |
|---|---|---|
| web 1/3 | One agent card per row of the registry on /admin/ai/agents | The owner sees every agent on one page |
| web 2/3 | The tab "Agent harness": a card per run, reading the run record of 5/7 (site side first, empty state until data) | The owner reads what each run did |
| web 3/3 | The public-repo upload of the records and of this plan's progress to the site | The page fills itself |

### The card button starts this agent (owner, 5 Nov 2026, "Button starts the new agent"; numbered `web n/5`, apart from the N above)
| n/5 | What | Who gets what |
|---|---|---|
| web 4/5 | The site also trusts `ai-fixer.yml` for a card's brief and its pr / none / failed report (`jobadabra-web`) | The first card run of the agent can read its card |
| web 5/5a | The fixer reports back to the card in fixed words; its draft PR's merge or close reaches the card; a round does not re-read the brief (this repo) | The owner's card shows what the agent did instead of hanging an hour |
| web 5/5b | The site recovers a failed or refused run: a card whose run the fixer's guard refused (`cap` / `busy`) or whose GitHub run failed goes back to `new` (`jobadabra-web` #394, built by another pane) | A busy day does not leave a card in "AI running" for an hour |
| web 5/5 | "Send to AI" starts `ai-fixer.yml` instead of `feedback-ai.yml` (`jobadabra-web`) | The owner's click runs the new agent |

## Order and dependencies
- 2/6 and the spec first; 3/6 needs 2/6; 4/7 needs 3/6; 5/7 starts from merged 4/7; 6/7 needs 5/7 and a feedback card handle; 7/7 needs an `ai-ready` or an owner-named JOB issue.
- 2/6 runs in a pane (slot 1) while this spec waits for the owner.
- The PostHog key (harness map) is not needed for the first runs; the pack reads Linear, GitHub and Sentry today.

## Not PRs
- The owner's yes on this spec and sketch before 3/6 starts.
- The cost shown before 6/7 and 7/7 (about 20–50 broker calls for round 1, 10–20 per later round).
- Pick the tasks of 6/7 and 7/7 inside the walls (`EDITABLE`: src, desktop/renderer, desktop/lib and their tests): run 1 (Linear JOB-271) ended `needs-human` because its fix lives in `tools/`, which the walls deny.
- `/resolve JOB-n` in `jobadabra-web` (`api/brain.js`) stays a later PR there.

## Progress
- [x] 1/7 This plan and the spec amendment (proof: docs/superpowers/specs/2026-11-03-ai-fixer-core-design.md)
- [x] 2/7 Move walls, proof, leaks, publish into `tools/fixer/` (proof: tools/fixer/walls.mjs @6e998e2)
- [x] 3/7 Loop, Feedback and Linear sources, one-run workflow (proof: desktop/test/tooling/ci/fixer-loop.test.js @5766dddb)
- [x] 4/7 Until-green chain: follow job, rounds, stop rules (proof: tools/fixer/driver.mjs @a42e9ee)
- [x] 5/7 Every fixer run writes a record (proof: tools/fixer/record.mjs @4d34185)
- [ ] 6/7 First until-green run on a GitHub issue (run 1: site 401; run 2, issue #3180: needs-human after one refused search, 4 broker calls)
- [x] 6b/7 A refused action the agent can recover from does not end the run (proof: none: jobadabra #3211, merged 55d440b)
- [x] 6c/7 A red proof names its failing tests (proof: none: jobadabra #3233, merged 2618e19)
- [ ] 7/7 Run on a Linear issue and the harness map evaluation

Admin group (private repo `jobadabra-web`, numbered apart):
- [x] web 1/3 One agent card per row on /admin/ai/agents (proof: none: jobadabra-web #366, merged b29cabc)
- [x] web 2/3 The tab "Agent harness" with a card per run (proof: none: jobadabra-web #367, merged a5f9c3c)
- [x] web 3/3 Upload of the records and the plan progress to the site (proof: tools/harness-stats.mjs @ca38e8e4)
- [x] web 4/5 The site also trusts ai-fixer.yml for a card (proof: none: jobadabra-web #388, merged 700fb1b)
- [x] web 5/5a The fixer reports back to the card (proof: none: jobadabra #3223, merged 3a69e74)
- [x] web 5/5b The site recovers a failed or refused run (proof: none: jobadabra-web #394, merged 74c2012; built by another pane)
- [x] web 5/5 The button starts ai-fixer.yml (proof: none: jobadabra-web #389, merged de1cb49)
