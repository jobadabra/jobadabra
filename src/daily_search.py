"""The jobs check's search itself (modes scheduled, run, today, more): crawl the feeds, import, enrich, score, sync Job Matches and the
ledger, build the digest, send it to Telegram, save and log the run. `search(args, stores)` returns the exit code. The data is the
active store's (src/stores: open once, passed down), on every store; this Mac's store never gets a copy in Notion.
Tests: tests/unit/engine/test_daily.py, tests/unit/ai/test_refresh_batch.py, tests/unit/ai/test_search_budget.py, tests/unit/sources/test_places_strict.py, tests/unit/ai/test_place_triage.py,
tests/unit/sources/test_contribute.py, tests/unit/sources/test_watch.py, tests/unit/ai/test_score.py, tests/unit/sources/test_source_yield.py.
"""
import contextlib
import json
import random
from collections import Counter
from datetime import datetime, timezone
from . import read_methods, contribute, coverage, digest, first_jobs, employer_index, jobs_so_far, run_counts, scout, source_yield, store
from . import doctor, ledger_store, notify, telegram  # noqa: F401 -- patched by tests/unit/ai/test_daily_search_phases.py
from .ai import budget, kit
from .ai import enrich, insights, interviews  # noqa: F401 -- patched by tests/unit/ai/test_daily_search_phases.py
from .notion import client as notion_client
from .notion import funnel  # noqa: F401 -- patched by tests/unit/sources/test_daily_store.py
from .paths import DATA, REPORTS, load_search_config
from .ai import engine as _engine
from .store_access import open_run
from .sources import describe, feeds, google_jobs
from .daily_helpers import (STALE_DAYS, crawl_counts, downloaded_index, for_job_matches, log_crawl, new_cron_run,
                            new_job_lines, save_run, scoring_plan, starter_sources, top_new, url_stages)

from . import time_budget
from .press import plan, resume, scorer, stage, step_yield
from .daily_search_scoring import score_jobs, score_beside
from .daily_search_reporting import finish_search, scheduled_updates


# Return whether an AI is ready for this search.
def ai_ready():
    """An AI is ready: unscored jobs wait for a score and the digest leaves them out, as the app's Jobs list does."""
    return _engine.ready()


