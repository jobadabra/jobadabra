#!/usr/bin/env python3
"""Source scout: grow the list of employer job feeds a few companies per run.

Each run
1. harvests candidate employers (seed list with Tier 1 first, Hacker News "Who is
   hiring?", the open hiring-without-whiteboards list, employers already seen
   on jobs.ch, and boards found by searching for the user's roles),
2. probes a small batch of them for a public job feed (Greenhouse, Lever, Ashby,
   Workable, Recruitee, Personio, SmartRecruiters, plus Amazon and Netflix),
3. scores every feed it finds for quality (0-100) against the owner's goals,
4. registers useful feeds (the store's employers: Notion Employers & Sources, + local table) so the
   4-hourly crawl includes them, and
5. sends one Telegram summary.

Progress lives in the table scout_candidates, so later runs continue where this
one stopped. Nothing here applies to jobs; it only finds where jobs are posted.
"""

import argparse
import json
import os
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, wait  # noqa: F401 -- scout_run and tests reach scout.ThreadPoolExecutor / scout.wait
from html import escape
from pathlib import Path
from . import budget_tape, read_methods, run_exit, contribute, employer_index, scout_carry, scout_need, scout_overrun, scout_queue, scout_role_search, run_log, scout_core, store, telegram, notification_cards as cards  # noqa: F401 -- retained public names; scout_run uses the scout dependency seam
from .notion import client as notion, cron_runs  # noqa: F401 -- notion: tests patch scout.notion (its Tracker)
from .paths import CONFIG, JOBS_DB, load_search_config
from .sources import ats, careers, feeds  # noqa: F401 -- `feeds` is also reached as scout.feeds by tests
from .scout_candidates import counts_when_covered, harvest, harvest_met, skipped_origins, starter_list  # noqa: F401 -- retained public names; scout_run uses the scout dependency seam
from .scout_core import DEFAULT_BATCH, RECHECK_DAYS, SEEDS, TABLES, TIER1_MIN_RELEVANT, batch_for, ensure_tables, key_for, now, pending_count
from .scout_index import board_stats, build_index, central_stats, dead_ends, run_record, fetch_boards, fetch_contributions, market_coverage, publish_index, publish_summary, published_line, record_unread, run_headline
from .scout_notion import active_sources, export_sources, mark_synced, not_updated, sync_employers, synced_key, write_employer  # noqa: F401 -- retained public names; scout_run uses the scout dependency seam
from .scout_probe import READERS, find_feed, next_batch, quality, skipping
from .scout_core import (  # noqa: F401 -- re-exported: other modules and tests use `scout.<name>`
    DEFAULT_BATCH, EMPLOYERS_DB, HN_THREADS, MAX_BATCH, RECHECK_DAYS, SEEDS, SEED_ORIGINS, SMALL_GUESS, TABLES, TECH_LIST_ORIGINS,
    TIER1_MIN_RELEVANT, _SEARCH, _get_json, _get_text, batch_for, clean_name, key_for, now, pending_count)
from .scout_candidates import (  # noqa: F401 -- re-exported: other modules and tests use `scout.<name>`
    LOCATION_WORDS, ROLE_WORDS, WIKIDATA_MAX_AGE, WIKIDATA_QUERY, WIKIDATA_TIMEOUT_S, _seed_candidates,
    hacker_news_candidates, harvest, local_company_candidates, search_countries, seed_candidates, skipped_origins, starter_list,
    swissdevjobs_candidates, whiteboards_candidates, wikidata_candidates, wikidata_query, wikidata_rows)
from .scout_probe import (  # noqa: F401 -- re-exported: other modules and tests use `scout.<name>`
    JOB_SUBDOMAINS, JUDGES, READERS, READER_FILES, STACK, STOP_WORDS, SWISS_OR_ZURICH, belongs_to, board_url, find_feed, job_hosts,
    job_places, next_batch, quality, readers_version, relevant_roles, skipping, workday_url)
