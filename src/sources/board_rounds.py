"""Each round of a job board's first-search read (one search word in one place: found_boards._read) handed on as it ends, so a board still open
at the search's end gives what its first rounds read instead of nothing.
Why (rs, 13 Nov 2026, sa's go on the measured cause): a board's jobs reached the judge only when its whole read ended, and in a first search
that read is up to 4 rounds of ~25-45 s each (a link-wording AI question, its job pages, a one-posting question): on night 43313523472
Brussels's carpenter had 8 boards still open at 124 s and got 0 board jobs, and so did most national boards of Bucharest, Zurich, Krakow and
Zagreb. One owner of what is kept: found_boards.read's keep() hands only what no round handed (Rounds.rest). One deadline: the rounds are
waited for inside read_budget.as_done, as its `feeders`, and a board still open at the cut is never waited for. Hands are made in the read
loop's own thread, as keep()'s are: the judge reads that thread's scope (src/ai/batch_scope.py is per thread).
Tests: tests/unit/sources/test_board_rounds.py."""
import threading
from concurrent.futures import Future


class Rounds:
    """The rounds of the boards one found_boards.read is reading. hand(owner item, jobs) runs in the read loop's thread for each round's new
    jobs. `feeders` is the dict read_budget.as_done waits on: each board read's chain of round futures, entered by the loop's thread only."""

    def __init__(self, hand):
        self.hand, self.feeders, self.handed, self.lock, self.fresh = hand, {}, {}, threading.Lock(), []

    def chain(self, owner):
        """A new board read's chain whose jobs take `owner`'s turn; its first future is a feeder from now on (call in the loop's thread)."""
        chain = Chain(owner)
        self.feeders[chain.at] = self._join
        self.fresh.append(chain.at)   # a board named later (board_later): its first future joins the loop with it (joining)
        return chain

    def waited(self, feeders):
        """The feeders the read loop waits on: these (the boards named later, board_later.named) and every chain started so far."""
        self.fresh.clear()   # the chains started so far are in the loop's first list
        self.feeders = {**self.feeders, **{future: joining(join, self) for future, join in feeders.items()}}
        return self.feeders

    def rest(self, read_item, jobs):
        """The jobs of `read_item` that no round handed yet, marked handed now: each job is handed on once."""
        with self.lock:
            told = self.handed.setdefault(id(read_item), set())
            new = [job for job in jobs if job.get('url') not in told]
            told.update(job.get('url') for job in new)
        return new

    def _join(self, got):
        """One round ended (in the loop's thread): its new jobs handed on; -> the chain's next future to wait on, none once the read ended."""
        owner, read_item, jobs, after = got
        new = self.rest(read_item, jobs) if read_item is not None else []
        if new:
            print(f"Job boards: {read_item[0]['name']} gave {len(new)} job(s) so far; the rest of it is still being read", flush=True)
            self.hand(owner, new)
        if after is None:
            return []
        self.feeders[after] = self._join
        return [after]


def joining(join, rounds):
    """A board_later feeder's join whose boards' first round futures are waited for with them."""
    def joined(named):
        started = join(named)
        fresh, rounds.fresh[:] = list(rounds.fresh), []
        return started + fresh
    return joined


class Chain:
    """One board read's rounds, set from its pool thread: a round's end completes the waited future with its jobs and the next future; the
    read's end (close, always) completes the last one with none, so the loop never waits for a read that ended."""

    def __init__(self, owner):
        self.owner, self.at = owner, Future()

    def on_round(self, read_item):
        """found_boards._read's on_round for `read_item` (the board read in owner's turn: itself or a spare read in its place)."""
        def ended(jobs):
            after, done = Future(), self.at
            self.at = after
            done.set_result((self.owner, read_item, list(jobs), after))
        return ended

    def close(self):
        self.at.set_result((self.owner, None, [], None))