# Run each search phase in order; the existing time_budget module owns the one deadline.
def search(args, stores=None):
    stores = stores or open_run()
    run_counts.reset()   # this search's own counts start at 0
    step_yield.reset()   # and its steps' yield (src/press/step_yield.py)
    scorer.reset()   # and nothing claimed for a score yet (src/press/scorer.py)
    read_methods.reset(datetime.now(timezone.utc).isoformat(timespec='seconds'))   # and how its sources are read (src/read_methods.py)
    run = new_cron_run(args.mode)
    started = datetime.now(timezone.utc).isoformat(timespec='seconds')   # a job first seen from now on is new (src/source_yield.py)
    spend = check_budget(args, stores, run)
    read_profile = scoring_plan(args, stores)   # read once, before any site: the time plan knows the search scores (time_budget.score_first)
    start_sources(args, read_profile)
    hidden, saved, dismissed, stages = application_stages(stores, run)
    sources = starter_sources()
    report, imported, lane, apis, so_far = {'jobs': [], 'sources': []}, [], None, None, None   # lane: the job boards', apis: the free job APIs' lane (gather_sources), handed over after it
    with store.connect(args.db) as db:
        # A '➕ Next' page reads the stored list as is: importing would mark new jobs
        # as seen and reorder the list between pages.
        if args.mode != 'more':
            try:   # the whole plan of the steps, said at each press start (src/press/plan.py; log only, the engine's order is unchanged)
                plan.run(db)
            except Exception as error:  # noqa: BLE001
                print(f'Warning: Find jobs plan not made: {type(error).__name__}: {error}')
            scored = score_beside(args, stores, db, run, read_profile, hidden, dismissed, time_budget)   # the one scorer, beside the search: the jobs found earlier, then each job as it lands (#3058, ps E2a-1, ts)
            try:
                feed_list = plan_sources(args, stores, db, sources, run)
                start_proposal(args, read_profile)   # the employers are named: the boards' AI calls start now, beside the reading
                report, so_far, lane, apis = gather_sources(args, stores, db, feed_list, read_profile, hidden, dismissed, run)
            except Exception:   # an error waits for the round in flight; a Stop (SystemExit) ends at once, the daemon thread with it
                scored()
                leave_early_reads(args)
                raise
            # Why (#3798, p14's repeat run, 11 Nov 2026): the import first; scored() keeps scoring the jobs the run owes (L13) past its stop, so
            # importing after it held every job the search found, late employer reads included, behind that scoring and past the app's stop.
            imported = import_sources(db, report, so_far, run)
            scored()   # before the closing pass: run['score'] is whole when score_jobs reads it
            keep_late_boards(lane, so_far)   # the boards' groups that landed while the run scored (lanes 4a)
            keep_late_apis(apis, so_far)   # the free APIs' reads that ended after the read cut (WP8 4/5)
            contribute_sources(args, stores, db, feed_list, report, stages)
            close_sources(args, db, feed_list, run)
        imported = filter_jobs(args, db, imported)
        backfill_descriptions(db)
        score_jobs(args, stores, db, run, read_profile, hidden, dismissed, time_budget)
        keep_late_apis(apis, so_far, wait=True)
        keep_late_boards(lane, so_far, wait=True)   # the last of the boards' groups before the run's matches are saved (lanes 4a), waited for to the run's end
        open_urls = save_matches(args, stores, db, run, report, hidden, dismissed, started)
        scheduled_updates(args, stores, run, open_urls, datetime)
        seed = args.seed or random.randrange(1, 10**9)
        shown_ids = []
        messages, new_count, keyboards = digest.build_digest(db, args.limit, hidden_urls=hidden, page=args.page,
                                                      seed=seed, shown_ids=shown_ids, saved_urls=saved,
                                                      hide_unscored=ai_ready())
    leave_early_reads(args)
    resume.save()   # what each step left for the next run, as counts for the planner (src/press/resume.py); the items stay in their own files
    try:   # the plan after this run, which its card says as "Next: ..." (src/press/plan.py next_steps): AFTER resume.save, which zeroes the steps that finished (review, #P3); log only
        if args.mode != 'more':   # a '➕ Next' page plans nothing at its start either
            with store.connect(args.db) as db:
                plan.run(db, head='Next plan')
    except Exception as error:  # noqa: BLE001
        print(f'Warning: the next Find jobs plan was not made: {type(error).__name__}: {error}')
    return finish_search(args, stores, run, spend, report, imported, messages, new_count, keyboards, shown_ids, seed,
                         REPORTS, datetime, save_run, log_crawl)


# Apply the monthly AI budget before planning sources.
def check_budget(args, stores, run):
    spend = None
    if args.mode in ('scheduled', 'run', 'today'):
        # AI budget: at 90% of the month's limit the optional AI steps pause; alerts are sent at the end.
        try:
            spend = budget.status(stores)
            # The monthly budget is API spend: with Claude Code the AI runs on the user's Claude plan, so "$0.00 of $15" says nothing (6 Oct 2026).
            from .ai import engine as ai_engine
            chosen = ai_engine.providers.spec()
            print(f'AI: {chosen.plan} (no API budget to watch)' if chosen.billing == ai_engine.SUBSCRIPTION else f'AI budget: {budget.describe(spend)}')
            budget.apply_caps(args, spend, run['warnings'])
        except Exception as error:
            print(f'Warning: budget check skipped: {type(error).__name__}: {error}')
    return spend


# Start the existing early board and free-API reads in order.
def start_sources(args, read_profile):
    if args.mode in ('scheduled', 'run') and not args.only_visits:   # the board web search at second 0 (src/sources/board_web.py early)
        from .sources import board_web   # Why (#first-press-slots, owner, 27 Oct 2026: "Web search ... in parallel"): it started at ~25 s, after the employers' pick
        board_web.early(load_search_config())
        from .features import enabled
        if not enabled('eures'):   # Why (10 Nov 2026, owner: "as good as EURES, without using EURES"): the press says which mode it ran, so a night's log and verdict (tools/persona-search/funnel.py) never read "0 EURES jobs" as a fault
            print('EURES: off in this run (an installed beta or stable app turns it on)', flush=True)
        from .sources import eures   # Why (27 Oct 2026, benchmark 40504636029): the free-API stage starts at 72-107 s and queued EURES in every persona; read from second 0, it only takes the result
        eures.start_early(load_search_config())


