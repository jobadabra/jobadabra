"""The job boards the run's web search found, read at once, beside the first-jobs slice and the employer sites (owner, 26 Oct 2026: "START A
JOB SEARCH WITH SEARCHING ON GOOGLE!"; the pilot search's web search found 4 aviation boards at 37 s that were read after 1,123 employer
sites, or never). It reads the boards that gave this install jobs in this field and places before (board_yield.working) at once, then
waits for the web search started with the run (src/sources/board_web.py early) up to WEB_WAIT seconds and reads what it found; each group's
first pages are read in parallel (src/sources/board_reader.py, which only reads) and their jobs kept and put on screen at once. When they give board_yield.ENOUGH jobs in your roles and places, the employer read
keeps only its best sites (src/sources/read_budget.py short). The full board read reads their next pages later, from the pages fetched here. Without a web search in this
run (it is asked weekly or monthly per search, src/sources/board_web.py _due) the known working boards are read. Every Find jobs run starts them
at second 0 as a lane of their own (Beside), ending at the run's end, not at the employer sites' read cut (lanes 4a); a first run's own board
list (src/first_jobs.py board_jobs) is read in the same lane. Tests: tests/unit/sources/test_boards_first.py, tests/unit/sources/test_board_lane_clock.py."""
from ..press import budget, stage, step_yield
from ..press.run import Run

WEB_WAIT = budget.value('boards_first.WEB_WAIT')   # seconds the run waits for its web search before any employer site (the pilot search's answered at 37 s on the plan)


def _enough(matched):
    """When the boards gave board_yield.ENOUGH jobs, the employer read starts no new site past its best READ_FLOOR (read_budget.over reads it live);
    True then."""
    from . import board_yield, read_budget
    if len(matched) >= board_yield.ENOUGH:
        read_budget.short()
        print(f'Job boards first: {len(matched)} jobs in your roles and places; the employer sites read only their best {read_budget.READ_FLOOR}', flush=True)
        return True
    return False


