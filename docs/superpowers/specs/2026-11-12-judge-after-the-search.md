# Find jobs: judge after the search

**Verdict:** a job a search read and had no time to judge is kept as *waiting*; one queue after the search judges it, reads its posting and scores it. Nothing read is dropped, no source is read twice to get it back.

Owner, 12 Nov 2026, asked via AskUserQuestion: "Yes, build it (Recommended)", "All checked, 60 scored, 10 min (Recommended)", "Yes, one bar, a count (Recommended)", "Yes, add the second reading (Recommended)". Sketch: https://claude.ai/artifact/Lkz6knfTjcPp6zkko7vUhW

## Why
- 30 first searches (12 Nov 2026, the Mac): a job board with jobs returned at 97 s (median); the AI stops at 124 s. 1,068 of 2,019 board jobs came back at 90 s or later and were never asked about.
- They were dropped; their board was read again by the next 2 searches to get them back (`owed_reads`, removed).
- Paris: 30 jobs listed, 23 with no posting read; the queue found nothing it could score and ended in 1 s.
- The search clock had 4 fixes in 7 days: a redesign, not a 5th fix.

## Design
| State of a job a reader gave | Its one owner | What changes it |
|---|---|---|
| **waiting** (the AI has not answered for its title or place) | `src/sources/waiting_jobs.py`: one table; only a search adds (`aggregators.kept`), only the queue takes (`judge`) | the title answer, then the place answer |
| **listed** | the Jobs list (the store) | its posting is read, then its score |
| **not for you** | the stored title and place answers | a new search strategy re-judges |

- The queue (`src/daily_modes.py score_mode`, steps in `src/press/after_search.py`): titles → places → postings → scores.
- Limits: every waiting job checked, the newest 500 kept, 14 days, 3 queue runs per job; 60 postings read, 60 scored; 10 minutes (`SCORE_QUEUE_S`).
- Only what few questions can settle waits: a job in the person's places with an open title, a board's job with an open place, a fitting title with an open place. A free job API's whole-world rows do not.
- The app starts the queue when a search says it kept work (jobs to check, postings to read, jobs to score); one bar above the Jobs list, a count, never unjudged rows.
- Not in this design: the search's own clock is unchanged (asking more places inside the 3 minutes starved the titles, 3 tries on 12 Nov 2026); employer sites are read again each search, so their unjudged titles are asked then.

## Progress
- [x] 1/3 The waiting list, the queue's three new steps, the bar and the Find card line (proof: tests/unit/sources/test_waiting_jobs.py)
- [ ] 2/3 The scoreboard's second reading "after the queue" beside the 3-minute one (locked measure: the owner's words in the commit)
- [ ] 3/3 Faster job boards, only if "at 3 minutes" stays poor on a quiet Mac
