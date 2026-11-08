# Find jobs pipeline: one ranking, one budget table, a fix ledger (short name ps, 7 Nov 2026)

Owner, 7 Nov 2026: "one agent fixes an issue, then comes another agent and tries to improve the speed and mroves that logic" · "we overwrite one another and we never get it right" · "How we can keep reciving fixes/improvements from different sessions, without each of them cancelling the others?" Chosen: "A: pipeline in code + fix ledger (Recommended)". Then: "this is a core part of my app" · "I want it to be a very good and bulletproof algoritm" · "We aim quality, speed and coverage. That's the goal. To find as many jobs, as fast, as qualitive... as possible".

Words (owner, 8 Nov 2026: "Find jobs run / Find jobs pipeline (Recommended)", "Words now, code later (Recommended)"): one press of the button is a **Find jobs run** (the first, a repeat), this plan is the **Find jobs pipeline**, a saved run is a **Find jobs recording** and using one is a **replay**. Code names (`src/press/`, `press-tapes.yml`, the `[ps]` tag) move in one later PR, after a green beta (Work board, Queued).

Research: [Find jobs: why we go in circles](https://claude.ai/artifact/TfcBGHHcxfYHX7JY5RoKkH). Sketch: [Find jobs pipeline: design sketch](https://claude.ai/artifact/3PYGBuB57Vw2PEY4jsjHpM).

## Verdict
- 🔴 Today nobody owns the order of a Find jobs run or its seconds: "places first" was built in 7 places in 20 days, `time_budget.py` had 25 commits in 30 days, 2 of 13 order PRs were measured.
- 🟢 Target: one pipeline module declares the stages; one budget table holds every second; one ranker holds every "X first"; one ledger replays every past fix; one replay yardstick gives three numbers on every pipeline PR.
- 🟡 The yardstick needs new recordings: the 6 Find jobs recordings we have are from 18 Oct, none is one of the 18 night candidates, and a Find jobs recording cannot answer a re-ordered AI batch yet (see Yardstick).

## The objective (owner, 7 Nov 2026), measured per PR, PR vs main
| Number | Definition | Read from |
|---|---|---|
| **Coverage** | right local jobs in the list at the Find jobs run's end (role fits AND located in the person's places; worldwide remote never counts) ÷ the same count of the exhaustive recording (the ceiling) | replay of the 18 candidates |
| **Quality** | of the jobs the Find jobs run scored, the share that are right local jobs (AI spent on the right jobs) | same |
| **Speed** | seconds from the start of the Find jobs run to the first right local job scored 70+ in the list (∞ when none), median of the 18 | same |
A PR that moves one number up and another below its noise band does not merge without the owner's yes, with the three numbers in the question.

