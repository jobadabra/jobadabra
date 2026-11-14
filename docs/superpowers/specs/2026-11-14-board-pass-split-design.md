# Board-pass split: judging first, startup and lanes later

Owner, 14 Nov 2026: "Gitar has a problem with big PRs. Let's split the PR into smaller chunk".
The complete local implementation is preserved on `xc-judge-full`; it is not a branch to push.

## Design and order

Parts 1–4 split board-job judging into independently tested changes of about 300 changed lines each.
1. **Accounting:** `board_pass` values, one count function and count/vague-place fixtures. No search caller.
2. **Clock and answer hooks:** clock-mode propagation and partial-answer callbacks; tested directly without changing board_pass.
3. **Judging + hand-over preparation:** add owed/judge/_titles/_say, bounded AI rounds, recovery, unique delivery and settlement APIs; production startup remains deferred.
4. **Activation:** start and connect the pass, change the read cutoff, then add the L05/L42 proofs and ledger lock through its tool.
### Separate follow-up plan (outside the four judging PRs)

Why (#4336, 14 Nov 2026): items 5 and 6 were restored by the owner after the four-part judging split; they are not counted in 1/4–4/4.
- **Follow-up 5 — boards start at second 0:** restore the separately scoped startup change after judging is active.
- **Follow-up 6 — lanes + 20 s stalled-board bound:** restore the separately scoped lane work last; time remains owned by the search clock.

Why (14 Nov 2026, owner): parts 1–3 may merge when their search pair is valid and nobody is worse ("Not worse = merge"); part 4 must show the gain.
Parts 1 and 2 can land independently; part 3 follows both, and part 4 follows part 3. Part 4 starts the production pass; parts 1–3 do not enable it.
No new place/title judgment, read order, clock, ledger meaning or live-data write is introduced by part 1.

## Progress
- [ ] 1/4 Accounting and count/vague-place tests
- [ ] 2/4 Clock and answer hooks
- [ ] 3/4 Judging + hand-over preparation
- [ ] 4/4 Activate judging in the search and prove the gain
### Separate follow-up plan
- [ ] 5 Boards start at second 0
- [ ] 6 Lanes + 20 s stalled-board bound
