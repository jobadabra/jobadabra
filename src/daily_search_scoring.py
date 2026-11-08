# Search scoring phases: shared timed batches, enrichment and incremental match writes.
from .ai import enrich, score
from .press import step_yield
from .daily_helpers import for_job_matches, left_out, no_profile, none_scored, time_budget_on, to_score


# Score the jobs that already wait for a score, beside the search for new ones.
def score_waiting_first(args, stores, db, run, read_profile, hidden, dismissed, time_budget):
    """Design (3 Nov 2026, owner, #3058, quoted in full in the PR): Find jobs grows the person's list of scored jobs. A job found and never scored is
    the cheapest growth (one score, no search), so a pressed or scheduled refresh scores ALL of those it has time for, best places and closest jobs
    first, and searches for new jobs with the time left (score_jobs scores those after). With nothing waiting it does nothing and the order is today's.
    Never a job that already has a score: a changed text, a Profile edit, newly read facts or a score the person asked to redo are the Re-score action's
    (daily_modes.rescore_mode), not Find jobs' (scope='new'). One deadline for both: the run's 3 minutes (time_budget).
    Not on a first press (its slice scores the first jobs with the floor), and not the jobs the cleanup after the crawl closes as outside your
    places (feeds.keep_open, a cache read): after a change of places most of the waiting jobs would be those.
    Beside the search (ps E2a-1, owner, 8 Nov 2026: "Both: no waits + background (Recommended)"): the batch is picked here, in the run's thread, and
    scored in a thread of its own while the search names and reads the employer sites. Returns the call that waits for it (a no-op when nothing
    waits); the search calls it before it imports what it found, so nothing reads run['score'] half-written."""
    if args.mode not in ('scheduled', 'run') or args.first_jobs or not (time_budget_on() and args.score_max and read_profile):
        return _nothing
    try:
        from .sources import feeds
        stay = [job for job in to_score(db, hidden) if feeds.keep_open({**job, 'remote': 'remote' in (job.get('work_mode') or '').lower()})]
        waiting = score.queue(db, stay, read_profile(), scope='new')
        if not waiting:
            return _nothing
        taken = time_budget.batch('score', len(waiting))
    except Exception as error:  # noqa: BLE001 — the search goes on and scores them after it, as before
        print(f'Warning: waiting jobs not scored first ({type(error).__name__}): they are scored after the search')
        return _nothing
    run['waiting'] = len(waiting) - taken
    if not taken:
        return _nothing
    batch, began = {job['id'] for job in waiting[:taken]}, __import__('time').monotonic()
    step_yield.scored('scoring', batch)   # report only (src/press/step_yield.py): what the step took in hand and how long it ran

    def work(own_db, own_stores):
        with step_yield.span('scoring'):
            score_candidates(args, own_stores, own_db, run, read_profile, hidden, dismissed, batch, began, time_budget, final=False)
    return _beside(args.db, stores, work)


def _nothing():
    """The wait for a waiting pass that did not start."""


def _beside(path, stores, work):
    """work(db, stores) in a thread of its own; returns the call that waits for it. A SQLite connection belongs to the thread that opened it, so
    the thread opens its own to the jobs file and to this Mac's Job Matches (src/stores/beside.py), never the search's.
    Why (ps E2a-1, 8 Nov 2026): its AI calls queue after the search's (slots.LATER, as the board web search): the employer naming's rounds must
    not wait behind five scoring calls (Codex has 2 slots), the very wait that left p10, p12 and p17 0 employer sites read.
    Why no batch_scope reader (ps E2a-1): its batch is picked before it starts and it decides no place or title; a scope opened here would hold
    until the join and freeze the employer read's world before plan_sources names the employers (boards_ahead's own scope would nest in it)."""
    import threading
    from . import store
    from .ai import slots
    from .stores import beside
    here = beside.opener(stores)

    def run():
        try:
            own_db = store.connect(path)
            own_db.execute('PRAGMA busy_timeout = 10000')   # Why (ps E2a-1 review): two writers in one process now; the tracker's own connect waits 10 s too
            try:
                with slots.priority(slots.LATER), own_db, here() as own_stores:   # `with own_db` commits what is left, as the search's own does
                    work(own_db, own_stores)
            finally:
                own_db.close()
        except Exception as error:  # noqa: BLE001 — the search's own pass scores them after it, as before
            print(f'Warning: waiting jobs not scored beside the search ({type(error).__name__}): they are scored after it', flush=True)
    thread = threading.Thread(target=run, name='waiting scores', daemon=True)
    thread.start()
    return thread.join


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
    earlier = run.pop('score', None) or {}   # the waiting jobs' pass (score_waiting_first) counts in this run's totals, once, whatever happens below
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
