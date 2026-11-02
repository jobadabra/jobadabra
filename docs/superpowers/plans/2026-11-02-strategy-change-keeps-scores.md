# A strategy change keeps your scores and asks you to re-score

Owner, 2 Nov 2026: "I don't think we should clear all the scoring instantly, but rather show a stale/warning message… a very visible call to action on the jobs list to rescore… but still, there should be the old scored." And: "Find jobs should be only for finding jobs. But pressing Find jobs should open a dialog saying: Score first, and another card/loading should be shown."

## Progress
- [ ] 1/2 The engine refuses a run from an app older than it; Jobs shows a Restart card (cause of the owner's screenshot: his open app predated the #2926 env rename)
- [ ] 2/2 Old scores stay on every row marked "scored with the previous strategy"; Jobs carries a re-score call to action with its own card and loading; Find jobs with stale or missing scores opens a "Score first" dialog; the Strategy notice and the Jobs call say the same thing (one stale counter, `#jobs-unscored` callout reused)
