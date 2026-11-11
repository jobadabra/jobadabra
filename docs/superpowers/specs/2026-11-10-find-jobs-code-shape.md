# Find jobs: the code shape (design by session sa, 10 Nov 2026)

> **Verdict:** four contracts, so a session that changes one stage or one source edits one file behind a contract, and a test of the contract (not of its case) says so. Every PR is a pure move: the fix ledger stays green and the yardstick's per-person table reads "no change".

Owner, 10 Nov 2026 (session sa): "each session want to improve his case, his issue and automatically worsens other cases" · "I want that each session that tries to improve a case, does this wihout worsening/affecting other improvements done previosuly" · "can you make the design of new code shape and give it to an Opus/Sonnet to implement it ?"

## Why
- 🔴 Today a change in one place reaches others through three hidden roads: state kept at module level, catch-alls that turn a failure into "0 jobs", every source wired into the run by hand.
- 🟢 Target: four contracts (below). A PR that moves a number is not a move: split it.

## Measured on main (87a41364, checked again on 05c6bfbf by cr)
- Module-level state on the search path: 69 names a function of their module writes, plus the one process Clock (`tests/guards/rules/test_run_state_only_shrinks.py` KNOWN lists each; scope `src/press`, `src/sources`, `src/ai`, `first_jobs`, `daily_search*`, `run_counts`, `run_details`, `read_methods`, `time_budget`, `geo`, `places`, `regions`, `job_rank`, `employer_index`, `source_rank`; a schema built once at import is not state).
- `first_jobs.run(...)`: 16 parameters, 8 of them test seams.
- Catch-alls (`except Exception`/bare): `daily_search.py` 16, `first_jobs.py` 8, `feeds.py` 7, `careers.py` 7, `found_boards.py` 7, `boards.py` 7.
- Job boards: 17 modules, about 3,200 lines, four ways in (`boards_first`, `boards_beside`, `boards_ahead`, `found_boards.read`).
- **No reader registry exists** (the first draft named `src/sources/readers.py`; that file is `code_fingerprint`, the re-check hash of `feeds.py:385` and `scout_probe.py:26`, and stays). Sources are wired by `aggregators.sources()` (`aggregators.py:194`), `job_alerts.SOURCES` (`job_alerts.py:27`) and by hand in `first_jobs` / `daily_search`.
- `src/press/stages.py`: "nothing reads this table to decide a run".

## The four contracts
| # | Contract | File | Rule | Proof |
|---|---|---|---|---|
| C1 | **Run**: what one Find jobs run owns | `src/press/run.py` | Made once at the entry, passed down; flat (a frozen dataclass of small holders), no logic. No search-path module keeps a run's state at module level. | `tests/unit/press/test_run.py`: the fields two Runs still share are listed, and the list only shrinks; `tests/guards/rules/test_run_state_only_shrinks.py`: no new module state. |
| C2 | **Stage result** | `src/press/stage.py`, `stages.py` rows | `stage(run, given) -> Result(status, reason, items, seconds)`, status done / cut / failed. The ONE catch-all is in the stage runner; inside a stage an except names its errors. The order is read from `stages.py`. | Every row returns a Result; a failing stage shows its reason in the details; `stage.guard` is the one catch-all: it counts each failure (place, error type, never its words) on the run's details (`run_details.failures()`), each site keeps its own warning and fallback; raw catch-alls on the search path only shrink (`tests/guards/rules/test_catch_alls_only_shrink.py`, 196 in 72 files on 05c6bfbf). |
| C3 | **Reader**: every source of jobs | `src/sources/reader_rows.py` (new, cr 2/5) | `read(run, search) -> Listed jobs` with the place fact the source has. Never scores, sorts or decides what is kept. "Starts at the press" is a row field (the same field as sf 2/8's `AT_PRESS` rows). Job boards are ONE reader (`src/sources/board_reader.py` `read`; sa, option B: the four ways in are the run core's phases, the reader only lists). | One loop over the rows: Listed jobs, honours `run.clock`, no AI score call (a fake Run that fails on score). |
| C4 | **Job states** | `src/press/job.py` | Listed → Placed → Kept → Scored, one owner each; `in_your_places(job)` is one function; unknown is a state, never a guess. | No function outside the owner changes a state; a job without a verdict is unknown in every reader. |

