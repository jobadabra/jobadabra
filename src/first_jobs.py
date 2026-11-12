"""First jobs in seconds (spec docs/superpowers/specs/2026-10-16-first-jobs-fast.md): before a search's full crawl, read a small slice of fast feeds,
score 3 jobs at once and save (and sync) each as it is scored, so a new user's list has its first job while the rest of the search runs;
while none of them fits 70+, 3 more, up to MAX_FIRST (owner, 18 Oct 2026: Cluj's slice found 70 jobs at 93 s, scored 3, and its first 70+
waited for the full crawl until 431 s). The 2 job boards that gave installs like this one the most jobs in their places are read in the
slice too (spec 2026-10-18-search-learns-sources.md PR 6); with none shared yet, the 6 first boards proposed for the user's country (one
cached AI call, the same the full read makes; owner, 18 Oct 2026: a driver's jobs all came from a board read after 140 employer sites),
read at once and while the employer sites are (18 Oct 2026: Chisinau's first 2 boards gave nothing; SRE's 70+ waited for 2 boards), each
one that refuses automated reading replaced by the next proposed board (19 Oct 2026: 4 of music's first boards refused, XING was 7th).
The search after it is unchanged; scored jobs are skipped by their hash, so the total AI calls are the same.
The employer sites' jobs are imported and scored without waiting for another reader; one still reading joins when it finishes (#2913). The job
boards are read in their own lane (src/sources/boards_first.py Beside) since lanes 4a; this step keeps and shows its groups.
Tests: tests/unit/sources/test_first_jobs.py, tests/unit/sources/test_first_jobs_slow_boards.py, tests/unit/sources/test_proven_boards.py."""
import os
from concurrent.futures import Future, ThreadPoolExecutor

from . import store
from .press import budget, rank, scorer as claims
from .ai import score, slots, title_queue
from .sources import ats, feeds

SLICE = budget.value('first_jobs.SLICE')     # feeds read first
FIRST_JOBS = budget.value('first_jobs.FIRST_JOBS')  # jobs scored first, at once
MAX_FIRST = budget.value('first_jobs.MAX_FIRST')  # scored at most in the slice while none fits FIT+ yet: the full search would score these same best-ranked jobs anyway
FIT = 70        # a strong match ends the slice's scoring (src/source_yield.py FIT)
SLICE_BOARDS = budget.value('first_jobs.SLICE_BOARDS')   # read at once (owner, 19 Oct 2026: music's only paying board, XING, was 7th of the proposal and read at 351 s; up to
                   # board_yield.MAX_UNTRIED, the untried boards one read takes); a board that refuses is replaced by the next proposed one, once
FAST = ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee', 'personio', 'teamtailor', 'join')   # a JSON list in one request


def pick(sources, size=SLICE):
    """The feeds read first: the ones that answer in one request (fast kinds), then the others; each group in the list's own order
    (the index ranks it). A page read in Chrome belongs to one install's visits, not to this slice."""
    usable = [source for source in sources if source.get('ats', 'greenhouse') in ats.FETCHERS and source.get('ats') != 'visit']
    return rank.sources(usable, rank.fast_to_read(FAST))[:size]


def to_score(db, hidden):
    from .daily_helpers import to_score as eligible
    return eligible(db, hidden)


def board_jobs(say=print, search=None, on_board=None):
    """The jobs (as read) of the job boards that gave installs like this one the most jobs in their places (no AI call: the pool's
    ranking, src/ai/board_ideas.py proven), else of the first boards proposed for this search's countries that never refused us; read now,
    and the full search's board read reuses the pages fetched here. Touches no job cache: it runs beside the employer sites' read.
    on_board(jobs): each board's jobs as soon as that board is kept (found_boards.read), so one slow board holds back none of the others."""
    if os.getenv('JOBADABRA_FIXTURE_DIR'):   # the end-to-end fixture mode never reaches a live site (as aggregators.scan)
        return []
    from .ai import board_ideas
    from .paths import load_search_config
    from .sources import found_boards
    search = search or load_search_config()
    top, spare = board_ideas.proven(search, limit=SLICE_BOARDS), []
    if top:
        say(f"First jobs: reading {', '.join(board['name'] for board in top)}, the job board{'s' if len(top) > 1 else ''} that gave people "
            'like you the most jobs')
    else:
        _wait_early(search)
        proposed = _proposed(board_ideas, search)
        top, spare = proposed[:SLICE_BOARDS], proposed[SLICE_BOARDS:2 * SLICE_BOARDS]
        if not top:
            return []
        say(f"First jobs: reading {', '.join(board['name'] for board in top)}, job board{'s' if len(top) > 1 else ''} for your country")
    # a board that refuses gives its place to the next proposed one at once, in the same read (19 Oct 2026: a second wave after the first
    # made Finance's slice wait 35 s)
    return found_boards.read(search, top, early=True, workers=SLICE_BOARDS, spare=spare, on_board=on_board)