from .scout_notion import (  # noqa: F401 -- re-exported: other modules and tests use `scout.<name>`
    FEED_STATUS, active_sources, employer_record, excluded_companies, export_sources, mark_synced, own_feeds, research_links,
    sync_employers, write_employer)
from .scout_index import (  # noqa: F401 -- re-exported: other modules and tests use `scout.<name>`
    FIT_MIN_INSTALLS, FIT_NAMES, MARKET_TERMS, MIN_INSTALLS, OWN_MIN_INSTALLS, POOL_MIN_INSTALLS, QUIET_DAYS, SWISS, board_stats,
    build_index, central_stats, dead_ends, fetch_boards, fetch_contributions, fits, health, market_coverage, pool_of, publish_index,
    publish_summary, record_unread, run_headline)
from . import scout_run


# The employers are checked in parallel threads: print() writes the text and its newline separately, so two lines could join
# ("…Hochschule BernScout: checked 6 of 15", 6 Oct 2026). One locked write per line, with its count.
PROGRESS_LOCK = threading.Lock()


def progress_line(text):
    sys.stdout.write(f'{text}\n')
    sys.stdout.flush()


def ai_ideas(db, harvest_sources=None):
    """Claude's ideas for new candidates (every run), or None: off, no AI available, tests that pass their own
    harvest sources, or a failure (the scout then simply carries on with the usual sources)."""
    from . import features
    from .ai import engine, scout_ideas
    if harvest_sources is not None or os.getenv('JOBADABRA_FIXTURE_DIR') or not features.enabled('scout_ai') or not engine.ready():
        return None
    from . import scout_cells   # the central scout aims at the list's thinnest kind × country, not the example search's roles
    search, label = scout_cells.aim(db, load_search_config()) if scout_core.CENTRAL else (load_search_config(), '')
    try:
        found = scout_ideas.run(db, search, label=label)
    except Exception as error:  # noqa: BLE001 — the ideas are a bonus: a failed call must never stop the scout
        print(f'Warning: scout ideas skipped: {type(error).__name__}: {error}')
        return None
    if found:
        print(f"Scout ideas: {found['companies']} companies and {found['directories']} from company lists. {found['note']}")
    return found


# Orchestrate the scout phases while retaining the public dependency seams.
def run(db, batch=DEFAULT_BATCH, stores=None, seeds=None, probe=ats.probe, harvest_sources=None, workers=6, static=None, budget=0):
    """Harvest, probe one batch, register what is useful. Returns (summary dict, list of outcomes).
    A board already crawled is a duplicate: the starter list (`static`, default config/sources.json), the feeds registered here and the store's
    active employers. stores: where each checked employer is written (None: only this computer's scout table)."""
    seeds = seeds or json.loads(SEEDS.read_text())
    if static is None:
        static = starter_list()
    scout = sys.modules[__name__]
    skip = scout_run.read_lists(scout, db, seeds)
    deadline, may_add, have = scout_run.name_budget(scout, db, harvest_sources, budget)
    added, ideas = scout_run.harvest_names(scout, db, seeds, stores, harvest_sources, skip, budget, deadline, may_add, have)
    candidates, left = scout_run.plan_candidates(scout, db, batch, skip, have)
    active, search, lookup = scout_run.probe_options(scout, db, stores, static, harvest_sources)
    check, note_site, unread = scout_run.make_checks(scout, lambda: len(candidates), probe, active, search, lookup)
    save, shared = scout_run.make_recorder(scout, db, stores)
    outcomes = scout_run.probe_parallel(scout, candidates, check, save, workers, deadline)
    candidates, outcomes = scout_run.keep_completed(candidates, outcomes, budget)
    return scout_run.finish_run(scout, db, candidates, outcomes, note_site, unread, shared, skip, left, added, ideas, have)


