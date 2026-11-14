# Board-pass split: judging first, startup and lanes later

Owner, 14 Nov 2026: "Gitar has a problem with big PRs. Let's split the PR into smaller chunk".
The complete local implementation is preserved on `xc-judge-full`; it is not a branch to push.

## Design and order

Four numbered stages split board-job judging into independently tested PRs of about 300 changed lines; stage 3 has separate 3a/4 and 3b/4 PRs.
1. **Accounting:** `board_pass` values, one count function and count/vague-place fixtures. No search caller.
2. **Clock and answer hooks:** clock-mode propagation and partial-answer callbacks; tested directly without changing board_pass.
3. **3a judging; 3b hand-over preparation:** 3a adds normalized counts and owed/judge/_titles/_say with bounded rounds. 3b prepares waiting-row removal, the pass boundary and hand-over; neither enables production startup.
4. **Activation:** start and connect the pass, change the read cutoff, then add the L05/L42 proofs and ledger lock through its tool.
### Separate follow-up plan (outside stages 1–4)

Why (#4336, 14 Nov 2026): items 5 and 6 were restored after the four numbered judging stages; they remain a separate follow-up plan.
- **Follow-up 5 — boards start at second 0:** restore the separately scoped startup change after judging is active.
- **Follow-up 6 — lanes + 20 s stalled-board bound:** restore the separately scoped lane work last; time remains owned by the search clock.

Why (14 Nov 2026, owner): parts 1–3, including the separate 3a/3b preparations, may merge on a valid non-regressing pair ("Not worse = merge"); part 4 must show the gain.
Parts 1 and 2 are merged; the 3a/3b preparations follow them, and activation follows both preparations. Part 4 starts the production pass; parts 1–3 do not enable it.
No new place/title judgment, read order, clock, ledger meaning or live-data write is introduced by part 1.

## Progress
- [x] 1/4 Accounting and count/vague-place tests (#4339) (proof: tests/unit/sources/test_board_pass.py @317b0c66)
- [x] 2/4 Clock and answer hooks (#4338) (proof: tests/unit/press/test_clock_to_the_end.py @9a482709)
- [ ] 3a/4 Standalone judging and normalized counts (this PR)
- [ ] 3b/4 Waiting rows, pass boundary and hand-over preparation
- [ ] 4/4 Activate judging in the search and prove the gain
### Separate follow-up plan
- [ ] 5 Boards start at second 0
- [ ] 6 Lanes + 20 s stalled-board bound
