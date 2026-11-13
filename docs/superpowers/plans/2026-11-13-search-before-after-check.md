# Search before/after as the CI check that holds a search PR (13 Nov 2026)

Owner, 13 Nov 2026: "Can we add the before/after as a CI check on the PR ?" · "and instead of having \"DONT MERGE\"... we'll just have red check".
Board draft: "Search before/after as the CI check that holds a search PR" (Work board).

Intended behaviour: a PR that changes what Find jobs reads (the files `tools/press-yardstick/paths.py` prints) has one row "Search before/after" on its head: pending while its pair
runs, green with the numbers, red on a loss beyond the person's band, never green for a pair that did not count. It is the one hold: "All checks passed" reads it.

## Progress
- [ ] 1/3 The row: search-pair.yml writes the check run "Search before/after" (running since / ends ~, success, failure, neutral "superseded"), one automatic re-run, the band (7 jobs until measured), merged PRs on their merge commit. Holds nothing yet.
- [ ] 2/3 The pair starts by itself on a PR in reach, one pair per push once the other checks are green; "no Moves line" is red, "no search change: <why>" is green; a newer head cancels the older pair.
- [ ] 3/3 The hold: pr-verdict.py reads the row; delete the search-hold label path, settle, ship's draft/DONT MERGE for pair waits; rule text in CLAUDE.md and AGENTS.md.

## Decisions (sa, 13 Nov 2026)
- In reach = what `tools/press-yardstick/paths.py` prints, no second list.
- Band = the spread of the person's last 3 searches on main (the Trello middle-of-3 data); 7 jobs when fewer than 3, run 43498213279 (the same code gave 8 vs 15).
- A red row says the owner may merge by hand with the ruleset override; no other bypass.
