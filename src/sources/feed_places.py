"""A reader's place call runs beside the hub, not in it (#2920, owner-seen as fewer jobs on a Find jobs press).
Why (7 Nov 2026, #2920, runs 42386229424 vs 42315566393, p10 Amsterdam and p14 Gothenburg): the employer reader placed its new locations (one AI call, 20-21 s) IN the hub thread, which runs the
other readers' hand-overs only while it waits in a title sort: EURES's 200 vacancies sat in the hub's box. The first title ask moved from 57-60 s to 101-124 s and the 2:15 clock allowed 2 title
calls instead of ~8 (titles sorted 108 -> 60 and 185 -> 58). The call now runs in a worker and the hub serves the others' hand-overs while it waits.
Why the reader's own titles still wait for the answers (review of #3512, 7 Nov 2026): `feeds.triage` marks the AI sort as run (feeds.ASKED), after which `wanted_title` stops using the role words, and
`wanted_location` falls back to the place words for a location not placed yet: a sort beside the place call raced that flag (no place call at all on big lists) and handed words-yes, AI-out jobs
("Paris, Texas") to scoring. Tests: tests/unit/ai/test_titles_with_places.py."""
import threading
from concurrent.futures import Future

from ..ai import batch_scope, slots, title_queue


def triage_with_places(jobs):
    """feeds.triage_places(jobs), then feeds.triage(jobs): the place call runs in a worker while this thread serves the hub's other readers (title_queue.wait_for); the reader's own sort
    starts when the answers are in, as before."""
    from . import feeds   # read at call time: tests patch feeds.* as before
    placing, views = Future(), batch_scope.current()

    def place():
        try:
            with batch_scope.using(views):   # the reader's own views, as if the call ran in its thread
                feeds.triage_places(jobs)
            placing.set_result(None)
        except BaseException as error:  # noqa: BLE001 — raised in the reader's thread below, where its caller handles it
            placing.set_exception(error)
    threading.Thread(target=slots.carry(place), daemon=True, name='place-call').start()
    title_queue.wait_for(placing)
    feeds.triage(jobs)
