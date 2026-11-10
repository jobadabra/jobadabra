# Search scoring phases: shared timed batches, enrichment and incremental match writes.
import threading

from .ai import enrich, score, slots
from .press import scorer, step_yield
from .daily_helpers import for_job_matches, left_out, no_profile, none_scored, time_budget_on, to_score


# Score jobs beside the search: the ones that already wait, then every job the search lands, until the run's end.
BATCH = 4   # jobs a round takes at once: Claude Code's slots (src/ai/providers/claude_code.py PARALLEL); the next round is picked after it, from what has landed since
POLL = 2.0  # seconds the scorer waits when no job has landed (the search lands jobs source by source, src/jobs_so_far.py)


def score_beside(args, stores, db, run, read_profile, hidden, dismissed, time_budget):
    """Design (ts, 10 Nov 2026; owner asked via AskUserQuestion, "Yes, build it (Recommended)"): a job is Listed (a reader), Placed (place_triage), Kept (title
    sorting) and Scored, and the one scorer owns the last step. It starts with the search, on every press the first included, and takes each job as it lands (Kept and
    imported by src/jobs_so_far.py), best places first, until the run's end minus TAIL: the night of 9 Nov scored a median of 3 jobs on press 1 because new jobs were
    scored only by the pass at the end of search(), which met "No time left" at 105-163 s of 135. What `score_jobs` does after the import is the closer for what is left.
    Design (3 Nov 2026, owner, #3058, quoted in full in the PR): Find jobs grows the person's list of scored jobs. A job found and never scored is
    the cheapest growth (one score, no search), so a pressed or scheduled refresh scores ALL of those it has time for, best places and closest jobs
    first, and searches for new jobs with the time left. Those waiting jobs are ranked in one list with this run's (sf 2/8, owner 10 Nov 2026: "One list together
    (Recommended)"; until then they were a first batch of their own) and their calls wait at AI level LATER (ps E2a-1, owner, 8 Nov 2026: "Both: no waits + background
    (Recommended)"): scoring them first held the employer naming back and 0 of 561 sites were read; this run's own jobs go at SCORE. Never a job that already has a score: a changed text, a Profile edit, newly read facts or a score the person asked to redo are the Re-score
    action's (daily_modes.rescore_mode), not Find jobs' (scope='new'), and not the jobs the cleanup after the crawl closes as outside your places (feeds.keep_open, a cache
    read). Each job is claimed once (src/press/scorer.py); one ceiling for both kinds: score_max (60 in the app) plus the waiting jobs the clock allowed at the start (`taken`).
    Returns the call that ends it: it stops the scorer after the round in flight and waits for it, to the run's end at most; the search calls it before it imports what it found, so nothing reads
    run['score'] half-written (a no-op when the scorer did not start)."""
    if args.mode not in ('scheduled', 'run') or not (time_budget_on() and args.score_max and read_profile):
        return _nothing
    try:
        profile = read_profile()
        stay = _stay(db, to_score(db, hidden))
        earlier = frozenset(job['id'] for job in stay)   # waiting before this run began: their calls queue at LATER
        waiting = score.queue(db, stay, profile, scope='new')
        taken = time_budget.batch('score', len(waiting)) if waiting else 0
    except Exception as error:  # noqa: BLE001 — the search goes on and scores them after it, as before
        print(f'Warning: waiting jobs not scored first ({type(error).__name__}): they are scored after the search')
        return _nothing
    run['waiting'] = len(waiting) - taken
    scorer.begin()   # from here the slice of a first press scores nothing itself: this scorer takes every job (src/first_jobs.py _Scoring)
    total, stop, lock, closed = {}, threading.Event(), threading.Lock(), [False]

    def score_batch(own_db, own_stores, ids, level):
        """One round, -> False when it scored nothing (a paused Profile, the AI down, a spent limit): the next would score nothing either, and the claims are not given back.
        Why a round-local dict (Gitar on #3649): the thread never touches the run's dict while the search may own it; a round that ends after the search took the counts
        (`closed`, the join gave up at the run's end) is dropped from the card, its scores are saved all the same."""
        own_run = {'warnings': [], 'waiting': 0}
        with step_yield.span('scoring'), slots.priority(level):
            score_candidates(args, own_stores, own_db, own_run, read_profile, hidden, dismissed, set(ids), __import__('time').monotonic(), time_budget, final=False)
            stats = own_run.get('score') or {}
            with lock:
                if not closed[0]:
                    add_stats(total, stats)
                    run['warnings'] += own_run['warnings']
            if not closed[0]:
                sync_partial(args, own_stores, own_db, hidden, dismissed)   # score.run syncs every 10 scored in one call, and a round has 4: the app's list has these now (code review, ts)
            return bool(stats.get('done'))

    def work(own_db, own_stores):
        # Design (sf 2/8, owner 10 Nov 2026, asked via AskUserQuestion: "One list together (Recommended)", "At each new arrival (Recommended)"): the jobs that waited
        # and the ones this run finds are one list, ranked by one key (your places, distance, closeness) at every pick, so a near new job is never scored after a far
        # old one. The `taken` waiting jobs the clock allowed at the start are owed to this run (L13): once the search stops or the clock ends, the scorer goes on with
        # waiting jobs only until they are paid; they no longer take a first round of their own.
        owed = [taken]

        def pick(only_waiting):
            ids, level = next_batch(own_db, profile, hidden, earlier, BATCH, args.score_max + taken, only_waiting)
            owed[0] -= sum(1 for job_id in ids if job_id in earlier)
            return ids, level
        drain(stop, pick, lambda ids, level: score_batch(own_db, own_stores, ids, level), time_budget.ended, owing=lambda: owed[0] > 0)

    def wait():
        """Seconds the search may wait for the round in flight: to the run's end (a call started before it ends by it, TAIL), None without a budget."""
        end = time_budget.end()
        return None if end is None else max(0.0, end - time_budget.now())

    def counts():
        with lock:
            closed[0] = True
            run['score'] = dict(total)   # whole, whether the thread ended or is still in its last round (the closing pass adds to it)
    return _beside(args.db, stores, work, stop, wait, counts)


