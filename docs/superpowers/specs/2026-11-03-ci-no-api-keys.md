# CI and e2e take no AI API keys: everything goes through the AI broker

> 🟢 **Verdict:** the e2e lane already runs on the broker (`CI_AI_PROVIDER=codex` since 29 Oct 2026); what is left is the key plumbing and the `claude` option that still reads a paid key. Five PRs remove them, with a guard so one cannot come back. Nothing the owner sees changes; the Anthropic bill for CI goes to $0.

Owner, 3 Nov 2026: "We should not use API Keys at all anymore. Everything should be around the ai-broker." (relayed by the coordinator; e2e lane answered "Yes, all on the broker relay (Recommended)").
Already on main: prompt cases and review-eval (#3103). In review: refill (jobadabra #3111), the lab's three AI jobs (lab #75).

## Design

States and their one owner: **the provider of a CI run** is `codex` or `free`, decided by `lib/ai-provider.mjs` (`E2E_AI_PROVIDER` → `E2E_AI_PROVIDER_<CONSUMER>` → repo variable `CI_AI_PROVIDER` → `free`). `claude` is no longer a CI value: a Mac (no `CI`) keeps using its own Claude Code, which is a login and not a key.

- **Keys:** no workflow, action or harness file names `E2E_ANTHROPIC_KEY`, `E2E_OPENAI_KEY` or `LIVE_POOL_ANTHROPIC_KEY`; the app under test in CI gets `DUMMY_KEY` and the relay's address, as it already does under codex.
- **Steps gated on "the key is set"** (AI-answer cache, hand-over of a PR's answers to main, the `/ai-cost` report) are re-gated on what they need: the two cache restores (`Earlier AI answers`, `The merged PR's own AI answers`) lose the key gate and run on every run, because there is nothing to hash before they fill the folder; the trim, save and hand-over-to-main steps keep `hashFiles('desktop/e2e/.ai-cache/*.json')` alone (they already test it); the `/ai-cost` report is removed, because the only kinds it reported (`app`, `app-openai`, `judges` on an API key) can no longer exist and a broker call is not dollars (`app-codex` has its own tally and was never reported there).
- **Judges** stay on Haiku 5.5 through the broker (`test_e2e_judge_model.py`), so the model rule holds.
- **The OpenAI "other family" turn** (`pickFamily`, `E2E_OPENAI_KEY`) goes only after its broker calls a day are measured and a8 agrees; until then PR 5 does not start.
- **Safety:** tests still never reach a real key or the production AI account (`ai/no-local-key.test.mjs`, `harness/launch-secrets.test.mjs`); removing keys can only help.

Verdicts that change state: a CI value of `claude` is an error (`aiProvider` throws, as it does for any unknown value); a step that needs AI and finds the broker refused is said and skipped (`lib/ai-cap.mjs`), never moved to another provider.

## Plan

| PR | What | Proof |
|---|---|---|
| 1/5 | this spec | review by a8 (e2e owner) |
| 2/5 | `e2e.yml`, `e2e-windows.yml`, `desktop.yml`: no key env or secret names, cache steps re-gated, `/ai-cost` report removed | one CI run where each re-gated step ran (not skipped) |
| 3/5 | `lib/engine.mjs`, `ai-provider.mjs`, `context.mjs`, `pool-ci.mjs`, `key-check.mjs`, `live-row.mjs`: `claude` leaves CI's providers, key helpers go | `app/engine.test.mjs`, `replay/offline-ai.test.mjs`, `pool/pool-ci.test.mjs` and the no-live-AI tests |
| 4/5 | the e2e-review action's `anthropic-key` input, `record-sites.yml`, `watch-live.yml`, `review-eval.yml`; class guard over all of them | `test_ci_no_anthropic.py` (in tests/tooling/ci/ once #3110 lands) |
| 5/5 | the OpenAI family turn, after the measurement | broker calls a day per workflow, a8's yes |

The owner deletes the secrets afterwards by hand (never an agent), once each family has had a green run: `E2E_ANTHROPIC_KEY`, `E2E_OPENAI_KEY`, `LIVE_POOL_ANTHROPIC_KEY`.

## Progress

- [ ] refill (#3111) and the lab jobs (lab #75) in review; prompt cases and review-eval (#3103) already on main
- [ ] 1/5 this spec
- [ ] 2/5 workflows
- [ ] 3/5 harness
- [ ] 4/5 action, record-sites, watch-live, review-eval, guard
- [ ] 5/5 OpenAI family turn (after the measurement)
