"""The job boards the run's web search found, read at once, before the first-jobs slice and the employer sites (owner, 26 Oct 2026: "START A
JOB SEARCH WITH SEARCHING ON GOOGLE!"; the pilot search's web search found 4 aviation boards at 37 s that were read after 1,123 employer
sites, or never). It reads the boards that gave this install jobs in this field and places before (board_yield.working) at once, then
waits for the web search started with the run (src/sources/board_web.py early) up to WEB_WAIT seconds and reads what it found; each group's
first pages are read in parallel (src/sources/board_reader.py, which only reads) and their jobs kept and put on screen at once. When they give board_yield.ENOUGH jobs in your roles and places, the employer read
keeps only its best sites (src/sources/read_budget.py short). The full board read reads their next pages later, from the pages fetched here. Without a web search in this
run (it is asked weekly or monthly per search, src/sources/board_web.py _due) the known working boards are read. A repeat Find jobs run starts them
first and reads the employer sites beside them (Beside, ps E2a-2). Tests: tests/unit/sources/test_boards_first.py."""
from ..press import budget, stage, step_yield
from ..press.run import Run

WEB_WAIT = budget.value('boards_first.WEB_WAIT')   # seconds the run waits for its web search before any employer site (the pilot search's answered at 37 s on the plan)


def run(feed_db, search, on_jobs, wait=WEB_WAIT):
    """The known working boards read now, then the web search's: their first pages' jobs in your roles and places (the report's shape), each
    group given to on_jobs at once. The full read reads their next pages beside the employer sites, from the pages fetched here (found_boards).
    A first Find jobs run's order (after its slice); a repeat run reads them beside the employer sites (Beside)."""
    from . import board_reader, read_budget
    read_budget.short(False)
    matched = []
    for _said, found in board_reader.read(Run.current(), search, early=True, wait=wait, where='before'):
        matched += _keep(feed_db, found, on_jobs)
    _enough(matched)
    return matched


def _enough(matched):
    """When the boards gave board_yield.ENOUGH jobs, the employer read starts no new site past its best READ_FLOOR (read_budget.over reads it live);
    True then."""
    from . import board_yield, read_budget
    if len(matched) >= board_yield.ENOUGH:
        read_budget.short()
        print(f'Job boards first: {len(matched)} jobs in your roles and places; the employer sites read only their best {read_budget.READ_FLOOR}', flush=True)
        return True
    return False


def _keep(feed_db, found, on_jobs):
    """Of one group of boards' first pages (early: one page per search, as the first-jobs slice; owner's pilot run, 26 Oct 2026: a board's 5 pages,
    each judged by the AI before the next, held its 16 jobs until 163 s), the new jobs in your roles and places, given to on_jobs.
    TODO(AI): this kept() moves into the run core with sf's cutover; the board reader only reads (2026-11-10)."""
    from . import aggregators, boards_ahead
    matched = aggregators.kept(feed_db, boards_ahead.NAME, found)
    if matched:
        on_jobs(matched)
    return matched


class Beside:
    """A repeat Find jobs run's boards first, read beside the employer sites (ps E2a-2, owner, 8 Nov 2026: "Both: no waits + background
    (Recommended)", whose option kept "the boards still start first"): started before the employer read, their pages fetched and their titles
    judged in a thread of their own (reader NAME of src/ai/batch_scope.py, inside the caller's side-by-side scope); the thread that owns the job
    cache keeps their jobs and shows them (deliver, after each employer site; take, at the end), as boards_ahead.Ahead does, so no SQLite
    connection crosses a thread. Each group goes with a copy of its reader's answers taken when it was judged: the reader keeps writing its
    own while the other thread keeps the group (no dict shared across threads). Run 42451932088, p7: one board read 55-165 s in front of the employer sites, 0 of 13 read."""
    NAME = 'job boards first'

    def __init__(self, search, wait=WEB_WAIT):
        import queue
        import threading
        from ..ai import slots
        from . import read_budget
        read_budget.short(False)   # in the caller's thread, before the employer read takes its deadline
        self.search, self.groups, self.matched, self.done, self.shortened, self.failed = search, queue.SimpleQueue(), [], threading.Event(), False, False
        self.thread = threading.Thread(target=slots.carry(self._read_all), args=(wait,), name='boards-first', daemon=True)
        self.thread.start()

    def _read_all(self, wait):
        import copy
        from ..ai import batch_scope
        from . import board_reader, feeds
        try:
            with stage.guard('job boards first: read') as caught, batch_scope.reader(self.NAME), step_yield.span('job_boards'):
                for _said, found in board_reader.read(Run.current(), self.search, early=True, wait=wait, where='beside'):
                    feeds.triage(found)   # judged here: the owner thread's kept() then asks nothing (the copy holds every answer it reads)
                    self.groups.put((found, copy.deepcopy(batch_scope.current())))
            if caught:   # the full board read reads them
                print(f'Warning: job boards first skipped: {caught.reason}: {caught.error}', flush=True)
        finally:
            self.done.set()

    def wait(self):
        """Until the boards' first pages are read (the full board read starts after them: it takes their fetched pages, found_boards._early)."""
        self.done.wait()

    def deliver(self, feed_db, on_jobs):
        """In the thread that owns the job cache: the groups read so far kept and shown; the employer read shortened once they give ENOUGH.
        Called from the employer read (feeds.scan on_read): a failure here warns and stops the boards, never that read (the full board read
        reads them, as when boards_first.run failed in front of it)."""
        if self.failed:
            return
        with stage.guard('job boards first: deliver') as caught:
            self._deliver(feed_db, on_jobs)
        if caught:   # the full board read reads them; the employer read goes on
            print(f'Warning: job boards first skipped: {caught.reason}: {caught.error}', flush=True)
            self.failed = True

    def _deliver(self, feed_db, on_jobs):
        import queue
        from ..ai import batch_scope
        from . import aggregators, boards_ahead
        while True:
            try:
                found, views = self.groups.get_nowait()
            except queue.Empty:
                return
            with batch_scope.using(views):
                matched = aggregators.kept(feed_db, boards_ahead.NAME, found)
            if matched:
                on_jobs(matched)
                self.matched += matched
                self.shortened = self.shortened or _enough(self.matched)

    def take(self, feed_db, on_jobs):
        """Waits for the reads to end, keeps and shows what is left: every job these boards gave (the report's shape)."""
        self.wait()
        self.deliver(feed_db, on_jobs)
        return self.matched