class Beside:
    """The job boards' lane, started at second 0 of every Find jobs run (lanes 4a, owner, 11 Nov 2026: "Run's deadline, own lane (Recommended)";
    before, a repeat run only, ps E2a-2): their pages fetched and their titles judged in threads of their own (reader NAME of
    src/ai/batch_scope.py, inside the caller's side-by-side scope), reading until the run's end (src/ai/slots.py in_lane), not the
    employer sites' read cut. Groups: the boards known for this field and the web search's (src/sources/board_reader.py), and beside them
    `listed` when given (a first run's own board list, src/first_jobs.py board_jobs). The thread that owns the job cache keeps their jobs and
    shows them (deliver: in the first-jobs step through `notify`, after each employer site, then `take` until the lane ends), as
    boards_ahead.Ahead does, so no SQLite connection crosses a thread. Each group goes with a copy of its reader's answers taken when it was
    judged: the reader keeps writing its own while the other thread keeps the group (no dict shared across threads).
    Run 42451932088, p7: one board read 55-165 s in front of the employer sites, 0 of 13 read (why the boards are beside them, never in front)."""
    NAME = 'job boards first'

    def __init__(self, search, wait=None, listed=None):
        import queue
        import threading
        from ..ai import slots
        from . import read_budget
        read_budget.short(False)   # in the caller's thread, before the employer read takes its deadline
        self.search, self.groups, self.matched, self.done, self.shortened, self.failed = search, queue.SimpleQueue(), [], threading.Event(), False, False
        self.notify = None   # set by the thread that owns the job cache while it waits elsewhere (the first-jobs step's hub): called after each group
        end = read_budget.run_end()
        reads = [(self._known, None)] + ([(lambda _wait: self._listed(listed), slots.FIRST)] if listed else [])   # the slice's boards kept its FIRST level
        self.count, self.left = threading.Lock(), len(reads)
        self.urls = set()   # the links handed board by board: a list that returns copies of them hands none twice
        self.handed, self.order = {}, []   # {id: job} handed board by board (held, so an id is never reused); the groups' links in the list's order
        self.threads = [threading.Thread(target=slots.carry(self._read, level), args=(read, end, wait), name='boards-first', daemon=True)
                        for read, level in reads]
        for thread in self.threads:
            thread.start()

    def _read(self, read, end, wait):
        """One group source of the lane in its own thread, to the lane's end; the lane is done when every source has ended."""
        from ..ai import batch_scope, slots
        try:
            with slots.in_lane(end), stage.guard('job boards first: read') as caught, batch_scope.reader(self.NAME), step_yield.span('job_boards'):
                read(wait)
            if caught:   # the full board read reads them
                print(f'Warning: job boards first skipped: {caught.reason}: {caught.error}', flush=True)
        finally:
            with self.count:
                self.left -= 1
                if not self.left:
                    self.done.set()
            self._notify()

    def _known(self, wait):
        """The boards known for this field, then the web search's, waited for to the lane's end (its declared need, reader_rows LANES)."""
        from . import board_reader, read_budget
        if wait is None:
            left = read_budget.seconds_left(read_budget.cut_at())
            wait = WEB_WAIT if left is None else max(0.0, left)
        # Why (#3892, 12 Nov 2026): each board handed as it is kept, not its group at its slowest board's end (a board kept early waited for the
        # group past the titles' time); the whole group, when it ends, gives the list's order take() returns
        for _said, found in board_reader.read(Run.current(), self.search, early=True, wait=wait, where='beside', on_board=self._hand):
            with self.count:
                rest = [job for job in found if id(job) not in self.handed]   # a reader that hands no board on its own: its whole group
                self.order += [job.get('url') for job in found]
            if rest:
                self._put(rest)

    def _hand(self, found):
        """One board's jobs, kept by found_boards.read: judged and queued now, remembered so its group does not queue them twice."""
        with self.count:
            self.handed.update((id(job), job) for job in found)
            self.urls.update(job.get('url') for job in found)
        self._put(found)

    def _listed(self, listed):
        """A first run's own boards (the pool's proven ones, else the ones proposed for your country), read as the first-jobs step read them.
        Why (lanes 4a, owner, 11 Nov 2026, L10: "the first-jobs step reads employer sites and scores them without waiting for the boards"):
        read inside the slice, they held it to the read cut (68 s for 5 of 7 people) and ended there with 2-6 boards still open."""
        # Why (12 Nov 2026, the 30 fixed profiles; #3892 did it for the known boards only): the list came back only when its slowest board
        # ended, which with one board still open is the search's own end, after the last hand-over: Vienna read 41 fitting jobs from three
        # boards and listed 0, Krakow 24 and 0. Each board is handed as it is kept; what the whole list still holds follows once.
        import inspect
        by_board = 'on_board' in inspect.signature(listed).parameters   # a stand-in list without boards of its own gives its whole list
        found = listed(on_board=self._hand) if by_board else listed()
        with self.count:
            rest = [job for job in found or [] if id(job) not in self.handed and job.get('url') not in self.urls]
        if rest:
            self._put(rest)

    def _put(self, found):
        import copy
        from ..ai import batch_scope
        from . import feeds
        feeds.triage(found)   # judged here: the owner thread's kept() then asks nothing (the copy holds every answer it reads)
        self.groups.put((found, copy.deepcopy(batch_scope.current())))
        self._notify()

    def _notify(self):
        notify = self.notify
        if notify is not None:
            notify()

    def wait(self):
        """Until the boards' first pages are read (the full board read starts after them: it takes their fetched pages, found_boards._early), at most
        to the caller's read cut. Why (lanes 4a): the lane now reads to the run's end; the full board read (src/sources/boards_ahead.py, outside the
        lane) reads nothing past its cut, so waiting longer only held the employer read and the free APIs' stage behind it."""
        from . import read_budget
        self.done.wait(read_budget.seconds_left(read_budget.cut_at()))

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

    def take(self, feed_db, on_jobs, until=None):
        """Keeps and shows each group as it lands until the lane ends or, when given, the monotonic time `until`: every job these boards gave so far
        (the report's shape). Why (#3826, Gitar): the gather took it to the lane's end (~170 s), holding the import and every score behind the
        boards; the gather now takes it to the employer sites' cut, as before lanes 4a, and later groups are kept between the stages after it."""
        from . import read_budget
        while not self.done.wait(min(1.0, read_budget.seconds_left(until) if until is not None else 1.0)):
            self.deliver(feed_db, on_jobs)
            if until is not None and not read_budget.seconds_left(until):
                break
        self.deliver(feed_db, on_jobs)
        return self._in_list_order(self.matched)

    def _in_list_order(self, matched):
        """`matched` in the order the boards' groups list their jobs, whichever board ended first; jobs of a group still being read, or of
        `listed`, after them in the order they came. The list's order, not a priority (src/press/rank.py orders what a person sees).
        Why (#3892, 12 Nov 2026, its CI): handed board by board, the gather's jobs followed the threads' timing, and the boards' reader
        contract (tests/unit/sources/test_board_reader.py) reads that order."""
        with self.count:
            turn = {url: n for n, url in enumerate(self.order)}
        by_turn = [[] for _ in range(len(turn) + 1)]
        for item in matched:
            by_turn[turn.get(item.get('url'), len(turn))].append(item)
        return [item for items in by_turn for item in items]
