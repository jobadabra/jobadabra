# Refresh waiting title priorities

Bug #2920; existing nearest-first design: specs/2026-10-16-first-jobs-fast.md and `src/ai/title_queue.py` module contract. Design block prepared in task PR body before product edits.

## Progress
- [x] Reproduce delayed-map scheduling with a failing behavioral regression in `tests/unit/ai/test_title_queue.py`.
- [x] Refresh title distance in `src/sources/feed_order.py`; pass a batch ranking callback from `src/ai/title_triage.py`; refresh queued priorities in `src/ai/title_queue.py` under the originating reader view.
- [x] Verify focused title queue, reader isolation, and EURES title tests. No live models or broad local suites.
- [ ] Review and ship using `tools/ship.sh`; retain #2920 open until measured search coverage improves.

Constraints: same deadline and model budget; no source-specific priority; never mutate running calls; unknown geography remains unknown. Stable arrival order breaks ties. Recompute from reader-owned views, preserving isolation across concurrent readers.
