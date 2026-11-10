"""Who scores which job in one Find jobs run: a job is claimed once, by the first scorer that asks, and the run's ceiling counts every claim (ts, 10 Nov 2026; owner asked via
AskUserQuestion, "Yes, build it (Recommended)"; the per-run ceiling stays score_max, 60 in the app).
Why: the first-jobs slice (src/first_jobs.py) and the scorer that runs beside the readers (src/daily_search_scoring.py) both pick jobs from the same list; without one claim they
would pay for the same score twice. A claim is never given back: a job whose score failed is the closing pass's (score_jobs), not retried in a loop here.
Tests: tests/unit/press/test_one_scorer.py."""
import threading

_lock = threading.Lock()
_claimed = []   # job ids in the order claimed
_shared = [False]   # a scorer runs beside the slice: only then do the two need to share claims (begin())


def reset():
    """A run starts with nothing claimed and no scorer beside the slice (the search calls it first, as run_counts.reset)."""
    with _lock:
        _claimed.clear()
        _shared[0] = False


def begin():
    """The scorer that runs beside the search starts: from now the slice claims its jobs too (shared())."""
    _shared[0] = True


def end():
    """The scorer beside the search has stopped: the slice, if it runs again (never in one search), needs no claim. The claims stay, for the ceiling."""
    _shared[0] = False


def shared():
    """True while a scorer runs beside the slice; a slice alone (a test, another mode) needs no claim."""
    return _shared[0]


def unclaimed(ids):
    """The ids of `ids` nobody has claimed yet, in the order given (nothing is claimed)."""
    with _lock:
        return [job_id for job_id in ids if job_id not in _claimed]


def claim(ids, ceiling=None, limit=None):
    """The ids of `ids` nobody has claimed yet, now claimed for the caller, in the order given: at most `limit` of them, and at most up to `ceiling` claims in all (None: no bound)."""
    with _lock:
        taken = []
        for job_id in ids:
            if job_id in _claimed or job_id in taken:
                continue
            if (ceiling is not None and len(_claimed) + len(taken) >= ceiling) or (limit is not None and len(taken) >= limit):
                break
            taken.append(job_id)
        _claimed.extend(taken)
        return taken
