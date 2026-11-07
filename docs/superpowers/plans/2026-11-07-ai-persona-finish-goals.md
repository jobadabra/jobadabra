# The AI persona finishes the goals it starts (short name pz)

Owner, 7 Nov 2026: "what can we improve on the AI persona?" · "Should we have more runs?" → "Fix first, then more runs". Sketch: https://claude.ai/artifact/NbwL86qG69kcnbX19xavxK. Work board draft: "AI persona: finish its goals, then more runs". No run is added and the cron is unchanged; the owner decides 2-3 night runs only when over 50% of goals work.

Measured (31 runs, 7 Nov 2026): 17 of 122 goals worked; 43 never started (plan outgrew the 250k cap), 22 "couldn't reach" a screen, 12 broker failures, 9 out of steps, 7 token cap mid-goal, 12 doubts or loops.

## Progress
- [x] 1/5 Plan the goals from the token budget (`goalCountFor`, `planSession` ceiling) (merged #3451) (proof: desktop/e2e/test/pool/agent-plan.test.mjs @f5445dbb)
- [x] 2/5 A call that fails on Codex goes on on Claude (`withFailover`) (merged #3453) (proof: desktop/e2e/test/pool/agent-ask.test.mjs @9d6f627f)
- [x] 3/5 Sort the 22 "couldn't reach" goals: app bug → filing path, agent gap → fix the agent's tools (merged #3454: the persona sees Settings sections and can open Reports) (proof: desktop/integration/extension/explore-closed-folds.test.mjs @576ff943)
- [x] 4/5 Persona bugs file through the tester-mode path of #3441 (evidence bundle, repeats join the first issue, low not filed) (merged #3456) (proof: desktop/e2e/test/pool/agent-notes.test.mjs @c18c2ef0)
- [ ] 5/5 jobadabra-web: the headline counts "not started" apart from "attempted but unfinished" (jobadabra-web #480 merged and shows partial goals; whether its headline wording is this item was not re-checked, so left open)
- [ ] Report the before → after goal rate from the next night to the coordinator

After 1/5-4/5 the persona work continued outside this list: lanes (#3522), closed-verdict knowledge (#3555), the stricter judge hold (#3559); the persona completion spec is [`../specs/2026-11-07-persona-completion-design.md`](../specs/2026-11-07-persona-completion-design.md) (a different spec: stop and goal states, token labels).
