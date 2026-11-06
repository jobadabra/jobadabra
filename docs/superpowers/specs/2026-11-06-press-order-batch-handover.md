# A Find jobs press scores the nearest jobs as their batches land (#2918, 6 Nov 2026)

Owner, 5 Nov 2026: "One clear order first (Recommended)", "One shared queue, as its own PR (Recommended)". 6 Nov 2026: "Score from the nearest batches as they land (Recommended)".

## Verdict
- 🟡 Built and unit-tested; **not yet measured** (the ship bar below is open). Do not merge before the four-city measurement.
- 🟢 Goal: the first job waits for ONE batch of titles, not a reader's whole sort; EURES's jobs near home reach scoring in a press.

## Design: states, their one owner, the verdicts that change them
| State | One owner | Changes when |
|---|---|---|
| Titles waiting | `src/ai/title_queue.py` (one heap for every reader, nearest place first, all workers at NORMAL) | a reader hands its batches; a worker asks the nearest |
| A batch landed | the reader's own thread (it holds that reader's views, `batch_scope.using`) | the AI answers; a fitting job is handed to scoring |
| Jobs imported + scored | the hub: the slice's main thread, owner of the job store (`first_jobs._Readers`, `_Scoring`) | each hand-over, each reader that has read |
| Press clock | `time_budget` (unchanged) | the refresh's end |
Batches stay per reader (tape/replay, owner 18 Oct 2026, `test_triage_batch_order`); the queue only orders which batch is asked next.
**Cause (measured):** EURES was taken only past the press's time (0 of 8 scored); a first job waited for a reader's whole title sort (Copenhagen's employer sort ended at 92 s).
**Cost:** a reader's far batches wait behind another's near ones. **Risks:** the tape key `key=batch[0]`; `scout_probe` also calls `feeds.triage` (no budget).

## Progress
- [x] Queue + hand-over: `title_queue.py`, `title_triage.decide(nearness, land)`, `feeds.triage`, `feed_scan.scan(on_sorted)` (proof: tests/unit/ai/test_title_queue.py)
- [x] Hub: `first_jobs.run` (`_Readers`, `_Scoring`, `_Imports`), `aggregators.early_items` / `kept(shown)`, EURES early (`eures.early`, `aggregators.TAKEN`) (proof: tests/unit/sources/test_first_jobs_hub.py)
- [x] Tests: `test_title_queue` (fails on main 0/25, passes 25/25 here), `test_first_jobs_hub`, siblings adapted (scan fakes take `**kw`) (proof: tests/unit/ai/test_title_queue.py)
- [x] Sibling files by importer: 122 + 47 + 50 + 81 tests green (two fakes needed the new keyword arguments) (proof: tests/unit/sources/test_first_jobs_slow_boards.py)
- [ ] Measure 3 first presses per city on a quiet machine (before: Toulouse 82–86 s / 6 scored, Copenhagen 74–79 / 9, Valencia 81–126 / 3–6, Paris 70–74 / 9); EURES scored > 0 in Toulouse and Paris
- [ ] FULL=1 run per city on main and on the branch: relevant local jobs, scored, 70+; the branch at least main's in every city
- [ ] Report AI calls per press before/after and early-handed jobs the final pass drops
- [ ] One fresh `/code-review` ("does the test play the owner's scenario; which existing test asserts the opposite?" — `test_ai_slots` asserted FIRST for title calls; rewritten to NORMAL)
- [ ] One city outside the range = report, no PR; stop at the first failed measurement