# The run is over: what started at second 0 and no stage took is handed on, so its answer is kept for the next run (not asked again).
def leave_early_reads(args):
    """Why (E2b, 8 Nov 2026, product bug on persona 18's chain: run 2 waited ~116 s, ~70% of the run, for a web search run 1 had paid for): the web search
    started at second 0 (start_sources) is taken by the job boards' stage, which is skipped at the read cut by more than one path (found_boards.read,
    aggregators past_cut) or never reached after an error; the run's end is the one place that sees all of them (board_web.leave). EURES needs no hand-over:
    its stage always takes it (aggregators.CHEAP_PAST_CUT); the early board proposal's AI answers are cached."""
    if args.mode in ('scheduled', 'run') and not args.only_visits:
        try:   # never replaces the run's own error or ends a finished run
            from .sources import board_web
            board_web.leave(load_search_config())
        except Exception as error:  # noqa: BLE001
            print(f'Warning: the open web search was not handed on: {type(error).__name__}: {error}', flush=True)


# Ask the first press's board proposal once the pool has named the employers (see first_jobs.propose_early for the why).
def start_proposal(args, read_profile):
    if args.mode != 'more' and args.first_jobs and args.score_max and not args.only_visits and read_profile:
        try:   # Why (#sp-employers-first, 2 Nov 2026, #2913): at second 0 its 73 s of serial calls held the shared AI while the employer pick's calls waited 15-25 s each (zero run 41346903877: employers named at 122 s, 0 of 15 read)
            first_jobs.propose_early()
        except Exception as error:  # noqa: BLE001 — the slice asks the proposal itself
            print(f'Warning: early board proposal skipped: {type(error).__name__}: {error}', flush=True)


# Read the hidden, saved and dismissed URLs from the active store.
def application_stages(stores, run):
    hidden, saved, dismissed = frozenset(), frozenset(), frozenset()
    stages = None   # job URL -> Stage: also what the pool's outcome counts read (src/contribute.py outcomes)
    try:
        stages = url_stages(stores)
        hidden = frozenset(u for u, st in stages.items() if st not in notion_client.VISIBLE_STAGES)
        saved = frozenset(u for u, st in stages.items() if st == 'Saved')
        dismissed = frozenset(u for u, st in stages.items() if st == 'Dismissed')
    except Exception as error:  # A Notion outage shouldn't block the digest.
        print(f'Warning: could not read your applications: {error}')
        run['warnings'].append(f'{"Notion applications" if stores.name == "notion" else "Applications"} unreadable: {error}')
    return hidden, saved, dismissed, stages


# Plan the active feed list and record employer-index warnings.
def plan_sources(args, stores, db, sources, run):
    # The feed watcher and canonical store intentionally have different schemas.
    # Keep the source-specific history separate, then import the report.
    # sources.json plus every active feed the scout found (local table + Notion Source Registry).
    feed_list = scout.active_sources(db, stores, sources, [] if args.only_visits else downloaded_index())
    if args.only_visits:
        feed_list = [source for source in feed_list if source.get('ats') == 'visit']
        print(f'Reading only the {len(feed_list)} page(s) read in Chrome on this Mac')
    if employer_index.problem:  # said on the run, not only in its log: the check then crawled a small list
        run['warnings'].append(f'Employer index not downloaded ({employer_index.problem}): this check crawled {len(feed_list)} feeds, not the full list')
    return feed_list


