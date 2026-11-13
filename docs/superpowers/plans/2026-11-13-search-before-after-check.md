# Search before/after as the CI check that holds a search PR (13 Nov 2026)

Owner, 13 Nov 2026: "Can we add the before/after as a CI check on the PR ?" · "and instead of having \"DONT MERGE\"... we'll just have red check".
Board draft: "Search before/after as the CI check that holds a search PR" (Work board).

Intended behaviour: a PR that changes what Find jobs reads (`SEARCH_FILES` of `tools/pr-body-check.py`, the list that already asks a PR for its Moves line) has one row "Search before/after" on its head: pending while its pair
runs, green with the numbers, red on a loss beyond the person's band, never green for a pair that did not count. It is the one hold: "All checks passed" reads it.

## Progress
- [x] 1/3 The row: search-pair.yml writes the check run "Search before/after" (running since / ends ~, success, failure, neutral "superseded"), one automatic re-run, the band (7 jobs until measured), merged PRs on their merge commit. Holds nothing yet. (proof: tests/tooling/ci/test_pair_row.py)
- [ ] 2/3 The pair starts by itself on a PR in reach, one pair per push once the other checks are green; "no Moves line" is red, "no search change: <why>" is green; a newer head cancels the older pair.
- [ ] 3/3 The hold: pr-verdict.py reads the row; delete the search-hold label path, settle, ship's draft/DONT MERGE for pair waits; rule text in CLAUDE.md and AGENTS.md.

## Design: the row's states and their one writer (13 Nov 2026, after four Gitar rounds on 1/3)
The row is one check run per head. Its whole state is in its `external_id` (`search-pair:<state>:<people>:<owner run id>`). ONE function, `pair_row.next_row(old row, event)`, is the only place it changes;
the workflows say what happened (an event) and write what it returns. The table is at the top of `tools/persona-search/pair_row.py` and is a test (`TheRowsStatesHaveOneWriter`).
Rules: a finished row (counted, carried, superseded, nothing, unnamed) is never rewritten; a new pair for the head gets a new row beside it. A run's `ended`/`died` change the row only while its run id is the row's owner.
A second run is asked by moving the row to `rerunning` first, then dispatching; a dispatch that fails moves it to `unproven` ("run it again"). Never red for a pair that did not count; red is only a loss beyond the band.

## Decisions (sa, 13 Nov 2026)
- In reach = `SEARCH_FILES` of `tools/pr-body-check.py`, no second list (`paths.py` went with the replay in #3939; `src/ai/board_*.py` joins in 2/3).
- Band = the spread of the person's last 3 searches on main (the Trello middle-of-3 data); 7 jobs when fewer than 3, run 43498213279 (the same code gave 8 vs 15).
- A red row says the owner may merge by hand with the ruleset override; no other bypass.
