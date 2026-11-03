# A strategy change keeps your scores and asks you to re-score

Owner, 2 Nov 2026: "I don't think we should clear all the scoring instantly, but rather show a stale/warning message… a very visible call to action on the jobs list to rescore… but still, there should be the old scored." And: "Find jobs should be only for finding jobs. But pressing Find jobs should open a dialog saying: Score first, and another card/loading should be shown."

## Progress
- [x] 1/2 (#3015, merged 2 Nov) The engine refuses a run from an app older than it; Jobs shows a Restart card (cause of the owner's screenshot: his open app predated the #2926 env rename) (proof: desktop/test/jobs-outdated-card.test.js @194e773a)
- [x] 2/2 Old scores stay on every row marked "scored with the previous strategy"; Jobs carries a re-score call to action with its own card and loading; Find jobs with scores from the previous strategy opens a "Score first" dialog (jobs not scored at all are not held); the Strategy notice and the Jobs call say the same thing (one stale counter, `#jobs-unscored` callout reused) (proof: desktop/integration/store/stale-scores-stay.test.mjs)

## What 2/2 built (3 Nov 2026)
- Engine: `src/desktop_strategy.py` `mark_outdated` puts `stale` on each Jobs row (by URL: a store's rows carry no job id) and Strategy's own `outdated` summary on the payload; called from `src/desktop.py` `_jobs`. Nothing clears a score.
- One state owner `desktop/renderer/pages/rescore-run.js` (the count and "a re-score runs"; `<body data-rescoring>`); one sentence `renderer/rescore-words.js` for Strategy's notice, Jobs' call and the Score-first dialog.
- Jobs: the `#jobs-unscored` callout is the one call (`pages/jobs-score-call.js`), `#rescore-card` the re-score's own card, rows keep the old fit muted with "Old score"; `startSearch` is the one gate: a plain Find jobs press asks "Score first" (`pages/score-first.js`).
- Tests: `tests/unit/ai/test_strategy_outdated.py`, `desktop/test/unit/renderer/rescore-call.test.js`, `desktop/integration/store/stale-scores-stay.test.mjs` (real engine and store), `desktop/integration/app/screen-jobs-rescore.test.js` (the window).