def telegram_summary(summary, results):
    found = sorted([(c, o) for c, o in results if o['status'] == 'found'], key=lambda x: -x[1]['quality'])
    counts = {s: sum(1 for _, o in results if o['status'] == s) for s in ('none', 'low', 'manual', 'duplicate', 'watch')}
    blocks = []
    for i, (c, o) in enumerate(found, 1):
        s = o['stats']
        tier = ' · Tier 1' if c['tier'] == 'Tier 1' else ''
        places = s['places'][:3]
        blocks.append(cards.block(
            cards.join('', [cards.words('scout.quality', {'index': i, 'name': escape(c['name']), 'quality': o['quality']}), cards.words('scout.tier') if tier else '']),
            cards.safe(cards.dot(cards.words('scout.matching', count=s['relevant']), cards.words('scout.preferred', count=s['preferred']))),
            cards.fact(cards.words('scout.location' if len(places) == 1 else 'scout.locations'), ', '.join(places)),
            cards.fact(cards.words('scout.platform'), o['ats'].capitalize())))
    if not found:
        blocks.append(cards.words('scout.noFeeds'))
    detail = [cards.words('scout.unread', count=counts['none']), cards.words('scout.low', count=counts['low'])]
    left = summary.get('left') or 0
    if left:   # not checked here: other installs found no job site there lately (7 Oct 2026: 52 of 92 went unsaid)
        detail.append(cards.words('scout.held', count=left))
    if counts['watch']:
        detail.append(cards.words('scout.watched', count=counts['watch']))
    if counts['manual']:
        detail.append(cards.words('scout.manual', count=counts['manual']))
    if summary.get('ideas'):
        ideas = summary['ideas']
        blocks.append(cards.block(cards.words('scout.ideas'), cards.safe(cards.words('scout.ideasQueued', {'companies': ideas['companies'], 'directories': ideas['directories']})),
                                   escape(ideas['note'])))
    rest = cards.dot(*detail, cards.words('scout.crawled', count=summary['total_feeds']), cards.words('scout.queued', count=summary['queued']),
                      cards.words('scout.harvested', count=summary['harvested']) if summary['harvested'] else '')
    blocks.append(cards.block(cards.words('scout.notAdded'), cards.safe(rest)))
    first = summary.get('first_time')
    again = summary['checked'] - first if first is not None else 0
    # Checked again only once every new name was tried (next_batch): said, so it is not read as effort spent instead of new names (7 Oct 2026).
    return cards.card(cards.words('scout.title'), cards.dot(cards.words('scout.checked', count=summary['checked']), cards.words('scout.first', count=first) if first is not None else '',
                                                         cards.words('scout.again', count=again) if again else '',
                                                         cards.words('scout.setAside', count=left) if left else '', cards.words('scout.found', count=len(found))), blocks,
                       emoji='🔎', footer=cards.words('scout.footer'))


def ai_cost_line(what, usd, api_calls, plan_calls, calls):
    """What a run's AI cost, in words: dollars only for calls on the API key; calls through Claude Code are on the user's Claude plan
    (6 Oct 2026: "$0.000 in 21 call(s)" read as broken to a Claude Code user)."""
    from .ai import providers
    plan, tool = ('ChatGPT plan', 'Codex') if providers.spec().family == 'openai' else ('Claude plan', 'Claude Code')
    if plan_calls and not api_calls:
        return f'AI of this {what}: {plan_calls} call(s) on your {plan} ({tool}: no cost per call)'
    if plan_calls:
        return f'AI cost of this {what}: ${usd:.3f} for {api_calls} call(s) on your API key, plus {plan_calls} on your {plan}'
    return f'AI cost of this {what}: ${usd:.3f} in {calls} call(s)'