def _nothing():
    """The wait for a scorer that did not start."""


def _stay(db, jobs):
    """The jobs the cleanup after the crawl will not close as outside your places (a cache read)."""
    from .sources import feeds
    return [job for job in jobs if feeds.keep_open({**job, 'remote': 'remote' in (job.get('work_mode') or '').lower()})]


def next_batch(db, profile, hidden, earlier, size, ceiling, only_waiting=False):
    """-> (ids, level): up to `size` jobs the scorer has not claimed, from the head of the one ranked list (score.queue: your places, distance, closeness), claimed now
    (at most `ceiling` in the run); `only_waiting`: the ones that waited before the run began (`earlier`: their ids) only. A batch is of the head's kind: this run's jobs
    at SCORE, or the waiting ones at LATER, so their calls never queue ahead of the employer naming (L35); a batch is never both. It is filled with that kind from
    the next 2 × size of the list (code review of sf 2/8: a list that alternates kinds made rounds of one job, a quarter of the AI's slots); a job of the other kind
    in that window is at the head of the next pick."""
    queue = score.queue(db, _stay(db, to_score(db, hidden)), profile, scope='new')
    free = [job_id for job_id in scorer.unclaimed([job['id'] for job in queue]) if not only_waiting or job_id in earlier]
    if not free:
        return [], slots.SCORE
    old = free[0] in earlier
    head = [job_id for job_id in free[:2 * size] if (job_id in earlier) == old]
    taken, level = scorer.claim(head, ceiling, size), slots.LATER if old else slots.SCORE
    if taken:
        step_yield.scored('scoring', set(taken))
    return taken, level


def drain(stop, next_batch, score_batch, ended, pause=None, owing=lambda: False):
    """Score batch after batch (`next_batch(only_waiting)`) until `stop` is set or the run's time is over (`ended()`); with no job landed, wait `POLL` seconds (or call
    `pause`) and look again. While `owing()`, waiting jobs the run owes (L13) are picked past both, waiting ones only, until none is left (until sf 2/8 they were a
    round of their own, started before this loop)."""
    while True:
        over = stop.is_set() or ended()
        if over and not owing():
            return
        ids, level = next_batch(over)
        if over and not ids:
            return
        if ids:
            if score_batch(ids, level) is False:   # a round that scored nothing: the next would not either
                return
        elif pause is not None:
            pause()
        else:
            stop.wait(POLL)