# Gather sources with the existing parallel reader and shared run deadline.
def gather_sources(args, stores, db, feed_list, read_profile, hidden, dismissed, run):
    with feeds.database(DATA / 'jobs.sqlite') as feed_db:
        so_far = jobs_so_far.SoFar(db)   # each source's jobs in the list as soon as it is read, not all at the end (owner, 18 Oct 2026); before the slice, so its jobs stay "new" in the count
        full_read = args.mode in ('scheduled', 'run') and not args.only_visits
        slice_first = args.first_jobs and args.score_max and not args.only_visits and read_profile
        apis = start_apis(feed_db) if full_read else None   # every lane from second 0: the free APIs no longer wait for the employer sites (lanes 3/5)
        # Why (lanes 4a, owner, 11 Nov 2026: "Run's deadline, own lane (Recommended)"; L10): a first run's boards lane starts at second 0 with its own
        # board list, beside the slice; before, the slice read that list itself to the read cut and the web search's boards came after it, past the cut:
        # board jobs on a first run in 1 of 49 runs since 26 Oct. A repeat run starts it inside the employer read's scope below, as before.
        first = start_boards_first(listed=first_jobs.board_jobs) if full_read and slice_first else None
        early = start_early_sites(feed_list, feed_db) if full_read and slice_first else None   # the sites past the slice, downloaded beside it (feed_scan.EarlySites)
        try:   # Why (#3802, 11 Nov 2026): the lane's threads end with the whole gather, whatever raises before the APIs' stage (they were left running)
            if slice_first:
                try:   # a new user's first jobs in seconds: a slice of fast feeds, 3 jobs scored and synced one by one, then the full crawl below
                    with step_yield.span('employer_sites'):   # the slice also scores the first 3 jobs: its seconds are the read's and those scores' (step_yield.py)
                        first_jobs.run(db, feed_db, feed_list, read_profile(), hidden, sync=lambda: stores.matches.sync(
                            db, for_job_matches(db, hidden), hidden - dismissed, None, dismissed, partial=True),
                                       import_jobs=lambda slice_report: so_far.add(slice_report.get('jobs') or [], 'employer sites'),
                                       lane=first, lane_jobs=so_far.listener('job boards'))
                except Exception as error:  # noqa: BLE001 — the full search does everything the slice did
                    print(f'Warning: first jobs skipped: {type(error).__name__}: {error}', flush=True)
            from .ai import batch_scope
            from .sources import boards_ahead, boards_beside   # the found boards read beside the employer sites, not after them (owner, 19 Oct 2026)
            # Why (8 Nov 2026, owner: "One process, discovery inside (Recommended)"): the app's own discover step in front of the search held the
            # run lock to ~60 s, and the employer read stops 67.5 s after the press (run 42411469318, p7: employer sites got ~4 s).
            beside = getattr(args, 'discover_beside', False) and full_read and not args.first_jobs
            with batch_scope.concurrent() if beside or (full_read and not slice_first) else contextlib.nullcontext():   # one scope for every reader beside the employer sites
                if full_read and not slice_first:
                    first = start_boards_first()
                discovery = boards_beside.start() if beside else None
                try:
                    report, ahead = boards_ahead.scan_beside(feed_list, feed_db, load_search_config(), so_far, due=args.mode in ('scheduled', 'run'), first=first, **({} if early is None else {'early': early}))
                finally:   # inside the scope: its answers join the shared copies before the scope ends
                    if discovery is not None:
                        discovery.finish()
            crawl_funnel = report.get('funnel')   # not `funnel`: that name is the Notion funnel module used further down
            if crawl_funnel:   # the same fixed-list tags the pool uses (src/contribute.py): all that ever describes this search to the product
                crawl_funnel['roles'], crawl_funnel['regions'] = contribute.tags()
            run['funnel'] = crawl_funnel   # kept on the run's details too (src/run_details.py), not only in data/coverage.json (last crawl)
            coverage.save(crawl_funnel)   # how much of the market the role keywords catch (Strategy page, and anonymous counts if reports are on)
            gather_apis(args, feed_db, report, so_far, ahead, apis)
            # Why (lanes 4a; #3826, Gitar): the boards' lane reads to the run's end, but the gather takes its groups only to the employer sites' cut, as
            # before 4a: waiting to the lane's end held the import and every score up to ~100 s. Later groups: keep_late_boards, between the stages after.
            from .sources import read_budget
            report['jobs'] += take_boards_first(first, feed_db, so_far, until=read_budget.cut_at())
        finally:
            if apis is not None:
                apis.close()
            if early is not None:
                early.close()
    return report, so_far, first, apis


# Download the employer sites the first-jobs slice leaves, from second 0 (a failure here: the full read reads them, as before).
def start_early_sites(feed_list, feed_db):
    from .sources import feed_scan
    with stage.guard('employer sites: read ahead') as caught:
        return feed_scan.EarlySites(feed_list, feed_db, skip=first_jobs.pick(feed_list))
    print(f'Warning: employer sites not read ahead: {caught.reason}', flush=True)
    return None


