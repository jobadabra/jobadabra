"""Queue completed board rounds for their reader's consumer; its final result never hands them twice."""
import queue


class Handoff:
    """Pool threads only queue rounds. The owning reader drains them in its existing title/place answer scope."""

    def __init__(self, notify, early):
        self.notify, self.early, self.seen, self.rounds = notify, early, set(), queue.SimpleQueue()

    def options(self):
        """Enable round handoff for early reads with a consumer; ordinary reads retain their final-board handoff."""
        return {'on_jobs': self.rounds.put} if self.early and self.notify is not None else {}

    def waiting(self):
        """Drain early rounds while the reader waits for whole boards; ordinary reads keep their existing wait."""
        return {'on_progress': self.flush} if self.early and self.notify is not None else {}

    def flush(self):
        """Hand every ready round in the calling reader thread, before waiting for more board results."""
        while True:
            try:
                jobs = self.rounds.get_nowait()
            except queue.Empty:
                return
            self(jobs)

    def __call__(self, jobs):
        """Hand only fresh early URLs; ordinary reads retain their per-board callbacks."""
        if self.notify is None:
            return
        if not self.early:
            self.notify(jobs)
            return
        fresh = []
        for job in jobs:
            if job['url'] not in self.seen:
                self.seen.add(job['url'])
                fresh.append(job)
        if fresh:
            self.notify(fresh)