## Design: states, their one owner, the verdicts that change them
| State | One owner | Changes when |
|---|---|---|
| The Find jobs run's clock | `src/press/clock.py` (one `Clock`, passed to each stage; built from `SEARCH_AT`) | the Find jobs run starts; nothing else moves it |
| Every second of the 180 | `src/press/budget.json` (data: one row per stage or knob, value, Why, PR) | only a PR whose body carries the yardstick table |
| What is read, asked, scored first | `src/press/rank.py` (named weights; three entry points: sources, titles, jobs) | only a PR that adds or changes a weight, with a ledger scenario and the yardstick |
| Which stage runs, in what order, beside what | `src/press/stages.py` (declared list: name, owner file, inputs, outputs, budget row, runs-beside) | a stage added or moved |
| What each step left for the next Find jobs run | `src/press/resume.py` (`press_left.json`: one count per step, `load_left()` for the planner; counts only, the items stay in their owners' files) | a step says its "Time is up" line; a run that reached its end fills the steps that said nothing with 0 |
| What a past fix guarantees | `tests/unit/press/test_ledger.py` (one named scenario per fix) | a new fix adds one; changing or removing one needs the owner's yes quoted in the PR (`Ledger-change:`) |
Stage files fetch, read, ask the AI and save. They do not sort for priority, read the clock or hold a number of seconds.

## The stages today (from the code, 7 Nov 2026)
One Find jobs run is 180 s (`desktop/lib/search-steps.js SEARCH_BUDGET_S`) over up to four engine processes; the search's own budget is 135 s when the employer finder is due (`SCOUT_SHARE_S = 45`). Every engine stage counts from the start of the Find jobs run (`JOBADABRA_SEARCH_AT`); planned seconds scale by `time_budget.part` (135/180 = 0.75).
| # | Stage | Owner file today | Runs beside | Stops at (135 s search) |
|---|---|---|---|---|
| 0 | Job boards step (discover) | `src/sources/boards.py` | – (own process, first on a normal Find jobs run) | `SHARE_S` 60 → 45 s |
| 1 | Board web search, EURES early | `board_web.early`, `eures.start_early` | everything, from second 0 | read cut |
| 2 | Waiting jobs scored first (#3074; beside the search since E2a-1, 8 Nov 2026) | `daily_search_scoring.score_waiting_first` (own thread, own SQLite connections, AI slots `LATER`) | 3, 5, 6 (joined before the import) | scoring's stop |
| 3 | Employer pick | `employer_index.relevant` → `scout.active_sources` → `source_rank` → `read_budget` kept-left → `first_jobs.pick` | 1 | – |
| 4 | First-jobs slice (first Find jobs run only) | `first_jobs.run` (hub: `_Readers`, `_Scoring`) | 1, 5 | `MAX_FIRST` scores or the read cut |
| 5 | Boards first / boards beside | `boards_first.run` (first run, after the slice), `boards_first.Beside` (repeat run, started first, since E2a-2), `boards_ahead.scan_beside` | 3, 6 | read cut |
| 6 | Employer sites read | `feed_scan.scan` + `read_budget` | 5 | `READ_SECONDS` 75 + `READ_GRACE` 15 → 67 s |
| 7 | Free APIs, Google Jobs, alert e-mails | `aggregators.scan`, `google_jobs`, `job_alerts` | – | read cut |
| 8 | Places | `ai/place_triage.py` | 6, 9 | its share (`SHARE`, `PACE`) |
| 9 | Title sorting | `ai/title_triage.py` + `ai/title_queue.py` + `feed_order.py` | 6, 8, 10 | `RESERVE['titles']` 70 + `TAIL` 15 → **71 s** (gi measured ~71 s) |
| 10 | Scoring | `ai/score.py`, `first_jobs._Scoring` | 9 | `TAIL` → 124 s (`FACTS` 25 earlier when score-first) |
| 11 | Job facts, kits | `ai/enrich.py`, `ai/kit.py` | – | `RESERVE['enrich']` 40 + 15 → 94 s |
| 12 | Employer finder (scout) | `src/scout.py` | – | 180 − 5 (`STOP_MARGIN_S`) |
Two facts the table shows (gi's inventory, `press-inventory.md`, 7 Nov 2026, checked against the code):
- **Titles get ~4 s of their own.** The read cut is at 67.5 s and the titles' stop at 71.25 s (135 s search); after that only the floors run (300 local titles, 3 scores). gi measured the title step stopping at ~71 s with 75–116 titles unjudged for p7, p11, p15, p16, p18.
- **A repeat Find jobs run reads employer sites for ~4 s (measured, 7 Nov 2026; the code read said ~20 s).** On a repeat Find jobs run, the boards step runs first; in run [42411469318](https://github.com/jobadabra/jobadabra/actions/runs/42411469318) (p7, `presses=2`, one sample; 10 of the run's 71 broker calls were refused, which may have slowed the boards step: a second sample follows) it held the search until 60 s (a site still open at the boards' time), employer sites started at 64 s and the read cut is 67.5 s after the run starts; places got no time ("90 location(s) wait" at 66 s). p7 has 7 employer sites in its places, so it lost none; a persona with more would. The night check runs first Find jobs runs only (`--presses 1 --fresh`); the yardstick replays both.
- **A first Find jobs run starves the employer read too (gi, night tables, 7 Nov 2026).** The full employer read can start only once employers are named: 48-71 s (median ~53) and 50-65 s (median ~58) in the clean nights 42315566393 and 42386229424, against the 67.5 s read cut; "employer sites" is in the "time ran out for" list in 51 of 54 persona-runs, and the employer pages a first Find jobs run reads are the 15-feed first-jobs slice. One cause for both Find jobs runs: "employers named" lands just before the read cut. A fix's ledger row asserts seconds of employer read on both Find jobs runs, not only the order.

Knobs that hold seconds or counts of the clock today: `time_budget` (PLANNED, RESERVE ×3, FACTS, TAIL, SCORING, FLOOR, LOCAL_TITLES, FEED, SHARE ×7, PACE ×7), `read_budget` (READ_SECONDS, READ_FLOOR, READ_GRACE), `boards.SHARE_S`, `boards_first.WEB_WAIT`, `eures` (SECONDS, LAST_PAGE, MOST, KEEP), `first_jobs` (SLICE, FIRST_JOBS, MAX_FIRST, SLICE_BOARDS), `title_triage` (BATCH, MAX_NEW), `search-steps.js` (SEARCH_BUDGET_S, SCOUT_SHARE_S, STOP_MARGIN_S, STEP_MIN_S). About 45 numbers in 9 files, two languages.

## The orderings today (each becomes a named weight or is deleted)
| Where | Orders | Key today | Since |
|---|---|---|---|
| `employer_index.relevant` | feeds | placed in your places before unplaced | #3551 |
| `source_rank` | feeds | jobs per minute, 70+ yield, per run | 18 Oct |
| `read_budget.keep_left` | feeds | the ones left last time first | 26 Oct |
| `first_jobs.pick` | feeds | fast one-request kinds first, then the list's order (re-sorts what `relevant` ranked: case E of the research) | 16 Oct |
| `eures._areas` | EURES areas | nearest region first | #3305 |
| `time_budget.best_first` | jobs (score, facts, slice) and titles (`feeds.triage`) | best place, km to it, role closeness (`job_rank`) | 18 Oct, #2918 |
| `title_triage.decide` | titles in a reader | your places first, then nearness | 24 Oct, #3550 |
| `feed_order._Nearness` + `title_queue` | title batches across readers | (in my place, km), then each reader's turn; refreshed as places land | #3336, #3422, #3482 |
| `score.queue` | jobs to score | newest first, then `best_first`, then group | 18 Oct |
| `slots.FIRST` | AI call slots | first-run calls take a free slot first | 27 Oct |

## Target shape
1. **`src/press/` module.** `stages.py` declares the table above as data; `clock.py` is the one clock (today's `time_budget` deadline, part, ended, over, batch, in_calls, may_score become its methods; `time_budget` stays as a thin import shim until its last caller moves); the module's header comment is the same text as `docs/press.md` (a test compares them), and the search hub links it.
2. **`src/press/budget.json`**, read by Python (`clock.py`) and by the app (`desktop/lib/search-steps.js` through `pipeline-args.js`): every number listed above, in planned seconds of the 180, each with `why` and `pr`. A test checks the stage shares add up to the Find jobs run and that no stage file holds a clock number or calls `time.monotonic`/`time.time` for a deadline.
3. **`src/press/rank.py`**, one ranker with named weights shared by three entry points: `sources(feeds)`, `titles(batches)`, `jobs(jobs)`. Weights: `in_your_places`, `km_to_best_place`, `seen_hiring_there`, `fast_to_read`, `left_last_time`, `role_closeness`, `yield_history`, `feed_quality`, `waiting_for_score`, `fresh`, `reader_turn`; each names the file:line it reproduces today. Where a job is (`place_class`: city, region, country only, remote naming the country) stays a **filter**, not a weight: worldwide remote never counts, whatever the weights say. PR 4 moves today's keys in as they are (each entry point reproduces today's order exactly, proven by the ledger and an equal replay); making the three agree (case E: `pick` vs `relevant`) is a later, measured behaviour PR, one weight at a time, each a decision for the owner with the yardstick numbers.
4. **The fix ledger**, `tests/unit/press/ledger.py` + `test_ledger.py`: each past fix is one row `L<nn>` (date or PR, what the person gets, the owner's words) with its proof tests: the test it already had, or a new scenario when it had none. `test_L<nn>` runs them, so a red names the fix, its PR and the owner's words. `ledger.lock.json` locks each proof's module context (constants, fixtures, helpers, setUp) and a node proof's whole test block; a changed or removed row needs a `Ledger-change: L<nn> "<owner's words>"` line in the PR body (`tools/press-ledger-check.py`). Pays: it would have caught #3089 removing #3074's share 8 h later, #3336 rewriting `test_ai_slots`, #3551 flipping `test_employer_index` (3 escapes in 30 days).
5. **The class guards** (each pays by the research's count): no `sorted`/`.sort`/`heapq` for priority in stage files outside `rank.py` (allow-list of today's non-priority sorts, which only shrinks; caught "places first" ×7 and case E); no clock number or wall-clock read in stage files outside `clock.py`/`budget.json` (25 commits on `time_budget.py`, WAITING_SHARE in and out).

## Yardstick: exhaustive recording, clocked replay
What the Find jobs recording covers today (read 7 Nov 2026): `src/search_tape.py` records every web answer and AI answer with its time; `src/budget_tape.py` replays the recorded **time decisions**; Find jobs recordings live encrypted on `jobadabra-lab` release `search-tapes`. Three gaps for this use:
- **6 Find jobs recordings, 18 Oct, none of the 18 night candidates** (chisinau, cluj, driver, finance, music, sre).
- **An AI answer is keyed by the whole request**: a re-ordered Find jobs run asks other batches, the Find jobs recording misses them, and with no live AI (`JOBADABRA_TAPE_LIVE=0`) the replay stops as "stale".
- **The budget recording (`budget_tape`) replays the old run's time decisions**: a replay of an order or budget change takes the old path by design.
The yardstick therefore:
1. **Records once per candidate with no clock** (`--budget 0`: every stage takes all its work): every page read, every title judged, every location placed, every job scored, each with its time. That run's right local jobs are the ceiling for coverage. On the CI broker (plan path, $0), once, then again when a candidate's Find jobs recording is older than 14 days.
2. **Replays with the clock on**: web and AI answers from the Find jobs recording at their recorded times, `budget_tape` off, so the PR's own order and budget decide. AI answers are looked up **per item** (one title's verdict, one location's place, one job's score), so any batching finds them; a batch's time is the recorded time per item of its kind × its size. An item the exhaustive Find jobs recording lacks is counted (`unknown`) and never invented.
3. **Runs PR and main side by side** on the 18 candidates, a first Find jobs run and a repeat Find jobs run each, in parallel CI jobs (no AI and no broker, so load no longer moves the numbers), at wait scale 0.25 with a 45 s budget (`part` keeps every share), about 6 minutes in all.
4. **Noise band:** main replayed 5 times per candidate on the same Find jobs recordings; only thread timing varies. Band per number = mean ± 2 sd of the 5, stored with the Find jobs recordings and refreshed when they are. A PR's change inside the band reads "no change".
5. **Every pipeline PR's body** carries the table: Coverage, Quality, Speed for main and PR, the band, and the candidates that moved.
The night check stays as the live monitor (3-night medians, never one run).

## Safety (unchanged)
No new reader, no login wall, no retry of 401/403/429, no captcha; fictional candidates only; tests never reach the owner's app or data; recordings on the CI plan-path broker only, never a paid key.

## Hold
The gi coordinator holds read-order PRs until PR 5/6 (the ranker) merges; a fix that cannot wait adds its ledger scenario first.

## Progress
- [x] Sketch + owner's yes (7 Nov 2026: "Yes, build it (Recommended)"; order "Ledger, yardstick, then moves (Recommended)"; "Yes, record the 18 (Recommended)"; a drop below the band "Waits for your yes (Recommended)") (proof: none: the owner's answers in the ps session, 7 Nov 2026)
- [x] 1/6 The fix ledger on today's code, all green, with its append-only guard, merged #3561 (proof: tests/unit/press/test_ledger.py @93f7086)
- [ ] 2/6 Yardstick: exhaustive recordings of the 18, per-item AI replay, PR vs main job, noise band (in three PRs: 2a #3565 merged, the check's inputs and per-item replay; 2b the ceiling and the 18 recorded (540 s, one at a time, after the broker's week resets); 2b #3572 merged; 2c-1 the three numbers; 2c-2 the PR job and band, after the 18 Find jobs recordings; the repeat Find jobs run measured once, above; E1 #3576 merged, a repeat Find jobs run is one process)
- [ ] 3/6 Budget table: every clock number to `budget.json` (Python and app), values unchanged, guard
- [ ] 4/6 Pipeline module: `clock.py` + `stages.py`, stages take the clock, pure moves one stage group at a time
- [ ] 5/6 Ranker: today's keys moved into `rank.py` unchanged, priority-sort guard
- [ ] 6/6 `docs/press.md` = module header, search hub link, the hold lifted
- [ ] E2b Each Find jobs run continues where the last one stopped: `press_left.json` + `load_left()` (ledger L36); item-level resume already held (`tests/unit/ai/test_three_minutes_resume.py`, redone 0 on 13 stages); the equality test on a Find jobs recording and the overhead number wait for rf (the yardstick's numbers are unusable until then)