_early = {}   # the slice's board proposal asked once the employers are named (propose_early): {'search': ..., 'future': ...}


def propose_early(search=None):
    """Ask the slice's board proposal (board_ideas.ideas: its AI answers are cached per search) now, in the background, once the search has
    named its employers (src/daily_search.py start_proposal), beside the reading -> its future, or None when the slice needs none (proven boards, the end-to-end fixture mode). The slice waits for
    it (_wait_early) and builds its list then, from the cached answers and the boards the pool serves at that time.
    Why (#2913, 2 Nov 2026): no longer asked at second 0. Its serial calls (field, then slice: 73 s on the Codex relay) held the shared AI while
    the employer pick's calls waited 15-25 s each, so the employers were named at 122 s and 0 of 15 were read (zero run 41346903877; the same step
    took 4 s before the relay). FIRST priority (src/ai/slots.py) does not cure it: it orders who takes a free slot, a running 30-43 s call keeps
    its slot, and the relay has no slots. The #2218 reason below still holds for asking inside the slice, so it is asked just before it.
    Why (#2218, 27 Oct 2026, benchmark run 40446066828): asked inside the slice, its 2 AI calls waited for Claude's 2 slots behind the
    employer titles and the web search, so the boards started at 41-63 s and the read cut (67 s) left them 5-26 s: 0 board jobs.
    Why (#2218, its rerun 40449103205): only the AI's answers are taken early, never the list: at 10 s the pool's index is not downloaded
    yet, and an early list lost its shared boards (aviationcv.com, hipo.ro)."""
    if os.getenv('JOBADABRA_FIXTURE_DIR'):
        return None
    from .ai import board_ideas
    from .paths import load_search_config
    search = search or load_search_config()
    if board_ideas.proven(search, limit=SLICE_BOARDS):
        return None
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='board-proposal')
    future = pool.submit(slots.carry(board_ideas.ideas, slots.FIRST), search)   # its boards are the slice's local boards
    pool.shutdown(wait=False)
    _early.clear()
    _early.update(search=search, future=future)
    return future


def _wait_early(search):
    """The early proposal of this same search ended (waited for until the read cut at most), so the slice's own ask finds its answers
    cached instead of asking again; nothing for another search or none started. Taken once."""
    future = _early.pop('future', None) if _early.get('search') == search else None
    _early.clear()
    if future is None:
        return
    from .sources import read_budget
    try:
        future.result(timeout=read_budget.seconds_left(read_budget.cut_at()))
    except Exception:  # noqa: BLE001 — late or failed: the slice asks itself (a late answer is cached when it comes)
        pass


def _refused(board_ideas):
    """The hosts of the boards that refused automated reading (a 'browser' read)."""
    return {host for host, entry in (board_ideas.load().get('boards') or {}).items() if entry.get('state') == 'browser'}


def _proposed(board_ideas, search):
    """The boards proposed for this search's countries that never refused us, in the proposal's order."""
    refused = _refused(board_ideas)
    return [board for board in board_ideas.ideas(search) if board.get('host') not in refused]


def scored_fits(db):
    """{job id: fit score} of the jobs scored so far."""
    from .source_yield import _fits
    try:
        return {str(job_id): fit for job_id, fit in _fits(db).items()}
    except Exception:  # noqa: BLE001 — unknown: the slice scores its next batch
        return {}


