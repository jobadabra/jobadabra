"""One queue for every reader's job-title batches, nearest place first (#2918; owner, 5 Nov 2026: "One clear order first"; 6 Nov 2026: "Score from the nearest
batches as they land (Recommended)"). A reader (the employer sites, the boards, EURES...) cuts its own titles into batches of its own (a request holds one reader's
titles, so a recorded search replays whatever order readers finish in: owner, 18 Oct 2026, tests/unit/ai/test_triage_batch_order.py) and `serve`s them here. A worker
asks the batch with the nearest title first, whichever reader it came from: no source has a level of its own (all workers run at TITLES, src/ai/slots.py). Batches of equal or still unknown distance
(a first press has an empty map) go by their place in their own reader's list, then by arrival: the readers take turns, none takes every call the clock allows (#2920). As each batch lands
its reader's thread gets it (`land`), so a job can reach scoring after ONE batch instead of after the reader's whole sort.
Threads: a batch is asked by a worker; `land` runs in the thread that called `serve` (it holds that reader's own views of places and titles, src/ai/batch_scope.py).
The hub is the one thread that owns the job store (a sqlite connection is bound to its thread): readers in other threads hand it work with `Hub.post`, and the hub
runs it while it waits for its own batches (`serve`) or for the next reader (`Hub.run_next`). Tests: tests/unit/ai/test_title_queue.py."""
import contextlib
import functools
import itertools
import queue
import threading

from ..press import rank as ranking   # `serve` has a parameter named rank
heapq = ranking.heapq   # Why (5/6, 8 Nov 2026): the heap calls live in src/press/rank.py; ledger L19's locked proof (tests/unit/ai/test_title_queue.py) spies on a push through this name, and a ledger change needs the owner's words
from . import batch_scope, slots

_cv = threading.Condition()
_heap = []   # (key, turn, seq, titles, ask, put, landed, refresh): waiting batches, nearest first, then each reader's turn
_seq = itertools.count()
_running = [0]   # worker threads alive
_local = threading.local()


class Hub:
    """The thread that owns the store. Messages are zero-argument functions: another reader's hand-over (post), or a landed batch of this thread's own."""

    def __init__(self):
        self.thread = threading.current_thread()
        self.box = queue.Queue()

    def post(self, fn):
        """Run `fn` in the hub thread, the next time it waits (any thread may post)."""
        self.box.put(fn)

    def run_next(self, timeout=None):
        """Wait for one message and run it in the hub thread -> False when none came in `timeout` seconds."""
        try:
            message = self.box.get(timeout=timeout)
        except queue.Empty:
            return False
        message()
        return True


_hub = [None]


@contextlib.contextmanager
def hub():
    """The calling thread is the hub while the block runs (the first-jobs slice, src/first_jobs.py) -> the Hub."""
    mine = Hub()
    _hub[0] = mine
    try:
        yield mine
    finally:
        _hub[0] = None


def current_hub():
    """The hub of the press running now (None outside the first-jobs slice)."""
    return _hub[0]


@contextlib.contextmanager
def handing_to(fn):
    """Inside the block, a reader's jobs whose titles the AI says fit are given to `fn(jobs)` as each batch lands (feeds.triage), in this thread."""
    before = getattr(_local, 'hand', None)
    _local.hand = fn
    try:
        yield
    finally:
        _local.hand = before


def handing():
    """The calling thread's hand-over function, or None."""
    return getattr(_local, 'hand', None)


def wait_for(future):
    """future.result(); the hub thread runs the other readers' posted work while it waits, never idle with a reader's hand-over in its box (#2920: a 20 s place call held EURES's)."""
    mine = _hub[0]
    if mine is None or threading.current_thread() is not mine.thread:
        return future.result()
    future.add_done_callback(lambda _done: mine.post(lambda: None))   # wakes the hub when the call ends
    while not future.done():
        mine.run_next()
    return future.result()


