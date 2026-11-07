# The AI persona finishes the goals it starts (short name pz)

Owner, 7 Nov 2026: "what can we improve on the AI persona?" · "Should we have more runs?" → "Fix first, then more runs". Sketch: https://claude.ai/artifact/NbwL86qG69kcnbX19xavxK. Work board draft: "AI persona: finish its goals, then more runs". No run is added and the cron is unchanged; the owner decides 2-3 night runs only when over 50% of goals work.

Measured (31 runs, 7 Nov 2026): 17 of 122 goals worked; 43 never started (plan outgrew the 250k cap), 22 "couldn't reach" a screen, 12 broker failures, 9 out of steps, 7 token cap mid-goal, 12 doubts or loops.

## Progress
- [ ] 1/5 Plan the goals from the token budget (`goalCountFor`, `planSession` ceiling)
- [ ] 2/5 A call that fails on Codex goes on on Claude (`withFailover`)
- [ ] 3/5 Sort the 22 "couldn't reach" goals: app bug → filing path, agent gap → fix the agent's tools
- [ ] 4/5 Persona bugs file through the tester-mode path of #3441 (evidence bundle, repeats join the first issue, low not filed)
- [ ] 5/5 jobadabra-web: the headline counts "not started" apart from "attempted but unfinished"
- [ ] Report the before → after goal rate from the next night to the coordinator