def run(db, feed_db, sources, profile, hidden, sync, say=print, scan=None, scorer=None, model=None, size=SLICE, first=FIRST_JOBS,
        fits=None, import_jobs=None, others=None, lane=None, lane_jobs=None):
    """Read `size` feeds while the other readers started with the search (others: {name: future}, default EURES's early read) read too; import what matches and score `first` jobs at a time (the nearest read so far, any source), a sync after every score,
    until one fits FIT+ or MAX_FIRST are scored. -> how many were scored. A failure here never blocks the search: the full run that follows does everything the
    slice did.
    Why (#2918, owner 5 Nov 2026: "One clear order first"; 6 Nov 2026: "Score from the nearest batches as they land"): every reader's titles are sorted in one
    queue, nearest place first (src/ai/title_queue.py), and the jobs of each batch that fits reach scoring as it lands, from any reader, so the first job waits
    for one batch, not for a reader's whole sort, and a Toulouse press scores the jobs near Toulouse instead of 6 in Paris while EURES's rows wait.
    Threads: this one is the hub (it owns the job store); the other readers only read, then it sorts and imports what they read, in `join`.
    lane: the job boards' lane (src/sources/boards_first.py Beside), read beside the slice from second 0: each group it lands is kept and shown by
    this hub (lane_jobs), never waited for. Why (lanes 4a, owner, 11 Nov 2026: L10 "the first-jobs step reads employer sites and scores them
    without waiting for the boards"): the slice read its boards itself and waited for them to the read cut (68 s for 5 of 7 people), so the
    full employer read after it started past the cut and read 0 sites."""
    from . import time_budget
    from .sources import aggregators
    started = time_budget.now()
    aggregators.TAKEN.clear()   # this press's own takings only
    scan, scorer, model, fits = scan or feeds.scan, scorer or score.run, model or score.DEFAULT_MODEL, fits or scored_fits
    imports = _Imports(import_jobs or (lambda slice_report: store.import_watch_report(db, slice_report)))   # the search passes SoFar.add: the full crawl then still counts these as new (#1015)
    chosen = pick(sources, size)
    say(f'First jobs: reading {len(chosen)} of {len(sources)} employer sites first')
    from .ai import batch_scope
    scoring = _Scoring(db, hidden, profile, scorer, model, first, fits, sync, MAX_FIRST)

    def hand(items):   # a batch of titles landed: its jobs in your places are imported and scored now
        if imports.add({'jobs': items}):
            say(f'First jobs: {imports.count} found')   # the app reads the list again on this line
        scoring.step()
    pool = ThreadPoolExecutor(max_workers=2)
    try:
        with title_queue.hub() as hub, batch_scope.concurrent():
            readers = _Readers(hub, _others(pool) if others is None else others, feed_db, imports, hand, say)
            if lane is not None:   # each group the boards' lane lands is kept and shown here, in the hub, while the slice waits for anything
                lane.notify = lambda: hub.post(lambda: lane.deliver(feed_db, lane_jobs or (lambda jobs: None)))
            scoring.before = readers.take_ready
            with batch_scope.reader('employer sites'):
                report = scan(chosen, feed_db, on_sorted=hand)
            imports.add(report)
            say(f'First jobs: {len(report.get("jobs") or [])} found')   # the app reads the list again on this line
            readers.settle(scoring)
            readers.finish()   # a reader that has read joins; EURES still reading is the free-API stage's
    finally:
        if lane is not None:
            lane.notify = None   # past the slice, the employer read and the gather's end deliver the lane's groups
        pool.shutdown(wait=False)   # Why (#2918, Gitar): a reader still reading is not waited for here; its own clock ends it
    if not scoring.queued:
        say(f'First jobs: {imports.count} found, none to score yet')   # the app closes the first-jobs card on this line: said once, after the readers joined
        return 0
    if claims.shared():   # the same line closes the card (desktop/renderer/find-card-model.js SLICE_END); "N found" re-reads the list (pages/jobs.js LIST_CHANGED)
        say(f'First jobs: {imports.count} found, none to score in this step: the scorer beside the search takes them, nearest first')
        return 0
    said = f', one fits {FIT}+' if scoring.strong else ''
    say(f'First jobs: {scoring.done} scored in {round(time_budget.now() - started)} s{said}; the full search goes on')
    return scoring.done


def _others(pool):
    """The readers started with the search that join the slice: EURES's early read (src/sources/eures.py start_early), when there is one, taken in
    `pool` the moment it has read and handed over at once; its locations are placed on the map meanwhile, never waited for. The hub sorts its titles with every other
    reader's, in the one queue (`_Readers.join`)."""
    from .paths import load_search_config
    from .sources import eures
    search = load_search_config()
    if eures.early(search) is None:
        return {}

    handed = Future()   # the jobs as read: the hub takes them from here, whatever the placing below is doing

    def read_eures():   # EURES reads the person's nearest area first
        from .ai import batch_scope
        with batch_scope.reader('EURES'), slots.priority(slots.FIRST):
            try:
                jobs = eures.read(search, keep=True)
            except BaseException as error:  # noqa: BLE001 — the hub's join sees it, as it saw a failed read before
                handed.set_exception(error)
                raise
            handed.set_result(jobs)
            # Why (#3339, 6 Nov 2026, night run 42152934954, p10 Amsterdam): the jobs were placed BEFORE they were handed over, and on a slow AI one placing call took 61 s, so 200
            # vacancies read at 52 s reached the hub at 115 s, past every title and score clock. Placing only orders by distance (geo keeps the answer): it never holds the jobs back.
            # Same worker thread, no new one: the press's stop is unchanged (`placed` asks nothing once time_budget.ended(); src/run_exit.py bounds the thread).
            with slots.priority(slots.NORMAL):   # not FIRST: the location calls must not queue ahead of the title batches the hub sorts meanwhile (slots order by level first)
                placed(jobs)
            return jobs
    reading = pool.submit(slots.carry(read_eures))
    reading.add_done_callback(lambda done: None if handed.done() else handed.set_exception(done.exception() or RuntimeError('EURES read ended without jobs')))   # a failure before the read: the hub sees it
    return {'EURES': handed}