def report_ai_cost(side):
    """Print what this run's AI calls cost, and write {usd, calls} to JOBADABRA_AI_COST_FILE when set (the central scout's workflow
    reports it to the owner's /ai-cost page). Always written when asked, even $0: a job that spent nothing must still show up."""
    usd, calls = float(side.get('usd') or 0), int(side.get('done') or 0)
    print(ai_cost_line('scout run', usd, int(side.get('api_calls') or 0), int(side.get('cli_calls') or 0), calls))
    from .ai import cost
    if cost.TOPICS:   # Why (5 Nov 2026, #2915): here, not at exit: leave_if_stuck's os._exit skips atexit, so decide's own line never reached a central run's log
        print('AI calls by topic: ' + ', '.join(f'{topic} {n}' for topic, n in sorted(cost.TOPICS.items(), key=lambda item: (-item[1], item[0]))))
        from .ai import decide
        if scout_core.CENTRAL:   # Why (sk 4/5, 11 Nov 2026): the trial's topic totals could not show whether the probe stayed within its allowance (page reads also come from outside the probe)
            print(f'Probe allowance: {decide.probe_spent()} of {decide.CENTRAL_PROBE_CALLS} calls used')
    target = os.getenv('JOBADABRA_AI_COST_FILE')
    if target:
        Path(target).write_text(json.dumps({'usd': round(usd, 6), 'calls': calls}))


def employer_store():
    """The active store, opened as the jobs check opens it (src/store_access.py open_run): Notion through the engine's own client when
    the user is on it, else this Mac's."""
    from .store_access import open_run
    return open_run()


def where_of(stores):
    return 'Notion' if stores.name == 'notion' else 'your employer list'


def upload_index(trial_run, feeds_out, *args, **kwargs):
    """The count of feeds published: publish_index's, or with --no-upload (a trial) the feeds built, nothing sent.
    Why (sk, 11 Nov 2026, owner: no proof waits for a merge when a by-hand run can give it): a trial of a branch reads the live index and must write none of it."""
    if not trial_run:
        return publish_index(feeds_out, *args, **kwargs)
    print('Scout: trial run (--no-upload): nothing was uploaded to the employer index')
    return len(feeds_out)


def sync_store_only(db_path):
    """--sync-store: write the employers checked on this computer that the active store lacks, then stop. Returns the exit code."""
    stores = employer_store()
    if not synced_key(stores):
        print('Employers: no employer list to write to; nothing to write.')
        return 0
    with store.connect(db_path) as db:
        ensure_tables(db)
        written, failed = sync_employers(db, stores)
    print(f'Employers: {written} written to {where_of(stores)}')   # each one not written said so in its own Warning line
    return 1 if failed and not written else 0


def board_pass(db_path, lanes=0, merge=None):
    """The central scout's board pass alone (--board-pass): one country's boards measured and kept. Returns the exit code.
    Why (12 Nov 2026, sa): a by-hand SCOUT_BOARD_COUNTRY the list does not know ends the run with the accepted names; it used to read the thinnest country instead."""
    from . import scout_board_cells, scout_board_lanes, scout_boards
    if merge or lanes:   # several lanes at once (src/scout_board_lanes.py): a round's countries, or its lanes brought back; no pass here
        return scout_board_lanes.merge_all(db_path, merge) if merge else scout_board_lanes.plan(db_path, lanes)
    scout_core.CENTRAL = True
    with store.connect(db_path) as db:
        try:
            named = scout_boards.named_country(os.environ.get('SCOUT_BOARD_COUNTRY'))
        except ValueError as wrong:
            raise SystemExit(f'Board pass: {wrong}') from None
        if named and (scout_board_lanes.only(os.environ.get(scout_board_lanes.ONLY_ENV)) or {named}) != {named}:   # its merge keeps the lane's own country only
            raise SystemExit('Board pass: SCOUT_BOARD_COUNTRY names another country than this lane\'s SCOUT_BOARD_ONLY')
        scout_boards.ensure(db)
        scout_boards.seed_final(db, os.environ.get('SCOUT_BROWSER_FINAL'))   # stops a trial saw: jobadabra-lab's by-hand input
        scout_board_cells.keep_stops(db, os.environ.get('SCOUT_BOARD_SEED_DB'))   # the Scout's own stops: discovery keeps its own database
        try:
            if named:
                scout_boards.run(db, named=named, kinds=scout_boards.named_kinds(os.environ.get('SCOUT_BOARD_KINDS')))
            else:
                discover(db)
        finally:
            from .sources import render
            render.close()   # the browser a refused board was measured in (scout_boards.browse); nothing when it never started
    return 0