def _beside(path, stores, work, stop, wait=lambda: None, counts=lambda: None):
    """work(db, stores) in a thread of its own; returns the call that stops it after the round in flight, waits for it up to `wait()` seconds (None: as long as it takes: the
    run's end when it has a budget, so a round slow behind the AI slots never holds the search past its 3 minutes, code review of ts) and then says the counts (`counts()`). A SQLite connection belongs to the thread that opened
    it, so the thread opens its own to the jobs file and to this Mac's Job Matches (src/stores/beside.py), never the search's.
    Why (ps E2a-1, 8 Nov 2026): the waiting jobs' calls queue after the search's (slots.LATER, as the board web search): the employer naming's rounds
    must not wait behind five scoring calls (Codex has 2 slots), the very wait that left p10, p12 and p17 0 employer sites read; this run's jobs go at SCORE (ts).
    Why no batch_scope reader (ps E2a-1): its batch is picked before it starts and it decides no place or title; a scope opened here would hold
    until the join and freeze the employer read's world before plan_sources names the employers (boards_ahead's own scope would nest in it)."""
    from . import store
    from .stores import beside
    here = beside.opener(stores)

    def run():
        try:
            own_db = store.connect(path)
            own_db.execute('PRAGMA busy_timeout = 10000')   # Why (ps E2a-1 review): two writers in one process now; the tracker's own connect waits 10 s too
            try:
                with own_db, here() as own_stores:   # `with own_db` commits what is left, as the search's own does
                    work(own_db, own_stores)
            finally:
                own_db.close()
        except Exception as error:  # noqa: BLE001 — the search's own pass scores them after it, as before
            print(f'Warning: jobs not scored beside the search ({type(error).__name__}): they are scored after it', flush=True)
        finally:
            scorer.end()   # a scorer that died leaves nothing for the slice to defer to
    thread = threading.Thread(target=run, name='scorer', daemon=True)
    thread.start()

    def finish():
        stop.set()
        thread.join(wait())
        scorer.end()   # not left on for the next search of this process (a test, the app's long process)
        counts()
    return finish


# Read and score jobs in their existing batch order on the run clock.
def score_jobs(args, stores, db, run, read_profile, hidden, dismissed, time_budget):
    # A refresh with a time budget takes one batch end to end (owner, 7 Oct 2026: "a batch should handle it from start to finish"): the new
    # jobs it can read and score in its time, best places first; the rest waits for the next refresh and is not listed until scored.
    batch, batch_started = None, None
    if time_budget_on() and args.score_max and read_profile:
        try:
            waiting = score.queue(db, to_score(db, hidden), read_profile(), scope='new')
            taken = time_budget.batch('score', len(waiting))
            batch, batch_started = {job['id'] for job in waiting[:taken]}, __import__('time').monotonic()
            run['waiting'] = len(waiting) - taken
        except Exception as error:  # noqa: BLE001 — each step then takes its own batch
            print(f'Warning: no batch for this refresh ({type(error).__name__}): each AI step takes its own')
    # A refresh with a batch scores first, straight from each posting (owner, 7 Oct 2026: reading each job with AI took the whole 3 minutes,
    # twice, and scored nothing); the AI reading (facts such as languages) gets the time left after. Without a batch: reading, then scoring.
    if args.enrich_max and batch is None:
        read_jobs(args, db, run)
    if args.score_max and read_profile:
        score_candidates(args, stores, db, run, read_profile, hidden, dismissed, batch, batch_started, time_budget)
    if args.enrich_max and batch is not None:
        read_jobs(args, db, run)   # with the time left: the budget sizes it, best places first
    for warning in no_profile(args.score_max, None, read_profile):
        print(f'Warning: {warning}')
        run['warnings'].append(warning)


# Enrich imported descriptions without blocking the digest on AI trouble.
def read_jobs(args, db, run, only_ids=None):
    # Runs after import so fresh descriptions are included. AI trouble never blocks the digest.
    try:
        run['enrich'] = {}
        print(enrich.run(db, enrich.DEFAULT_MODEL, args.enrich_max, stats=run['enrich'], only_ids=only_ids))
        run['warnings'] += left_out(run['enrich'], 'read by AI')
    except Exception as error:
        print(f'Warning: enrichment skipped: {type(error).__name__}: {error}')
        run['warnings'].append(f'enrichment skipped: {type(error).__name__}')