def placed(jobs):
    """`jobs`, their locations placed on the map once (src/geo.py: a location seen before is not asked again), so the queue and time_budget.best_first can order
    them by distance to the best places. Not asked once the press's AI time is over; a failed or refused call leaves them unplaced: they keep the usual order."""
    from . import geo, time_budget
    if jobs and not time_budget.ended():
        try:
            geo.resolve([job.get('location') for job in jobs if job.get('location')], share=True)
        except Exception as error:  # noqa: BLE001 — unplaced: they keep today's order, nothing guessed
            print(f'Places: job locations not placed on the map ({type(error).__name__}); they keep the usual order', flush=True)
    return jobs


class _Imports:
    """The jobs imported so far, each once (a job handed early and then met again in its reader's whole result is not imported or counted twice)."""

    def __init__(self, add):
        self.add_to, self.keys = add, set()

    @property
    def count(self):
        return len(self.keys)

    def add(self, report):
        """Import the jobs of `report` not imported yet -> how many were."""
        fresh = [job for job in report.get('jobs') or [] if (job.get('url') or job.get('id')) not in self.keys]
        self.keys.update(job.get('url') or job.get('id') for job in fresh)
        if fresh:
            self.add_to({**report, 'jobs': fresh})
        return len(fresh)


class _Readers:
    """The slice's readers besides the employer sites, each a future of its jobs as read. When one has read, the hub (the thread that owns the store) sorts its
    titles in the one queue and imports what fits as each batch lands (`join`)."""

    def __init__(self, hub, futures, feed_db, imports, hand, say):
        self.hub, self.pending, self.feed_db, self.imports, self.say, self.shown = hub, dict(futures), feed_db, imports, say, {}
        self.hand, self.draining = hand, False
        for name, future in futures.items():   # the hub is woken, in whatever it waits for, to take a reader that has read
            future.add_done_callback(lambda _done, name=name: hub.post(lambda: self._joined(name)))

    def _joined(self, name):
        try:
            self.join(name)
        except Exception as error:  # noqa: BLE001 — a reader that fails here is the full search's, and the sort that runs this message must go on
            self.say(f'Warning: {name} not taken in the first jobs: {type(error).__name__}: {error}')

    def join(self, name):
        """Sort and import one reader's jobs, in the hub thread, as that reader saw its world (src/ai/batch_scope.py)."""
        from .ai import batch_scope
        future = self.pending.pop(name, None)
        if future is None:
            return
        shown = self.shown.setdefault(name, {})
        def handed(jobs):   # the jobs of a batch of this reader's titles the AI says fit
            from .sources import aggregators
            self.hand(aggregators.early_items(self.feed_db, name, jobs, shown))
        with batch_scope.seen_by(name), title_queue.handing_to(handed):
            jobs = self._take(name, future, shown)
        if self.imports.add({'jobs': jobs}):
            self.say(f'First jobs: {self.imports.count} found on the job boards')   # Why (#2928, Gitar; #2918): the app re-reads its job list on `First jobs: N found` (LIST_CHANGED, desktop/renderer/pages/jobs.js), another wording left these jobs hidden; N counts every job imported so far, said from the hub's join of a reader
        self.hand([])

    def take_ready(self):
        """Sort and import every reader that has read and is waiting for the hub, without waiting for one that is still reading."""
        if self.draining:   # a sort this runs may score and come back here: one level only, never one frame set per queued landing
            return
        self.draining = True
        try:
            while self.hub.run_next(0):
                pass
        finally:
            self.draining = False

    def settle(self, scoring):
        """Score what is read, the nearest first; with nothing left to score and a reader still reading, wait for the next one (never past the press's end)."""
        from .sources import read_budget
        while True:
            while scoring.step():
                pass
            if scoring.over() or not self.pending:
                return
            left = read_budget.seconds_left(read_budget.cut_at())   # Why (#2918, Gitar): never past the read cut; the full crawl and a reader still reading go on from there
            if not self.hub.run_next(left):
                return

    def finish(self):
        """Every reader that has read joins; one still reading is left to the free-API stage, which takes the same early read (eures.read keep): the full
        crawl never waits for it (#2918, Gitar)."""
        for name in list(self.pending):
            future = self.pending.get(name)
            # Why (night 9 Nov 2026, p1, run 42537909472): joining one reader runs a score step whose look at the hub (_Scoring.before, #3339) may join the next one first; it is gone from `pending` then (read as a KeyError, it stopped the slice before its closing line). A reader still reading is left to the free-API stage: the boards' wait went with their lane (#3826)
            if future is None or not future.done():
                continue
            try:
                future.result()
            except Exception:  # noqa: BLE001 — joined below as a failed read
                pass
            self.join(name)

    def _take(self, name, future, shown):
        """One reader's jobs (report shape), through the free-API stage's own taking (aggregators.scan)."""
        from .paths import load_search_config
        from .sources import aggregators
        try:   # its read was done in its own thread (_others) and handed over before its places are placed (they order later batches once geo has them): this sorts, takes and matches them
            return aggregators.scan(self.feed_db, load_search_config(), readers=[(name, lambda search: future.result())], early=True, shown=shown)['jobs']
        except Exception as error:  # noqa: BLE001 — the free-API stage reads it
            self.say(f'Warning: {name} not taken in the first jobs: {type(error).__name__}: {error}')
            return []


