---
area: ai
paths: [src/ai, desktop/lib/ai, desktop/lib/ai-caps.js, desktop/lib/ai-free.js, desktop/e2e/lib/broker-client.mjs, desktop/e2e/lib/ai-provider.mjs, desktop/e2e/lib/ai-cap.mjs, tools/prompt-cases.json, tools/prompt-cases.mjs, tools/free-ai-eval.mjs]
updated: 2026-11-03
---
# AI: the user's engines, prompts and the CI broker
> Two AI worlds. In the app, the person's own engine (Claude plan or CLI, their key, Codex or OpenAI, or Free AI) sits behind one contract. In CI, every call goes through ONE broker that answers on the owner's Codex plan.

## Rules
- The AI decides what content means, in any language; code fetches, validates and keeps safe. No keyword list stands in for a judgment (a word list is only the offline floor). A busy or capped AI leaves the item unknown, never a default guess (`src/ai/decide.py`, `meanings.py`).
- One contract for every engine (`desktop/lib/ai/contract.js`, mirror `src/ai/providers/`); a new engine is one adapter file plus one row. Nothing switches by itself: a fallback is another engine of the SAME family, billed, only on the user's own tick.
- A prompt is a public skeleton plus a learned layer: fixed words in, engine-written sentences out (`src/ai/hints.py`); the server never sends text that becomes prompt text.
- A prompt change adds its case to `tools/prompt-cases.json` and replays the whole set (gate `tools/prompt-cases.mjs`); an improvement for one case is measured on the whole fixed set.
- Ask the owner before spending money on AI (a new model, a large re-run) and show the measured cost. Evals never use the production AI account (`tools/free-ai-eval.mjs` refuses).
- Every mention of AI credit says what it buys ("about N applications or searches") from one shared measured function.
- CI and scheduled jobs: no AI API key in a job. A job proves itself to the broker with GitHub's per-run token; the Claude tier maps to small, mid, large. A capped or refused ask is said and skipped, never moved to another provider (`desktop/e2e/lib/ai-provider.mjs`, `ai-cap.mjs`).

## Key files
- `desktop/lib/ai/`: the app's engines (`index.js` factory, `contract.js`, one adapter per engine); `src/ai/`: the engine's AI steps, `decide.py` the shared meaning lookup.
- `desktop/lib/ai-free.js`, `ai-caps.js`: Free AI (no key needed) and its per-install lines.
- `desktop/e2e/lib/broker-client.mjs`: CI's side of the broker (the broker itself is in the private jobadabra-web).
- `tools/prompt-cases.json`, `tools/free-ai-eval.mjs`, `tools/prompt-cases-night.mjs`: case sets and measurements (nightly runs report only).
- More: `node desktop/scripts/codemap.mjs ai broker decide`.

## Live specs
- [CI on the Codex subscription](../superpowers/specs/2026-10-28-ci-on-codex-subscription-design.md): the broker and moving each CI job onto it.
- [AI fixer core](../superpowers/specs/2026-11-03-ai-fixer-core-design.md): the agent loop that calls the broker 20 to 50 times per fix.
- [Desktop AI through MCP](../superpowers/specs/2026-11-03-desktop-ai-mcp-design.md): a local MCP server so a person's Claude desktop app can help.

## Ask the sources
ask: cloudflare analytics worker=ai-broker days=7
ask: github issues label=ai-budget state=open
ask: posthog events event=ai_limit days=7

## Lessons
- Count calls, not rows: `decide()` sends up to 50 items per call, so a `decisions` row is one judged item. Read cost per step before naming the biggest spender.
- When a shared cap starves a late stage, give that stage its own allowance instead of raising the cap.
- An e2e gate on AI output gets its allowance from a measured per-item rate on fresh draws (healthy against broken); a replayed answer can never test stability.
- Quality before cost: a cheaper judge that was right 52% of the time against 84% was dropped. Lead with the right percentage.
- CI on Free AI once billed about $4 a day unseen: that is why CI has a day cap and a single provider switch.

## Go deeper
[AI ladder](../superpowers/specs/2026-10-10-ai-ladder.md) · [AI escalation](../superpowers/specs/2026-10-08-ai-escalation.md) · [files and prompt comments](../rules/files.md) · [CLAUDE.md](../../CLAUDE.md)
