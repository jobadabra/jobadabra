# Find jobs: more AI answers inside the 3 minutes ([as], 11 Nov 2026)

> **Verdict:** two engine PRs ask the AI fewer, fuller times; the CI broker gets 1 CPU (jobadabra-web#554). No prompt-free shortcut skips the AI.
> Owner (11 Nov 2026, via sa): "Start an Opus session to fix this. To optmise this… You tell me". Sketch: https://claude.ai/artifact/PjxXbsmn1xTysqsCVzbyxA

## What was measured (night 42927975750, 14 fictional people)
| Fact | Number |
|---|---|
| decide calls | 186, ~10 s each on the CI broker |
| same question asked again by one person | "job site kind for a field" 2–9, link-kind 7–10: up to 69 calls could share |
| pool questions (country, metro, region, role, family) | 5 separate calls per person, asked together |
| broker call | 10.6 s = Codex start-up 6.0 s (¼ CPU) + model ~3.5 s |

## PRs
1. **[as] 1/2** decide() joins the same question asked within 0.3 s into one call (`src/ai/decide.py`, `tests/unit/ai/test_decide_join.py`).
2. **[as] 2/2** the 5 pool questions in 2 calls (prompt change: cases in `tools/prompt-cases.json`, whole set replayed).

Outside the count: jobadabra-web#554, broker container 1 CPU / 3 GB (owner asked via AskUserQuestion: "Yes, bigger container").

<details><summary>Not built, and why</summary>

- Haiku thinking off: no switch works reliably today; parked on the Work board ("Find jobs: Haiku still thinks on 79% of AI calls").
- Batches API: answers in up to 24 h, API key only: no fit for a live 3 minutes.
- Free AI for others' small questions: not asked for; Claude stays the replacement everywhere.
</details>

## Progress
- [ ] 1/2 decide joins the same question asked at once
- [ ] 2/2 the 5 pool questions in 2 calls
- [ ] Moves: 3 runs a side of p2, p3, p6, p9, p10, p11, p13 (sa dispatches)