def serve(batches, ask, land, parallel, rank=None):
    """Ask `batches` ([(key, titles)], key a comparable tuple: the nearest first; a batch's index in this list is its turn when keys tie) with `ask(titles)` in worker threads, `parallel` at once across ALL readers, and
    call `land(titles, result)` in THIS thread as each one lands (result is ask's answer, or its exception, which `serve` raises after the last batch landed).
    A thread that is the hub also runs the other readers' posted work while it waits. Optional rank(titles) refreshes waiting priorities from the originating reader's view."""
    if not batches:
        return
    mine = _hub[0]
    box = mine.box if mine is not None and threading.current_thread() is mine.thread else queue.Queue()
    remaining, failed, views = [len(batches)], [], batch_scope.current()
    from .. import time_budget
    ask = time_budget.carried(ask)   # asked in a worker with this reader's last-pass mode (time_budget.to_the_end), as its views

    def landed(titles, result):
        remaining[0] -= 1
        if isinstance(result, BaseException):
            failed.append(result)
        else:
            try:
                with batch_scope.using(views):   # the reader's own views, whatever else this thread is running meanwhile (the hub's nested sorts)
                    land(titles, result)
            except Exception as error:  # noqa: BLE001 — a failed hand-over to scoring must not lose the sort's answers (the reader's final pass takes the jobs)
                print(f'Warning: a sorted batch was not handed to scoring ({type(error).__name__}: {error}); the search goes on', flush=True)
    def refresh(titles):
        with batch_scope.using(views):
            return rank(titles)

    with _cv:
        for turn, (key, titles) in enumerate(batches):
            # Why (7 Nov 2026, #2920, night p9 Lyon, run 42315566393): equal keys (no distance known yet: a first press has an empty map) were served in arrival order, so the reader that pushed first took every
            # call the clock allowed and EURES's 3 batches got none. Its position in its own reader's list (the `turn` of rank.waiting_entry, src/press/rank.py since 5/6) breaks the tie: readers alternate, each in its own nearest-first order.
            ranking.push(_heap, ranking.waiting_entry(key, turn, next(_seq), titles, ask, functools.partial(box.put), landed, refresh if rank else None))
        for _ in range(max(0, min(parallel - _running[0], len(_heap)))):   # every worker alive is asking (an idle one has left): a waiting batch needs a new one
            _running[0] += 1
            threading.Thread(target=_work, daemon=True, name='title-queue').start()
    while remaining[0]:
        box.get()()
    if failed:
        raise failed[0]


def _work():
    """One worker: ask the nearest waiting batch, put its landing in its reader's box, until nothing waits."""
    while True:
        with _cv:
            if not _heap:
                _running[0] -= 1
                return
            # Why (7 Nov 2026, #2920): EURES hands jobs over before map resolution; newly learned geography must order waiting work too.
            refreshed = []
            for key, turn, seq, titles, ask, put, landed, refresh in _heap:
                try:
                    refreshed.append(ranking.waiting_entry(refresh(titles) if refresh else key, turn, seq, titles, ask, put, landed, refresh))
                except BaseException as error:  # noqa: BLE001 — a reader's failed refresh is delivered as its failed ask; other readers continue
                    put(functools.partial(landed, titles, error))
            ranking.reorder(_heap, refreshed)
            if not _heap:
                _running[0] -= 1
                return
            key, _, _, titles, ask, put, landed, _refresh = ranking.pop(_heap)
        try:
            with slots.priority(slots.TITLES), slots.ranked(key):   # Why (#2918 review; lanes 4b-1, 11 Nov 2026): a batch waits for the model's slot at the titles' own level (src/ai/slots.py TITLES), nearest first there too, not only at the pop
                result = ask(titles)
        except BaseException as error:  # noqa: BLE001 — handed to the reader's thread, which raises it
            result = error
        put(functools.partial(landed, titles, result))
