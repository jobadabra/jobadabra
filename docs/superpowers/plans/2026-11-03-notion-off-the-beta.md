# Notion off the beta: e2e on this Mac's store, the Notion path on its own run, saves Notion first (a8, 3 Nov 2026)

The owner's decisions, 3 Nov 2026, after main's strategy red (run 41537996714: a Focus pull wrote the Notion page over a place just saved here, "−lugano"):
- E2E store: "1. Mac Store only. But, separately, we should add or create a workflow/schedule to test the Notion Path properly and fully. It can be a separate e2e journey/suite/worfklow just for the notion which wil be Notion-only."
- When the Notion path runs: "Its own workflow and timer".
- The race: "1. Notion first, then here. but while we write to notion First, we should add some loading in the UI state. We should provide feedback to the user on what's happening to avoid freeze or glitches feeling."
- PRs 3–4 in a new session: "Yes, start it (Recommended)".

Sketch: https://claude.ai/artifact/BGRbFdCfRGdoFXLGZ23GGq.

| PR | Who | What the owner gets |
|---|---|---|
| 1/4 | a8 | The beta, main's runs and the night burn-in test on this Mac's store only: no run alternates to the Notion stand-in, no "-standin" twin job |
| 2/4 | a8 | The Notion path: its own workflow and timer, report only (every Tier 1 suite on the Notion stand-in, plus notion-real); never blocks a beta or turns main red |
| 3/4 | ns | A settings save writes Notion first, then this Mac: a pull during a save never loses it, a refused page write leaves both as they were |
| 4/4 | ns | While Notion is written the control says Saving…, then Saved, or "Couldn't save to Notion" with Retry |

Strategy's steps that run only on Notion (`onNotion` in `desktop/e2e/suites/strategy.mjs`) stay in the suite: PR 2's Notion run plays them.

## Progress
- [x] 1/4 E2E runs on this Mac's store only (proof: desktop/e2e/test/harness/plan-run.test.mjs)
- [ ] 2/4 The Notion path: its own workflow and timer, report only
- [ ] 3/4 Saves write Notion first, then this Mac
- [ ] 4/4 The screen says Saving to Notion…