class _Scoring:
    """The slice's scores: the nearest jobs read so far, `first` at a time, a sync after each, until one fits FIT+ or `limit` are scored."""

    def __init__(self, db, hidden, profile, scorer, model, first, fits, sync, limit):
        self.args, self.first, self.fits, self.sync, self.limit = (db, hidden, profile, scorer, model), first, fits, sync, limit
        self.done, self.tried, self.queued, self.strong, self.stopped = 0, set(), set(), False, False
        self.before = lambda: None   # called before each batch is chosen: the readers that have read are sorted first (_Readers.take_ready)

    def over(self):
        """With a scorer beside the search (src/press/scorer.py shared()) the slice ends once its first `first` nearest jobs are in the list: it scores none of them, that
        scorer does (sf 2/8; before, ts 10 Nov 2026, it scored those `first` itself in the hub thread). Without a scorer beside it (no time budget) the slice scores 3 at a
        time up to `limit` until a job fits FIT+, as before."""
        if claims.shared():
            return self.stopped or len(self.tried) >= self.first
        return self.strong or self.stopped or len(self.tried) >= self.limit

    def step(self):
        """Score the next batch of the nearest jobs not scored yet (time_budget.best_first), whatever they are so far -> True when a batch was scored. With a scorer
        beside the search it only notes them as the slice's first jobs (over) and scores nothing."""
        from . import time_budget
        db, hidden, profile, scorer, model = self.args
        self.before()   # Why (#3339, night p1 Sofia): EURES was read at 73 s and sat in the hub's box while 3 scores took 31 s (81-112 s), then its titles met the clock. One owner of the order:
        # a reader that has read is sorted before a score starts, so its jobs compete for this batch by distance (best_first below), never behind it. First: the sort may end the slice.
        if self.over():
            return False
        order = [job['id'] for job in time_budget.best_first(score.queue(db, to_score(db, hidden), profile, scope='new')) if str(job['id']) not in self.tried]
        if not order:
            return False
        ids = order[:min(self.first, self.limit - len(self.tried))]
        self.queued.update(map(str, order[:self.limit - len(self.tried)]))
        self.tried.update(map(str, ids))
        if claims.shared():
            # Design (sf 2/8, owner 10 Nov 2026, asked via AskUserQuestion: "From the ranked list (Recommended)", "At each new arrival (Recommended)"): this thread
            # collects, the scorer beside the search scores. Scoring here held every import behind the AI: night run 42731674115 p9 (Lyon) scored 3 here 92-134 s
            # while the batch with Rhône's 21 jobs, landed at 94 s, waited; the scorer beside took its 4 from the 15 jobs it could see. The slice ends once its
            # first jobs are in the list, so the full crawl starts no later than before.
            return False
        stats = {}
        scorer(db, to_score(db, hidden), profile, model, self.first, workers=self.first, stats=stats, on_scored=self.sync, every=1, only_ids=set(ids))
        if not stats.get('done'):   # a paused Profile, a spent limit or the time: the next batch would score nothing either
            self.stopped = True
            return False
        self.done += stats['done']
        self.strong = any(fit >= FIT for job_id, fit in self.fits(db).items() if str(job_id) in {str(i) for i in ids})
        return True