def discover(db, run=None, out=print, today=None):
    """Board discovery's turn (src/scout_board_cells.py): the weakest cells' country, their families, and the facts due to be read again; the
    cells' rest is kept after. Its database is its own (the lab passes --db), started once from the Scout's facts (SCOUT_BOARD_SEED_DB), so the two
    jobs never save over each other's memory; the Scout publishes both (SCOUT_BOARD_DB). SCOUT_BOARD_CELLS ("sk:nursing_care") names cells by hand; SCOUT_BOARD_PRIORITY lists the cells that go first among
    equals (the lab's private list). Why (12 Nov 2026, owner, asked via AskUserQuestion: "Separate lab workflow (Recommended)"): the thinnest country
    by employers never gave a turn to the countries with no measured board."""
    from . import scout_board_cells as cells, scout_board_lanes, scout_boards
    cells.seed(db, os.environ.get('SCOUT_BOARD_SEED_DB'), out)
    priority = cells.parse(os.environ.get('SCOUT_BOARD_PRIORITY'))
    try:
        only = scout_board_lanes.only(os.environ.get(scout_board_lanes.ONLY_ENV))   # one lane of several at once: its own country or nothing
    except ValueError as wrong:
        raise SystemExit(f'Board discovery: {wrong}') from None
    turn = cells.pick(db, today, priority=priority, named=cells.parse(os.environ.get('SCOUT_BOARD_CELLS')), only=only)
    if not turn:
        out('Board discovery: every cell under its target rests; nothing to read this run')
        return []
    country, families, again = turn
    kept = (run or scout_boards.run)(db, named=country, families=families, again=again, out=out)
    cells.record(db, country, families, kept, today, again=again)
    out(cells.line(db, today, priority))
    return kept


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=JOBS_DB)
    parser.add_argument('--batch', type=int, default=DEFAULT_BATCH, help='candidates probed per run')
    parser.add_argument('--budget', type=int, default=0, help='seconds: no new check starts after this; the rest wait for the next run (0 = none)')
    parser.add_argument('--send', action='store_true', help='send the summary to Telegram')
    parser.add_argument('--log-run', action='store_true', help="log this run in the active store's run history (⏱️ Search runs on "
                                                                 'Notion; the desktop app does)')
    parser.add_argument('--publish-index', action='store_true',
                        help='the central scout: after the run, verify every feed and upload the employer index '
                             '(needs INDEX_PUBLISH_KEY; URL: JOBADABRA_INDEX_URL or the default)')
    parser.add_argument('--no-upload', action='store_true',
                        help='with --publish-index: a trial of an unmerged change (jobadabra-lab central-scout.yml engine_ref): every step runs and logs as the central scout does, and nothing is uploaded')
    parser.add_argument('--board-pass', action='store_true',
                        help="the central scout's board pass alone: one thin country's job boards measured and kept for the next publish "
                             '(its own job and AI cap in jobadabra-lab board-discovery.yml; the country: SCOUT_BOARD_COUNTRY with SCOUT_BOARD_KINDS, '
                             'else board discovery\'s weakest cells: SCOUT_BOARD_CELLS, SCOUT_BOARD_PRIORITY, src/scout_board_cells.py; boards the headless browser must never open: '
                             'SCOUT_BROWSER_FINAL, hosts separated by commas, from jobadabra-lab board-discovery.yml\'s browser_final input)')
    parser.add_argument('--board-lanes', type=int, default=0, metavar='N',
                        help='board discovery in several lanes at once: print the N different countries one round reads side by side (src/scout_board_lanes.py), then stop')
    parser.add_argument('--board-merge', nargs='+', metavar='COUNTRY=PATH',
                        help="after a round's lanes: copy each lane's own country from its copy of the memory into --db, then stop")
    parser.add_argument('--sync-store', '--sync-notion', dest='sync_store', action='store_true',
                        help='write the employers already checked on this computer that the active store lacks (its employer list; '
                             'on Notion, Employers & Sources: the app runs it when Notion is connected), then stop')
    parser.add_argument('--paste-file', type=Path, help='a page the user pasted (text or one address): its companies are checked first (src/scout_paste.py)')
    parser.add_argument('--export-sources', action='store_true',
                        help='write config/sources.json: the shared starter list of verified public feeds '
                             '(sources.json + the active store\'s active employers with a feed)')
    args = parser.parse_args()
    if args.sync_store:
        return sync_store_only(args.db)
    started = time.monotonic()
    scout_core.CENTRAL = bool(args.publish_index)   # the central scout: its full lists, published to every install
    args.board_pass = args.board_pass or bool(args.board_lanes or args.board_merge)   # the lanes' two commands enter where a pass does (board_pass)
    if args.board_pass:   # Why (12 Nov 2026, owner: "own job"): inside the scout's run the passes before it spent the run's AI calls (src/scout_boards.py)
        return board_pass(args.db, lanes=args.board_lanes, merge=args.board_merge)
    if args.export_sources:
        kept, failed = export_sources(employer_store())
        print(f'Wrote {len(kept)} feeds ({sum(k["jobs"] for k in kept):,} open jobs) to config/sources.json')
        for item in failed:
            print(f"  left out {item['company']} ({item['ats']}:{item['slug']}): {item['error']}")
        return 0
    from .features import disabled
    if disabled('scout'):
        print('Source scout is off (JOBADABRA_DISABLE includes scout).')
        return 0
    stores = employer_store()
    from . import trial
    if trial.pause_run(args, stores, mode='scheduled'):   # Always on after the free trial: no new employer checks (src/trial.py)
        return 0
    logged = args.send or args.log_run   # on any store: the row is in the run history wherever the data is
    if logged:
        run_log.auto_begin(stores)  # the scout's run row opens when it starts
    log = run_log.new_run('scout')
    with store.connect(args.db) as db:
        if args.paste_file:
            from . import scout_paste
            try:
                print(scout_paste.summary(scout_paste.add(db, scout_paste.read_file(args.paste_file), search=load_search_config())))
            except Exception as error:  # noqa: BLE001 — the usual run still goes on
                print(f'Warning: pasted page not read: {type(error).__name__}: {error}')
        fetched = None   # the central scout reads what installs shared before its run, so it skips their dead ends (20 Oct 2026)
        if args.publish_index and scout_core.CENTRAL and os.getenv('INDEX_PUBLISH_KEY'):
            fetched = fetch_contributions(os.getenv('JOBADABRA_INDEX_URL') or employer_index.URL, os.environ['INDEX_PUBLISH_KEY'], with_nofeed=True)
            scout_core.SHARED_DEAD = employer_index.fresh_nofeed(fetched[1])
        if scout_core.CENTRAL:
            scout_overrun.arm(args.budget or scout_core.CENTRAL_BUDGET_S)   # an empty log at the job's cancel hid what held two runs (20 Oct 2026)
        with scout_overrun.phase('checking employers'):
            summary, results = run(db, args.batch, stores, budget=args.budget or (scout_core.CENTRAL_BUDGET_S if scout_core.CENTRAL else 0))
        if synced_key(stores):   # employers checked earlier (before this store), or whose write failed, catch up now
            written, failed = sync_employers(db, stores)
            if written or failed:
                print(f'Employers: {written} checked earlier written to {where_of(stores)}')
        if not scout_core.CENTRAL:   # what this run found goes to the central list right away (opt-in; src/contribute.py), not with the next jobs check
            try:
                from . import contribute
                contribute.maybe_send(active_sources(db, stores, starter_list()), {'sources': []}, stores, db=db)
            except Exception as error:  # noqa: BLE001 — the pool never affects a run
                print(f'Warning: pool contribution skipped: {type(error).__name__}: {error}')
        if args.publish_index:
            key = os.getenv('INDEX_PUBLISH_KEY')
            if not key:
                raise SystemExit('--publish-index needs INDEX_PUBLISH_KEY')
            index_url = os.getenv('JOBADABRA_INDEX_URL') or employer_index.URL
            from . import scout_board_cells, scout_boards, scout_cells
            deadline = min(scout_overrun.publish_deadline(started), time.monotonic() + scout_core.VERIFY_BUDGET_S)
            with scout_overrun.phase('reading what installs shared'):
                contributions, shared_dead = fetched or fetch_contributions(index_url, key, with_nofeed=True)
            swiss_titles = []
            with scout_overrun.phase('reading the index published now, to carry its feeds'):
                scout_carry.seed(db, index_url, key)
            with scout_overrun.phase(f'checking every feed for the index'):
                feeds_out, failed = build_index(db, json.loads((CONFIG / 'sources.json').read_text()), contributions=contributions, workers=24,
                                                boards=json.loads(SEEDS.read_text()).get('boards', []), swiss_titles=swiss_titles, deadline=deadline, carry=True)
            scout_cells.keep(db, feeds_out)   # the next run's ideas aim at the thinnest kind × country
            print(scout_cells.coverage_line(scout_cells.totals(feeds_out)))
            board_facts = scout_boards.facts(db) + scout_board_cells.facts_beside(os.environ.get('SCOUT_BOARD_DB'))   # the board pass's facts, the 30 days' (board discovery's own copy last: the site keeps the last fact per host and country)
            with scout_overrun.phase('market coverage and stats'):
                stats = central_stats(db, feeds_out, market_coverage(swiss_titles, deadline=deadline), run=run_record(summary, results))
            with scout_overrun.phase('reading the job boards'):
                boards = board_stats(fetch_boards(index_url, key))
            with scout_overrun.phase('uploading the index'):
                count = upload_index(args.no_upload, feeds_out, index_url, key, stats=stats, nofeed=dead_ends(db, shared_dead), boards=boards, board_facts=board_facts)
            print(publish_summary(feeds_out, contributions, boards))
            print('Feeds by system: ' + ', '.join(f'{system} {n}' for system, n in Counter(f['ats'] for f in feeds_out).most_common()))
            print('Market coverage (our index / jobs.ch): ' + ', '.join(f"{m['term']} {m['ours']}/{m['jobsch']}" for m in stats['market']))
            print(published_line(count, failed, feeds_out))
    from .ai import cost as ai_cost
    if ai_cost.SIDE:   # AI ideas, link picks and page reads of this scout run: logged like any AI step
        log['sources'] = dict(ai_cost.SIDE)
    report_ai_cost(ai_cost.SIDE)
    message = telegram_summary(summary, results)
    log['headline'] = run_headline(message)
    log['subject'] = cron_runs.counted(sum(1 for _, outcome in results if outcome['status'] == 'found'), 'new feed')
    if args.send and not disabled('telegram'):
        print(message)
        telegram.deliver(message, *telegram.credentials(), **cards.delivery(message))
    else:
        telegram.to_app(message)  # no Telegram: the desktop app shows the summary
    if logged:
        run_log.log_run(stores, log)
    if scout_core.CENTRAL:
        scout_overrun.leave_if_stuck()


if __name__ == '__main__':
    main()
