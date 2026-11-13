"""A job board's rounds, handed to the search as each one ends: a round is one search word in one place (found_boards._read).

Design (13 Nov 2026, owner, asked via AskUserQuestion by sa: "Yes, hand over per round (Recommended)"): a round's jobs belong to the search the
moment the round ends. One owner: the thread that keeps the boards (found_boards.read's loop) hands them, each job once; the board's own verdict
(relevant or not, another way, read next time) is still decided once, when the board ends, and then hands only what no round gave.
Why (run 43416392766, a data analyst in Nuremberg): a board gave its jobs only when ALL its rounds had ended. Four boards read 40 new local jobs
in rounds that ended between second 35 and 125, were still in a later round at the search's end, and the search listed none of them.
Invariants: a board's thread only queues (ended); nothing is judged or kept in it. A job is handed once per board read (rest). The listener
travels on the board's own fetch function, passed down: no state of the module's own.
Tests: tests/unit/sources/test_board_rounds.py.
"""
import queue


def ended(fetch, jobs):
    """A round of the board read through `fetch` ended with these jobs (found_boards._read): told to whoever listens on that fetch (Rounds.listen),
    nobody outside a search's own read."""
    listener = getattr(fetch, 'on_round', None)
    if listener is not None and jobs:
        listener(list(jobs))


class Rounds:
    """One read of several boards: the rounds their threads ended, handed by `hand(read_item, jobs)` in the keeping thread."""

    def __init__(self, hand):
        self.hand, self.queued, self.given = hand, queue.SimpleQueue(), {}

    def listen(self, fetch, read_item):
        """`fetch`, the one function this board's read fetches through, now also carries where its rounds go (ended)."""
        fetch.on_round = lambda jobs: self.queued.put((read_item, jobs))
        return fetch

    def take(self):
        """In the keeping thread: hand the rounds ended so far."""
        while True:
            try:
                read_item, jobs = self.queued.get_nowait()
            except queue.Empty:
                return
            new = self.rest(read_item, jobs)
            if new:
                self.hand(read_item, new)

    def rest(self, read_item, jobs):
        """The jobs of this board read no round handed yet, each once; they count as handed from here on."""
        seen, new = self.given.setdefault(id(read_item), set()), []
        for job in jobs:
            if job.get('url') not in seen:
                seen.add(job.get('url'))
                new.append(job)
        return new