# Ask every due free job API now, beside the other lanes.
def start_apis(feed_db):
    """The free job APIs' lane, asked from the press's start (src/sources/api_lane.py); None when none is due or it cannot start.
    Why (lanes 3/5, #3754, 11 Nov 2026): asked after the employer sites, past the read cut, they gave 0 jobs for 14 of 14 people (night 42927975750)."""
    from .sources import api_lane
    with stage.guard('free job APIs: start') as caught:
        return api_lane.start(feed_db, load_search_config())
    print(f'Warning: free job APIs not started early: {caught.reason}', flush=True)   # the free-API stage asks them itself
    return None


# Start the web search's boards before the employer sites, read beside them.
def start_boards_first(listed=None):
    """The job boards' lane (src/sources/boards_first.py Beside; listed: a first run's own board list); None when it cannot start.
    Why (ps E2a-2, owner, 8 Nov 2026: "Both: no waits + background (Recommended)", whose option kept "the boards still start first"): read before
    the employer sites, one board held them to 165 s (run 42451932088, p7: 0 of 13 employer sites read)."""
    from .sources import boards_first
    try:
        return boards_first.Beside(load_search_config(), listed=listed)
    except Exception as error:  # noqa: BLE001 — the full board read reads them
        print(f'Warning: job boards first skipped: {type(error).__name__}: {error}', flush=True)
        return None


# Keep and show what the boards first read and the employer sites' callbacks did not take yet.
def take_boards_first(first, feed_db, so_far, until=None):
    """Their jobs (the report's shape) to `until` at most, [] when they did not start or failed: the full board read reads them."""
    if first is None:
        return []
    try:
        return first.take(feed_db, so_far.listener('job boards'), until=until)
    except Exception as error:  # noqa: BLE001 — the full board read reads them
        print(f'Warning: job boards first skipped: {type(error).__name__}: {error}', flush=True)
        return []


def keep_late_boards(lane, so_far, wait=False):
    """The boards lane's groups that landed after the gather, kept and shown now (imported into the list, src/jobs_so_far.py): the main thread
    owns the job cache, so it hands them over between the stages after the gather (lanes 4a). Not scored this run when it has no time left:
    they wait in the list for the next run's scoring (4b). wait: the run's last hand-over (boards_first.Beside.last_pass): the groups until the
    last judging pass, which places and judges what the lane read (owner, 14 Nov 2026: "Judge in search + show both (Recommended)"), then the
    rest until the lane ends, at most to the run's own end (read_budget.run_end); between the stages nothing is waited for.
    Why (11 Nov 2026, #3835, owner: "A: read boards to 180 s", asked via AskUserQuestion; run 43103313269): a first search with little to score
    ended at 68 s with 7 boards open in the lane; the lane's threads end with the process, so the rest of its time read no board."""
    if lane is None:
        return
    try:
        with feeds.database(DATA / 'jobs.sqlite') as feed_db:   # the gather's connection is closed by now
            if wait:
                lane.last_pass(feed_db, so_far.listener('job boards'))
            else:
                lane.deliver(feed_db, so_far.listener('job boards'))
        so_far.flush()
    except Exception as error:  # noqa: BLE001 — late groups are a bonus; the run goes on
        print(f'Warning: late job boards not kept: {type(error).__name__}: {error}', flush=True)


def keep_late_apis(apis, so_far, wait=False):
    """The free APIs' reads that ended after the gather's read cut, kept and shown now (aggregators.keep_late; the main thread owns the job cache): between the stages only the
    ended ones, wait: the run's last hand-over, which waits for the rest to the run's own end at most. Not scored this run when it has no time left: they wait in the list
    for the next run's scoring (WP8 rule 6, #3754)."""
    if apis is None:
        return
    from .sources import aggregators, read_budget
    with stage.guard('free job APIs: late hand-over') as caught:   # late reads are a bonus; the run goes on
        until = (read_budget.run_end() if wait else None) or time_budget.now()
        with feeds.database(DATA / 'jobs.sqlite') as feed_db:
            aggregators.keep_late(feed_db, load_search_config(), apis, so_far.listener('free job APIs', 'free_job_apis'), until)
        so_far.flush()
    if caught:
        print(f'Warning: late free job APIs not kept: {caught.reason}', flush=True)


