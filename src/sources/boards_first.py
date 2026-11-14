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
        self.arrived = threading.Event()   # Why (13 Nov 2026, eo): wakes the job-cache thread's wait for the full board read when a group lands (boards_ahead.Ahead.wait)
        self.step_ended = threading.Event()   # set when the first-jobs step ends (daily_search); a lane with no such step (no `listed`) goes on at once
        if listed is None:
            self.step_ended.set()
        end = read_budget.run_end()
        reads = [(self._known, None)] + ([(lambda _wait: self._listed(listed), slots.FIRST)] if listed else [])   # the slice's boards kept its FIRST level
        self.count, self.left = threading.Lock(), len(reads)
        self.urls = set()   # the links handed board by board: a list that returns copies of them hands none twice
        self.handed, self.order = {}, []   # {id: job} handed board by board (held, so an id is never reused); the groups' links in the list's order
        self.read = []   # every job the lane put, in the order read: the last judging pass asks about the ones still owed an answer (_pass)
        self.passed, self.closed, self.woken, self.done_pass = threading.Event(), threading.Event(), threading.Event(), None   # the pass ended (its Done in done_pass); close() ends its wait, wake() re-reads its time
        self.track = None   # what the pass set out to ask (board_pass.Track), for the last hand-over when it is still out at the deadline
        self.now = threading.Event()   # the last hand-over came with every board ended: the pass starts at once, not at its time
        self.threads = [threading.Thread(target=slots.carry(self._read, level), args=(read, end, wait), name='boards-first', daemon=True)
                        for read, level in reads]
        if read_budget.pass_at() is not None:   # Why (#4187 try 2, pair 43601353056): the main thread came to the last hand-over at 161-174 s, held by scoring
            self.threads.append(threading.Thread(target=slots.carry(self._pass), name='boards-pass', daemon=True))
        for thread in self.threads:
            thread.start()

    def _read(self, read, end, wait):
        """One group source of the lane in its own thread, to the lane's end; the lane is done when every source has ended."""
        from ..ai import batch_scope, slots
        try:
            with slots.in_lane(end, self.go_on), stage.guard('job boards first: read') as caught, batch_scope.reader(self.NAME), step_yield.span('job_boards'):
                read(wait)
            if caught:   # the full board read reads them
                print(f'Warning: job boards first skipped: {caught.reason}: {caught.error}', flush=True)
        finally:
            self._ended()

    def _ended(self):
        """One of the lane's reads (a group source, a board's read-on) ended; the lane is done when none is open."""
        with self.count:
            self.left -= 1
            if not self.left:
                self.done.set()
        self._notify()

    def go_on(self, read_on, name):
        """A lane board's read past its first jobs (found_boards.read_board): read_on(on_round) -> its jobs, run in its own thread once the
        first-jobs step has ended, at most to the lane's end; its jobs are handed as the board's slice's were. The lane stays open until it ends.
        Why (Gitar, #4200): read inside the board's own read it held one of the boards' workers while it waited for the step (a later board's
        slice started late) and the board was kept only once it ended (a read-on cut at the lane's end lost the board's record and pages)."""
        import threading
        from ..ai import slots
        with self.count:
            if self.done.is_set():   # the lane has ended: nobody would take its jobs
                print(f'Job boards: {name}: next pages and other words not asked (the boards\' lane has ended)', flush=True)
                return
            self.left += 1
        threading.Thread(target=slots.carry(self._read_on, slots.NORMAL), args=(read_on, name), name='boards-read-on', daemon=True).start()

    def _read_on(self, read_on, name):
        # Why (sa, 14 Nov 2026, pairs 1-2 of #4180): at NORMAL, the known boards' level, never the slice's FIRST, and only after the first-jobs
        # step (its title batches waited 21 s behind read-on calls already in a slot; a level cannot take a slot back)
        from ..ai import batch_scope
        from . import read_budget
        try:
            self.step_ended.wait(read_budget.seconds_left(read_budget.lane_end()))
            if read_budget.past_cut():
                print(f'Job boards: {name}: next pages and other words not asked (time is up)', flush=True)
                return
            # the lane's reader, as its source threads (_read): its title and place answers and its groups' views are the lane's (Gitar, #4208)
            with batch_scope.reader(self.NAME), stage.guard('found boards: read on') as caught:   # a failure keeps what its rounds handed
                self._hand_new(read_on(self._hand_new))
            if caught:
                print(f'Warning: {name}: its read did not go on: {caught.reason}: {caught.error}', flush=True)
        finally:
            self._ended()

    def _hand_new(self, found):
        """Of a read-on's jobs, the ones the lane has not handed yet (its slice's, its earlier rounds', another board's), handed as _hand does.
        Claimed in the same lock that picks them (Gitar, #4210): read-ons run at once, and two could pick the same job."""
        with self.count:
            new = list({job.get('url'): job for job in found or [] if job.get('url') not in self.urls}.values())
            self.handed.update((id(job), job) for job in new)
            self.urls.update(job.get('url') for job in new)
        if new:
            self._put(new)

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
                rest = [job for job in found if id(job) not in self.handed and job.get('url') not in self.urls]   # not handed board by board, by the other source either
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
        # TODO(AI): pass on_board always once L10's proof stand-in (test_board_lane_clock board_list, a locked ledger proof) takes it (#3915)
        by_board = 'on_board' in inspect.signature(listed).parameters   # a stand-in list without boards of its own gives its whole list
        found = listed(on_board=self._hand) if by_board else listed()
        with self.count:
            rest = [job for job in found or [] if id(job) not in self.handed and job.get('url') not in self.urls]
        if rest:
            self._put(rest)

    def _put(self, found):
        from . import boards_ahead, feeds, job_stage
        with self.count:
            self.read += found
        job_stage.say_read(boards_ahead.NAME, found)   # the stage log's line per job read, before any filter
        feeds.triage(found)   # judged here: the owner thread's kept() then asks nothing (the copy holds every answer it reads)
        self._queue(found)

    def _queue(self, found):
        """`found` to be kept and shown by the thread that owns the job cache (deliver), with a copy of the answers this thread sees."""
        import copy
        from ..ai import batch_scope
        self.groups.put((found, copy.deepcopy(batch_scope.current())))
        self.arrived.set()
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

    def _pass(self):
        """The lane's last judging pass, in a thread of its own at the pass's time (read_budget.pass_at), whatever the main thread is doing: the jobs the
        lane read that the AI still owes an answer are placed, then title-judged (src/sources/board_pass.py), into the shared answer stores only.
        Design (owner, 14 Nov 2026, asked via AskUserQuestion: "Judge in search + show both (Recommended)"; sa, try 2 of #4187)."""
        from . import board_pass, read_budget
        try:
            while not self.closed.is_set():   # the pass's time read again every BETWEEN_S (a grain, never a deadline) or when woken
                left = read_budget.seconds_left(read_budget.pass_at())
                if not left or self.now.is_set():
                    break
                self.woken.wait(min(left, read_budget.BETWEEN_S))
                self.woken.clear()
            if self.closed.is_set():
                return
            with self.count:
                read = list(self.read)
            self.track = board_pass.Track()
            self.done_pass = board_pass.judge(read, self.track)
        finally:
            self.passed.set()

    def close(self):
        """The search ends without its last hand-over (a test): the pass waiting for its time asks nothing."""
        self.closed.set()
        self.woken.set()

    def wake(self):
        """The pass reads its time again now, not at its next grain (a test that sets the clock)."""
        self.woken.set()

    def last_pass(self, feed_db, on_jobs):
        """The run's last hand-over (daily_search.keep_late_boards), in the thread that owns the job cache, whenever scoring lets it come (past the
        run's end too): the groups that landed kept and shown; the lane's pass (_pass) waited for, at most to the deadline; the jobs it answered kept
        again (no AI call: kept() reads the answers it left), the ones it settled (listed or refused) taken off the queue's list; then the groups of
        the reads still open, to the run's end, which wait for the queue after the search as before. Says what the pass did, or that it did not run.
        Design (owner, 14 Nov 2026, asked via AskUserQuestion: "Judge in search + show both (Recommended)"; L05: "Yes, stop new reads then (Recommended)")."""
        from .. import time_budget
        from . import board_pass, read_budget, waiting_jobs
        at, end = read_budget.pass_at(), read_budget.run_end()
        if at is not None and not self.done.is_set() and read_budget.seconds_left(at):
            self.take(feed_db, on_jobs, until=at)
        self.deliver(feed_db, on_jobs)
        if at is not None and self.done.is_set():
            # Why (#4199, CI store + strategy suites on e0d6e55c): with every board ended the pass still waited for its time, and a search
            # done early sat idle until it (9 store files past 180 s); try 1 judged here once the lane was done
            self.now.set()
            self.woken.set()
        if at is not None:
            self.passed.wait(read_budget.seconds_left(time_budget.end()))
        # Why (#4199 try 3, pair 43604153744, d05): a pass still out at the deadline listed nothing; what its answers cover by then is listed
        done = self.done_pass if self.passed.is_set() else board_pass.cut(self.track) if self.track is not None else None
        listed = 0
        if done is not None and board_pass.listable(done):
            before = len(self.matched)
            self._queue(board_pass.listable(done))
            self.deliver(feed_db, on_jobs)
            listed = len(self.matched) - before
            # Why (Gitar on #4187): a job the pass refused (title no, place outside) kept its waiting row and the queue asked about it again
            waiting_jobs.listed(feed_db, board_pass.settled(done, {item.get('url') for item in self.matched[before:]}))
        print(done.said(listed) if done is not None else 'Board pass: not run: ' + ('the search has no time budget' if at is None
              else 'it had not begun by the deadline'), flush=True)
        if end is not None and not self.done.is_set() and read_budget.seconds_left(end):
            print("Job boards: still being read; the search waits for them to its own end", flush=True)
            self.take(feed_db, on_jobs, until=end)
        self.deliver(feed_db, on_jobs)

    def _in_list_order(self, matched):
        """`matched` in the order the boards' groups list their jobs, whichever board ended first; jobs of a group still being read, of
        `listed`, or of a board's read-on (go_on: a second read, after the first-jobs step, in no group), after them in the order they came.
        The list's order, not a priority (src/press/rank.py orders what a person sees).
        Why (#3892, 12 Nov 2026, its CI): handed board by board, the gather's jobs followed the threads' timing, and the boards' reader
        contract (tests/unit/sources/test_board_reader.py) reads that order."""
        with self.count:
            turn = {url: n for n, url in enumerate(self.order)}
        by_turn = [[] for _ in range(len(turn) + 1)]
        for item in matched:
            by_turn[turn.get(item.get('url'), len(turn))].append(item)
        return [item for items in by_turn for item in items]
