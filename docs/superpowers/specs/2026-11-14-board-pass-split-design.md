# Board-pass split: judging first, startup and lanes later

Owner, 14 Nov 2026: "Gitar has a problem with big PRs. Let's split the PR into smaller chunk".
The complete local implementation is preserved on `xc-judge-full`; it is not a branch to push.

## Design and order

Four numbered stages split board-job judging into independently tested PRs of about 300 changed lines; stage 3 has separate 3a/4, 3b/4 and 3c/4 PRs.
1. **Accounting:** `board_pass` values, one count function and count/vague-place fixtures. No search caller.
2. **Clock and answer hooks:** clock-mode propagation and partial-answer callbacks; tested directly without changing board_pass.
3. **3a judging; 3b queue/clock preparation; 3c hand-over:** 3a adds normalized counts and bounded judging. 3b prepares waiting-row removal and the pass boundary. 3c adds explicit cache-owner hand-over and recovery; none enables production startup.
4. **Activation:** start and connect the pass, change the read cutoff, then add the L05/L42 proofs and ledger lock through its tool.
### Separate follow-up plan (outside stages 1–4)

Why (#4336, 14 Nov 2026): items 5 and 6 were restored after the four numbered judging stages; they remain a separate follow-up plan.
- **Follow-up 5 — boards start at second 0:** restore the separately scoped startup change after judging is active.
- **Follow-up 6 — lanes + 20 s stalled-board bound:** restore the separately scoped lane work last; time remains owned by the search clock.

Why (14 Nov 2026, owner): parts 1–3, including the separate 3a/3b/3c preparations, may merge on a valid non-regressing pair ("Not worse = merge"); part 4 must show the gain.
Parts 1–3c are merged; part 4 starts the pass worker and connects its final hand-over, preserving one clock and one cache owner.
No new place/title judgment, read order, clock, ledger meaning or live-data write is introduced by part 1.

## Progress

Part 4's automatic **Search before/after** pair measures **b01 (Sofia driver)** and **d03 (Chisinau software)**. It must show a gain for a named person or the activation PR closes; parts 1–3 were preparation only. Keep right-job and board-job counts, main → PR, with run links in the activation PR's pair comment beside the [Search before/after workflow](https://github.com/jobadabra/jobadabra/actions/workflows/search-pair.yml). Earlier Mac comparisons from the broken tool are **VOID**; post-tool-fix same-inputs controls diagnose timing, while the activation's gain is decided by its automatic pair. The standalone title-filter exemption is removed: owed titles use AI verdicts, without a role-word shortcut.

- [x] 1/4 Accounting and count/vague-place tests (#4339) (proof: tests/unit/sources/test_board_pass.py @317b0c66)
- [x] 2/4 Clock and answer hooks (#4338) (proof: tests/unit/press/test_clock_to_the_end.py @9a482709)
- [x] 3a/4 Standalone judging and normalized counts (#4352) (proof: tests/unit/sources/test_board_pass_waits.py @88251166)
- [x] 3b/4 Waiting rows and pass boundary (#4347) (proof: tests/unit/sources/test_pass_queue_timing.py @799a6612)
- [x] 3c/4 Explicit hand-over, recovery and settlement (#4371) (proof: tests/unit/sources/test_board_handover.py @a0991cc0)
- [ ] 4/4 Activate judging in the search and prove the gain (this PR; pair pending)
### Separate follow-up plan
- [ ] 5 Boards start at second 0
- [ ] 6 Lanes + 20 s stalled-board bound