# Append paid and free API results in their original order.
def gather_apis(args, feed_db, report, so_far, ahead, apis=None):
    with step_yield.span('free_job_apis'):
        _gather_apis(args, feed_db, report, so_far, ahead, apis)


def _gather_apis(args, feed_db, report, so_far, ahead, apis=None):
    # Paid per search, so only full crawls use it; off without SERPAPI_API_KEY.
    if args.mode in ('scheduled', 'run') and google_jobs.api_key():
        google = google_jobs.scan(feed_db, google_jobs.api_key(),
                                  google_jobs.settings(load_search_config()))
        report['jobs'] += google['jobs']
        report['sources'] += google['sources']
    # Aggregators with public APIs (src/sources/aggregators.py): free ones always, keyed ones with their keys; each at most every 6 hours.
    if args.mode in ('scheduled', 'run'):
        from .sources import aggregators
        found = aggregators.scan(feed_db, load_search_config(), on_jobs=so_far.listener('free job APIs', 'free_job_apis'), ahead=ahead, lane=apis)
        report['jobs'] += found['jobs']
        report['sources'] += found['sources']
        gather_alerts(feed_db, report)


# Append allowed Gmail alert results, ignoring an absent scope.
def gather_alerts(feed_db, report):
    # Job-alert emails in the user's own Gmail (src/sources/job_alerts.py): LinkedIn & co. without ever fetching their pages.
    from . import features
    from .ai import engine
    if features.enabled('job_alerts') and engine.ready():
        from .sources import google as google_api, google_scopes, job_alerts
        gmail = google_api.Google.from_env()
        if gmail and (gmail.scopes is None or 'gmail' in gmail.scopes):   # Gmail left unticked: no alert emails to read
            try:
                alerts = job_alerts.scan(feed_db, gmail, engine.client(action='mail'))
                report['jobs'] += alerts['jobs']
                report['sources'] += alerts['sources']
            except google_scopes.MissingScope:   # an older sign-in without Gmail: learned now, the crawl goes on without alert emails
                pass


# Import the final report while preserving each early job status.
def import_sources(db, report, so_far, run):
    from .ai import cost as ai_cost
    if ai_cost.SIDE:   # careers pages, link picks and alert emails read with AI during this crawl: part of the run's AI cost
        run['sources'] = dict(ai_cost.SIDE)
    for source in report.get('sources') or []:   # an employer's own site that refuses us: offered as a site only you can open
        if not source.get('ok') and source.get('ats') == 'careers' and source.get('slug'):
            from .sources import careers as careers_pages, visits
            visits.refused(source['company'], careers_pages.decode(source['slug']), source.get('error') or '')
    imported = so_far.statuses(report, store.import_watch_report(db, report))   # a job shown early stays "new"
    from .sources import feed_facts
    feed_facts.keep_seen(db, report)   # employers not read because their lists are unchanged: their jobs are still listed
    run.update(crawl_counts(report, imported))
    # What this refresh added, by place (owner, 7 Oct 2026: "we should understand what's being added, what's being removed").
    new_here = Counter(store.place_name(job.get('location')) for job, status in zip(report.get('jobs', []), imported) if status == 'new')
    if new_here:
        print(f'Added {sum(new_here.values())} new job(s): {store.grouped(new_here)}', flush=True)
        for line in new_job_lines(report.get('jobs', []), imported):
            print(line, flush=True)   # the result card lists them when no digest is sent (desktop/renderer/new-jobs-card.js)
    return imported


# Offer the opt-in pool contribution without blocking the run.
def contribute_sources(args, stores, db, feed_list, report, stages):
    if args.mode in ('scheduled', 'run', 'today'):
        try:  # opt-in (src/contribute.py); the pool never affects a run
            contribute.maybe_send(feed_list, report, stores, db=db, stages=stages)
        except Exception as error:  # noqa: BLE001
            print(f'Warning: pool contribution skipped: {type(error).__name__}: {error}')


