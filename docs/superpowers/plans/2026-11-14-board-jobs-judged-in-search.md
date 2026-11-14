# Board jobs judged in the search (xb, 14 Nov 2026)

**Verdict:** board jobs read before the search's last judging pass are placed and title-judged in the search; the GTM 6 cards show both numbers.
Owner, 14 Nov 2026, asked via AskUserQuestion (relayed by session sa): "Judge in search + show both (Recommended)"; L05: "Yes, stop new reads then (Recommended)".
Why: 12 CI searches of the GTM 6 profiles, 486 board jobs with a place text read and never asked; 0 place passes in 7 of 12 searches.

## PRs
1. `[xb] 1/2` The last judging pass: `read_budget.pass_at` (one owner of the moment), the lane starts no new read after it, `boards_first.Beside.last_pass` places then title-judges what is owed (`src/sources/board_pass.py`, `time_budget.to_the_end`), three log lines. Ledger L05 changed, L42 added.
2. `[xb] 2/2` Each GTM 6 card shows two numbers: "at 3 minutes" and "after the app's waiting queue"; the card's verdict stays on the 3-minute number.

## Progress
- [ ] 1/2 the last judging pass (proof: d03, d01, c02, one search a side, same minute, EURES off)
- [ ] 2/2 two numbers per card
