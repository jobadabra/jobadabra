# Tier 1 journeys: LinkedIn out, seven journeys in (a8, 2 Nov 2026)

The owner's decisions came through mac-07 on 2 Nov 2026, with the owner's own answers: "3 PRs (Recommended)" and, for J2, "Yes, add it (Recommended)". The beta keeps only the journeys that block the person's flow. LinkedIn goes to integration, and seven journeys get a thin e2e path inside suites that already run. Sketch: https://claude.ai/code/artifact/564d306a-77df-4da3-bbf0-199b4335065e.

| Journey | Before | After | e2e path |
|---|---|---|---|
| J4 LinkedIn | Tier 1, its own suite | Tier 2 | none: 7 integration tests (`desktop/integration/app/linkedin-read.test.js`) |
| J14 Profile | Tier 1 | Tier 1 + 1 step | settings: an Experience edit reaches the extension |
| J2 Find jobs | Tier 1 | Tier 1 + 1 step | jobs: the list shows each job's fit score, best first |
| J36 Pairing | Tier 2 | Tier 1 | apply: a web page cannot pair · the extension pairs and the app sees it · a lost pairing is repaired |
| J9 Applied → In process | Tier 2 | Tier 1 | apply: right after "becomes Applied" |
| J29 + J8 Prepare a job | Tier 2 | Tier 1 | apply: Prepare gives its answers, CV and letter (stand-in AI) |
| J20 + J37 AI choice, credit | Tier 2 | Tier 1 | settings: choose the AI; the credit line says what it buys |

Each new step gets its registry entry and its integration counterpart in the same PR. Each PR body shows the beta's wall time before → after. If it grows by more than about 5 minutes, mac-07 gets the numbers first.

## Progress
- [x] 1/3 LinkedIn leaves the beta: its seven steps become integration tests, J4 → tier 2 (proof: desktop/integration/app/linkedin-read.test.js)
- [ ] 2/3 Experience edit (J14), pairing (J36) and In process (J9) in the beta
- [ ] 3/3 Prepare a job (J29 + J8), choose the AI and its credit line (J20 + J37), and J2's on-screen fit order