### The Run's fields (agreed with sf, 10 Nov 2026)
`clock` (time_budget.CLOCK) · `claims` (press.scorer) · `counts` (run_counts) · `details` (run_details) · `resume` (press.resume) · `yields` (press.step_yield) · `titles` (ai.title_queue) · `scope` (ai.batch_scope) · `ai` (ai.decide) · `methods` (read_methods) · `cut` (sources.read_budget) · `reads` ({reader: Reader(early, cut, held, searched, taken)}, keyed per reader so each owner moves its own part) · `say`, `sync`.

**Limit:** two Runs share the one process Clock until the ~57 patches of `time_budget.<name>` move (sf 3/8): `time_budget.CLOCK`'s attribute dictionary IS that module's globals.

Not goals: the 436 imports inside functions; renames; any change of order, clock or budget; a new gate beyond the two ratchets named above.

## Who builds what
| Part | Session |
|---|---|
| Run core: `first_jobs.py`, `daily_search*.py`, `src/press/*` (C1 adoption, C2 runner, C4 in scoring) | sf 3/8, 7/8, 8/8, now inside the lanes plan (2/5-4/5, WP8 of [the finish line](2026-11-10-find-jobs-finish-line.md); sa, 11 Nov 2026) |
| Skeletons + readers: `run.py`, `stage.py`, `job.py`, `reader_rows.py`, `board*.py`, `boards*.py`, `found_boards.py`, `eures.py`, `careers*.py` | cr |
| What is kept: `feeds.py` | lj (cr waits for lj 1/3) |
| EURES gate: `features.py`, `aggregators.py` sources() | oe 1/3 (cr touches `aggregators.py` after it merges); oe 2/3, 3/3 add rows to `reader_rows.py` |
| The per-person "no change" table | ys |

## Progress
- [ ] [cr] 1/5 Skeletons: `run.py`, `stage.py`, `job.py`, this spec, the two ratchets. Wiring left: all of it.
- [x] [cr] 2/5 Reader rows: `src/sources/reader_rows.py` `Row(name, read(run, search), on(env))`, EURES the first row, read by `aggregators.sources()` in its place and behind #3678's gate (sf and oe, 10 Nov 2026: no field nothing reads, so "starts at the press" and a place-fact label wait for their reader) (proof: tests/unit/sources/test_reader_rows.py).
- [ ] [cr] After sf 3/8 (the Run made at the entry, passed down): the employer feeds' reader (`feed_scan`'s download as a reader that only lists, the 3/5 cut; placing, title sorting and keeping stay in `feed_scan` in today's order, #3512) and its row (its employers are the Run's pick); `eures._early`, `read_budget._short` onto the Run; the first-jobs slice loops over the rows with `starts_at_press` (sf, `first_jobs._others`). Wiring left after: `job_alerts.SOURCES`, the boards, the free APIs.
- [x] [cr] 3/5 Job boards, one reader: `board_reader.read(run, search, early, since)` lists, keeps nothing; `boards_first` reads through it (#3682, merged 10 Nov 2026; yardstick: every person who repeats matched main, p9 inside its noise band) (proof: tests/unit/sources/test_board_reader.py @92dc0d8). Wiring left: `boards_first`'s `kept()`/`triage()`, `boards_ahead` and `aggregators.py:311-333` (after oe 1/3); `board_web` state onto `run.reads['job boards']` once the Run is on main.
- [ ] [sf] The board phase becomes a stage row in sf 7/8 (sa and sf, 10 Nov 2026: no separate cutover, a pure move with no outcome): `kept()`/`triage()` in the core's step, L36's proof edits once there; proof: kept per phase equals today's on `tests/unit/sources/test_board_reader.py`'s fixture.
- [x] [cr] 4/5 The readers' catch-alls go through `stage.guard` (sa, option d: same lines, same fallbacks, now counted), file by file in `careers*`, `board_*`, `boards*`, `found_boards`: 34 sites, the catch-all ratchet 196 in 72 files → 162 in 65 (proof: tests/guards/rules/test_catch_alls_only_shrink.py). Left raw for sa, each guarding a refusal (401/403/429, a bot check, no browser): `board_check.py` 3 (a refusal or a passing error), `board_pages.py` 1 (paging end), `board_rendered.py` 1, `careers.py` 2 (home page, headless show), `careers_explore.py` 1 (headless show), `found_boards.py` 3 (rendered visit, home page show, search page fallback). Named errors come after sf 7/8, from what the guard counted on real runs.
- [ ] [cr] 5/5 Delete the old ways in (with sf 8/8).