# Expire jobs only after a full crawl and a valid employer index.
def close_sources(args, db, feed_list, run):
    if args.mode in ('scheduled', 'run'):
        # Only full crawls can tell that a job disappeared.
        gone_from = Counter()
        run['closed_stale'] = store.close_stale(db, STALE_DAYS, who=gone_from)
        print(f"Expired {run['closed_stale']} job(s) not seen for {STALE_DAYS} days" + (f': {store.grouped(gone_from)}' if gone_from else ''))
        if not employer_index.problem:   # a list that failed to download is not a list of dropped employers
            dropped = store.close_dropped(db, {source['company'] for source in feed_list})
            if dropped:
                print(f'Expired {dropped} job(s) from employers your search no longer reads')


# Import company reports before closing and pruning out-of-search jobs.
def filter_jobs(args, db, imported):
    if args.mode != 'more' and args.company_report.exists():
        company_report = json.loads(args.company_report.read_text())
        imported += store.import_company_report(db, company_report)
    if args.mode in ('scheduled', 'run'):
        # Last of the imports (7 Oct 2026: the job boards' report, imported after it, opened again jobs this had just closed): jobs outside
        # your places close; acted on, added by you, or with no place stay.
        from .sources import feeds as feed_places
        outside = Counter()
        feed_places.place_open_jobs(db)
        elsewhere = store.close_elsewhere(db, feed_places.keep_open, where=outside)
        if elsewhere:
            print(f'Unmatched {elsewhere} job(s) outside your places: {store.grouped(outside)}')
        pruned = store.prune_gone(db)   # unmatched or expired, unseen for 60 days, never acted on: the cache stops growing for ever
        if pruned:
            print(f'Removed {pruned} old unmatched or expired job(s) from this computer\'s cache')
    return imported


# Backfill missing descriptions without blocking later phases.
def backfill_descriptions(db):
    # Jobs that came without a description (SmartRecruiters' list, a jobs.ch page that failed) get it now, or
    # they'd never be enriched or scored. A few per run; a failure is tried again next run.
    try:
        note = describe.backfill(db)
        if note:
            print(note)
    except Exception as error:
        print(f'Warning: description backfill skipped: {type(error).__name__}: {error}')


# Save scored matches and kits, then measure source yield.
def save_matches(args, stores, db, run, report, hidden, dismissed, started):
    open_urls = None   # the crawl's open jobs, set by the Job Matches sync below; None checks every saved job
    if args.mode in ('scheduled', 'run', 'today'):
        try:
            scored = for_job_matches(db, hidden)
            open_urls = {j['url'].strip() for j in store.digest_jobs(db, limit=10_000) if j.get('url')}
            run['top_new'] = top_new(report, scored)
            # Scored jobs into the store's Job Matches (src/stores Matches.sync); a store problem never blocks the digest.
            run['matches'] = stores.matches.sync(db, scored, hidden - dismissed, open_urls, dismissed)
            print(run['matches'])
            if args.auto_kit_max:
                # Runs after scoring so it sees the same fits; a kit failure never blocks the digest.
                run['kits'] = {}
                summary, drafted_jobs = kit.auto_run(db, scored, stores, kit.DEFAULT_MODEL,
                                                     args.auto_kit_max, args.auto_kit_min_score, stats=run['kits'])
                run['kit_titles'] = [f"{job['title']} ({job['company']})" for job, _ in drafted_jobs]
                print(summary)
        except Exception as error:
            print(f'Warning: Job Matches sync or auto-kit skipped: {type(error).__name__}: {error}')
            run['warnings'].append(f'Job Matches sync or auto-kit skipped: {type(error).__name__}')
        try:   # which sources gave this search its relevant jobs, kept per run (src/source_yield.py); never stops a search
            from .sources import found_boards
            source_yield.run(db, started, read=found_boards.read_since(started))   # every board read keeps a row: its history (board_yield.dead)
        except Exception as error:  # noqa: BLE001
            print(f'Warning: source yield not measured: {type(error).__name__}: {error}')
        try:   # what each step brought and how long it ran, kept per run (src/press/step_yield.py, report only); never stops a search
            step_yield.run(db, started)
        except Exception as error:  # noqa: BLE001
            print(f'Warning: step yield not measured: {type(error).__name__}: {error}')
    return open_urls
