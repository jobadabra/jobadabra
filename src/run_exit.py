"""A timed search's process ends at its deadline (owner, 26 Oct 2026: "A find jobs session should take at most 3min"). Site reads still open
after the read cut are neither waited for nor killed (src/sources/late_reads.py), but Python joins every such thread when the process exits:
the owner's run 8501ae436f60 was done at 155 s and exited at 271 s, and the app showed it running until then. Once the engine is done, the
open reads get what is left of the run's time to end and keep their answer; then the process exits without them, and the next search reads
those sites itself. Without a budget nothing changes. A step with a budget of its own (the employer finder, src/scout.py) gives its deadline
to `until` (27 Oct 2026: a first press's scout waited for 6 checks until 379 s of 180). Tests: tests/unit/press/test_press_ends.py (every place
that leaves work running), tests/unit/engine/test_run_exit_says_decide_calls.py.
Invariants: `holding` lists exactly what Python's own exit would wait for; `leave` is the one hard exit: the exit handlers run first, on a limit."""
import os
import sys
import threading
import time


from .press import budget

HANDLERS = budget.value('run_exit.HANDLERS')   # the exit handlers' seconds at a hard stop, inside the run's share (src/press/budget.json)
_own = [None]


def until(deadline):
    """This process's deadline when it runs no search budget (time_budget): its own step's end (time.monotonic())."""
    _own[0] = deadline


def holding(skip=()):
    """The threads this process's exit would wait for, but this one, the main thread and `skip`: every non-daemon thread, and every pool worker
    whatever its daemon flag.
    Why (lanes 2/5, #3740, 11 Nov 2026): a pool worker takes the daemon flag of the thread that opened its pool, and Python's exit
    (concurrent/futures/thread.py _python_exit) joins every worker whatever that flag; the scorer opens its pool in a daemon thread
    (src/daily_search_scoring.py), so counting only non-daemon threads missed its call, and the process lived until the call returned
    (p5's replay: 158 s; CI: the app's 175 s stop). The workers are read from concurrent.futures' own registry (`_threads_queues`, the list
    `_python_exit` joins: a private name, so a Python that moves it is caught by tests/unit/press/test_press_ends.py), never told by a thread name."""
    current = threading.current_thread()
    workers = _pool_workers()
    return [t for t in threading.enumerate() if t is not current and t is not threading.main_thread() and not any(t is s for s in skip)
            and t.is_alive() and (not t.daemon or any(t is w for w in workers))]


def _pool_workers():
    """Every thread concurrent.futures will join at exit (its registry, read under its own lock); none if this Python keeps them elsewhere."""
    from concurrent.futures import thread as pool_threads
    try:
        with pool_threads._global_shutdown_lock:
            return list(pool_threads._threads_queues)
    except AttributeError:
        return []


def leave(code):
    """The one hard exit: run the exit handlers for at most run_exit.HANDLERS (src/press/budget.json), then end the process now, whatever thread still runs.
    Why (lanes 2/5, 11 Nov 2026): os._exit skips atexit, where the queued notifications are sent (src/notify.py flush), a run with no result
    publishes one (src/run_result.py), a replay says what came from its tape (src/search_tape.py _report) and decide says its calls (#3339);
    since 2/5 a run with a call in flight leaves here, so every handler runs first, not the one that was found missing. They run beside, on a
    limit, so a handler that hangs (a message that never sends) cannot hold the process past its deadline either; that is said, not silent."""
    import atexit
    sys.stdout.flush()
    sys.stderr.flush()
    limit, ran = HANDLERS, threading.Event()
    threading.Thread(target=lambda: (atexit._run_exitfuncs(), ran.set()), name='exit-handlers', daemon=True).start()
    if not ran.wait(limit):
        print(f'Warning: the exit handlers did not end within {limit} s: leaving without them (the one still running and those after it did not finish)',
              file=sys.stderr, flush=True)
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code if isinstance(code, int) else 1)


def finish(code):
    """`code`, after the open reads ended or the run's deadline came; past the deadline the process exits here with `code`."""
    from . import time_budget
    deadline = time_budget.end() or _own[0]   # a step with its share of the press ends at its stage, not at the press's deadline
    if deadline is None or not holding():
        return code
    reads_end = deadline - HANDLERS   # the exit handlers' seconds come out of the run's share, never after it (sa, lanes 2/5)
    for thread in holding():
        if not thread.daemon:   # the open reads get what is left of the run's time and keep their answer (owner, 26 Oct 2026: "a soft stop")
            thread.join(max(0.0, reads_end - time.monotonic()))
    left = holding()
    if not left:
        return code
    print(f"⏱ {len(left)} site read(s) still open at the run's time: the next search reads those sites", file=sys.stderr, flush=True)
    leave(code)
