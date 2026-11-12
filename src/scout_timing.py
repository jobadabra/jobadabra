"""Where the scout's feed pass spends its workers' time: answer-cache lookups, place-file reads, search-config reads (measure only, no behaviour change).
Why (12 Nov 2026, jobadabra-lab #87): the last runs ended on the feed clock, not the AI cap, and the workers' stack dumps sat mostly in these three
local reads (one dump a run, a hypothesis); this prints the time each took, once, so a fix is judged by a number. It wraps the three functions only
while the pass runs and restores them after: nothing is kept between passes and the Find jobs search path is not touched."""
import contextlib
import threading
import time

# (module, attribute, what the log calls it): the feed pass's callers look each up at call time (decide's own kept, geo.load's _read, page_reader's
# import inside wanted_text), so wrapping the attribute reaches them; a caller that bound the name at its import keeps the original and is not counted.
TIMED = (('.ai.decide', 'kept', 'answer-cache lookups'), ('.geo', '_read', 'place-file reads'),
         ('.paths', 'load_search_config', 'search-config reads'))


class Tally:
    """Seconds and calls per timed function, summed over the threads that ran them."""

    def __init__(self):
        self.lock = threading.Lock()
        self.seconds = {name: 0.0 for _, _, name in TIMED}
        self.calls = {name: 0 for _, _, name in TIMED}

    def add(self, name, seconds):
        with self.lock:
            self.seconds[name] += seconds
            self.calls[name] += 1

    def line(self, workers, wall):
        """The one log line: each timed read's thread-seconds and calls, against the pass's thread-seconds (workers x wall clock)."""
        parts = ', '.join(f'{name} {self.seconds[name]:.0f} s in {self.calls[name]} calls' for _, _, name in TIMED)
        # Why (Gitar, #3880): the pass ends on its deadline while late fetches still run; their reads come after the restore and are not in these numbers.
        return f'Scout feed pass time ({workers} workers x {wall:.0f} s = {workers * wall:.0f} thread-seconds, reads after the pass ended not counted): {parts}'


def _timed(tally, name, fn):
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            return fn(*args, **kwargs)
        finally:
            tally.add(name, time.perf_counter() - start)
    return wrapper


@contextlib.contextmanager
def feed_pass(workers):
    """Time the three local reads while the block runs, then print one line; the original functions are back on exit, even on an error."""
    import importlib
    tally, saved, start = Tally(), [], time.monotonic()
    for module_name, attr, name in TIMED:
        module = importlib.import_module(module_name, __package__)
        saved.append((module, attr, getattr(module, attr)))
        setattr(module, attr, _timed(tally, name, getattr(module, attr)))
    try:
        yield tally
    finally:
        for module, attr, fn in saved:
            setattr(module, attr, fn)
        print(tally.line(workers, time.monotonic() - start))