# Score candidates and preserve the scoring warning boundary.
def score_candidates(args, stores, db, run, read_profile, hidden, dismissed, batch, batch_started, time_budget, final=True):
    earlier = run.pop('score', None) or {}   # the scorer beside the search (score_beside) counts in this run's totals, once, whatever happens below
    # Scores only jobs that survive the hard filters; the Profile is re-read every run
    # (the desktop app's local Profile file when set, else the Notion page).
    try:
        profile = read_profile()
        candidates = to_score(db, hidden)
        run['score'] = {}

        # Write scored matches now, keeping the same callback and exception boundary.
        def to_notion():
            sync_partial(args, stores, db, hidden, dismissed)
        print(score.run(db, candidates, profile, score.DEFAULT_MODEL, args.score_max, stats=run['score'], on_scored=to_notion, only_ids=batch, scope='new'))
        if not final:   # the waiting jobs' pass: one batch, its numbers kept for the search's last pass, which says the warnings once from both
            return
        if batch is not None:
            score_batches(args, db, run, hidden, profile, batch_started, to_notion, time_budget)
        run['warnings'] += left_out(run['score'], 'scored')   # this pass's own numbers: the jobs the waiting pass failed are in this pass's batch again
        if earlier:   # the card keeps the newest "Scored N of M" line: one count for the whole run, both passes summed (#3058, owner via coordinator)
            retried = earlier.get('failed') or 0   # the waiting pass's failed jobs are still unscored: this pass's batch has them again, counted there (Gitar, #3074)
            add_stats(run['score'], {**earlier, 'pending': max(0, (earlier.get('pending') or 0) - retried), 'failed': 0})
            earlier = {}
            print(f"Scored {run['score'].get('done') or 0} of {run['score'].get('pending') or 0} job(s)", flush=True)
        for warning in none_scored(run.get('waiting'), run['score']):
            print(f'Warning: {warning}', flush=True)
            run['warnings'].append(warning)
        if run['score'].get('paused'):   # said on the run's card, not only in its log
            run['warnings'].append(score.PAUSED)
    except Exception as error:
        print(f'Warning: scoring skipped: {type(error).__name__}: {error}')
        run['warnings'].append(f'scoring skipped: {type(error).__name__}')
        add_stats(run.setdefault('score', {}), earlier)   # the waiting jobs' pass still counts


# Publish the scores so far without blocking scoring when the store fails.
def sync_partial(args, stores, db, hidden, dismissed):
    # Owner, 7 Oct 2026: Job Matches was written only after the whole search, so a stopped one left nothing there. The scores
    # so far are written now and then; the end of the search still writes the rest and marks what is gone or applied.
    if args.mode not in ('scheduled', 'run', 'today', 'rescore'):
        return
    try:
        print(stores.matches.sync(db, for_job_matches(db, hidden), hidden - dismissed, None, dismissed, partial=True) + ' (so far)', flush=True)
    except Exception as error:  # noqa: BLE001 — the end of the search writes them
        print(f'Job Matches: not updated yet ({type(error).__name__}); the end of the search writes them', flush=True)


# Score subsequent batches using the same time-budget owner.
def score_batches(args, db, run, hidden, profile, batch_started, to_notion, time_budget, final=True):
    now = __import__('time').monotonic
    time_budget.record('job', now() - batch_started, run['score'].get('done') or 0, run['score'].get('lost') or 0)
    # Done with time left: the next batch, sized from the pace just measured, read and scored the same way (the first is a guess).
    while run.get('waiting') and not time_budget.over('score'):
        queue = score.queue(db, to_score(db, hidden), profile, scope='new')
        taken = time_budget.batch('score', len(queue), say=False)
        if not taken:
            break
        batch, batch_started, run['waiting'] = {job['id'] for job in queue[:taken]}, now(), len(queue) - taken
        more = {}
        print(score.run(db, to_score(db, hidden), profile, score.DEFAULT_MODEL, args.score_max, stats=more,
                        on_scored=to_notion, only_ids=batch, scope='new'))
        time_budget.record('job', now() - batch_started, more.get('done') or 0, more.get('lost') or 0)
        if not more.get('done'):
            break
    if run.get('waiting') and final:   # the waiting jobs' pass leaves it to the search's last pass, which counts what is still left
        print(f'⏱ {run["waiting"]} found job(s) wait for the next refresh, to be scored (best places and closest jobs first)', flush=True)


# Add one scoring pass's numbers to another's (the run's totals: done, failed, cost, tokens).
def add_stats(total, other):
    for key, value in other.items():
        if key == 'lost':   # a share of one pass's call time, not a count
            continue
        if isinstance(value, (int, float)) and not isinstance(value, bool) and isinstance(total.get(key, 0), (int, float)):
            total[key] = total.get(key, 0) + value
        else:
            total.setdefault(key, value)
