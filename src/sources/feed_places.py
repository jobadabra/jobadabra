"""A reader's place call runs beside the hub, not in it (#2920, owner-seen as fewer jobs on a Find jobs press).
Why (7 Nov 2026, #2920, runs 42386229424 vs 42315566393, p10 Amsterdam and p14 Gothenburg): the employer reader placed its new locations (one AI call, 20-21 s) IN the hub thread, which runs the
other readers' hand-overs only while it waits in a title sort: EURES's 200 vacancies sat in the hub's box. The first title ask moved from 57-60 s to 101-124 s and the 2:15 clock allowed 2 title
calls instead of ~8 (titles sorted 108 -> 60 and 185 -> 58). The call now runs in a worker and the hub serves the others' hand-overs while it waits.
Why the reader's own jobs still wait for the answers (review of #3512, 7 Nov 2026): `feeds.triage` marks the AI sort as run (feeds.ASKED), after which `wanted_title` stops using the role words, and
`wanted_location` falls back to the place words for a location not placed yet: a sort beside the place call raced that flag (no place call at all on big lists) and handed words-yes, AI-out jobs
("Paris, Texas") to scoring. Since rj's side-by-side PR (11 Nov 2026) the held jobs' TITLES are sorted beside the call (title_triage.decide alone: no flag, no hand-over); the JOBS still wait. Since sf's place PR a (10 Nov 2026) only the jobs at the locations the call asks about wait: the others' places are known (kept answers, the
map's cache), so their titles are sorted at once. Why (owner, 10 Nov 2026, asked via AskUserQuestion in session sa: "Only the asked jobs wait (Recommended)"): after #3676 a few remote locations nobody had placed
started the call, and on main p9 Lyon's employer jobs at known Lyon places were listed at 127 s, behind a place call asked at 36 s and answered at 125 s (sa's Mac run). The race stays closed: the jobs to place are chosen before any sort sets the flag, and
every job at an asked location, whatever its title, waits for the answer. Tests: tests/unit/ai/test_titles_with_places.py."""
import threading
from collections import Counter
from concurrent.futures import Future

from ..ai import batch_scope, providers, slots, title_queue
from ..ai.providers.contract import detail, reason


def triage_with_places(jobs):
    """The place call for these jobs' new locations in a worker, and feeds.triage: at once for the jobs whose place is known, after the answers for the jobs at a
    location the call asks about; this thread serves the hub's other readers while it waits (title_queue.wait_for)."""
    from . import feeds   # read at call time: tests patch feeds.* as before
    from ..ai import place_triage
    if feeds.placing():   # what is known without a model call: the kept answers and the map's cache (no AI), so those jobs need not wait
        locations = [job.get('location') for job in jobs if (job.get('location') or '').strip()]
        feeds.placed().update(_guarded(lambda: place_triage.known_now(locations, feeds._SEARCH),
                                       lambda why: f'the map of places was not read ({why}): these jobs wait for the place call') or {})
    chosen = [job for job in jobs if to_place(job)]   # before any sort below sets feeds.ASKED (the #3512 race)
    # Asked: not placed, or a plain 'out' whose "names no town" question this run may still turn into 'out:vague' (code review of sf place PR a)
    asked = {where for where in (place_triage.norm(job['location']) for job in chosen) if feeds.placed().get(where) in (None, 'out')}
    placing, views = Future(), batch_scope.current()

    def place():
        try:
            with batch_scope.using(views):   # the reader's own views, as if the call ran in its thread
                place_jobs(chosen, chosen=True)
            placing.set_result(None)
        except BaseException as error:  # noqa: BLE001 — raised in the reader's thread below, where its caller handles it
            placing.set_exception(error)
    # Why TITLES (sa, 11 Nov 2026, local p10 search): at the reader's own level this call was asked at 46 s and answered at 144 s behind the scores, and every job at
    # its locations waited for it. It decides jobs as a title batch does, one short call for up to a batch of locations: the same place in the line.
    threading.Thread(target=slots.carry(place, slots.TITLES), daemon=True, name='place-call').start()
    held = [job for job in jobs if place_triage.norm(job.get('location') or '') in asked]   # by location: no job at an asked place is sorted on the place words
    go = [job for job in jobs if place_triage.norm(job.get('location') or '') not in asked]
    sorting = _titles_beside(held, views)
    if go:
        feeds.triage(go)
    title_queue.wait_for(placing)
    if sorting is not None:
        title_queue.wait_for(sorting)
    if held or not go:
        feeds.triage(held)   # asks only what the sort beside the call left (its batches past the clock), and hands each batch that lands
    _hand_sorted(held)


def _titles_beside(held, views):
    """Sort the held jobs' titles in a worker while their place call runs -> a Future, or None (nothing held, no AI). Nothing is handed from here: a held job reaches
    scoring only after the place answer (_hand_sorted), so a title the AI likes at a place it then puts outside is never listed on the place words (#3512, "Paris, Texas").
    Why (sa's read of CI run 43020224640 p10, 11 Nov 2026): one place call took 65.3 s (asked 30.4 s, answered 95.7 s) and the titles of its jobs were asked only after it:
    at 116 s "81 title(s) wait for the next one". The price: the titles of jobs the answer puts outside are asked too (counted on the PR)."""
    from . import feed_order, feeds
    from .. import features
    from ..ai import engine
    if not held or features.disabled('title_triage') or not engine.ready():
        return None
    sorting = Future()

    def sort():
        from ..ai import title_triage
        from ..press import stage
        from ..time_budget import best_first
        with stage.guard('titles: beside the place call') as caught, batch_scope.using(views):
            ordered = best_first([job for job in held if job.get('title')])
            nearness = feed_order.nearness(ordered, feeds._SEARCH, feeds.in_my_place)
            feeds._triaged().update(title_triage.decide([job['title'] for job in ordered], feeds._SEARCH, nearness=nearness))
        if caught:   # not sorted beside the call: they are asked after its answer, as before, said
            print(f'Warning: job titles not sorted beside the place call ({reason(caught.error)}): asked after its answer', flush=True)
            detail('sources', caught.error)
        sorting.set_result(None)
    threading.Thread(target=slots.carry(sort), daemon=True, name='titles-beside-place').start()
    return sorting


def _hand_sorted(held):
    """Hand to scoring the held jobs whose title the sort beside the place call said fits and whose place the answer put in your places (title_queue.handing_to)."""
    from . import feed_order, feeds
    land = feed_order.handing(held, feeds.wanted_location)
    if land:
        from ..ai.title_triage import _norm
        land({_norm(job['title']) for job in held if job.get('title') and feeds.judged_title(job['title']) is True}, None)


def to_place(job):
    """A job whose location is worth asking Claude about: its title fits the words, or it is a remote job nobody has placed yet.
    Why (#3674, 10 Nov 2026, sa's check of the Dublin log): a remote job is unknown until placed, and title sorting asks only about jobs in your places, so a remote job whose title
    the role words miss ("Senior Clinical Research Associate" for a nurse) was never asked about either, and would stay unknown for a person who accepts remote too."""
    from . import feeds
    if not ((job.get('location') or '').strip() and job.get('title')):
        return False
    if feeds.wanted_title(job['title']):
        return True
    return feeds.judged_title(job['title']) is not False and feeds.awaiting_place(job)


def place_jobs(jobs, chosen=False, land=False):
    """Ask Claude where the new locations are, for the jobs that could be kept (to_place; `chosen`: these jobs were chosen by it already); each location once per
    version of the places. Off without AI or with JOBADABRA_DISABLE=place_triage: the place words only. land: the final answers inside the person's places
    reach feeds.placed() as each batch lands, not at the end (the search's last pass, src/sources/board_pass.py, lists what came by its deadline)."""
    from .. import features
    from ..ai import engine
    from . import feeds
    pick = (lambda job: True) if chosen else to_place
    locations = [job.get('location') for job in jobs if pick(job)]
    if not locations or features.disabled('place_triage') or not engine.ready():
        return
    _guarded(lambda: _place(jobs, pick, land), lambda why: f'job locations not placed by {providers.who()} ({why}): the place words decide this run (remote jobs wait)')


def _place(jobs, pick, land=False):
    """The place call for the jobs `pick` keeps: the locations nobody placed yet, best first, then which of the ones outside name no town."""
    from . import feeds
    from ..ai import place_triage
    # A refresh places a batch: the ones your place words name first, then the ones most jobs share (7 Oct 2026: it asked in feed
    # order, Warsaw and Dallas first, and "Genève, Switzerland" with 6 jobs waited behind 1,400 others), each job counted by how close
    # it is to your search (src/job_rank.py; 18 Oct 2026: a first search in Cluj placed 1,313 locations for 10 minutes before scoring)
    from ..job_rank import ranker
    from ..press import rank
    closeness, count = ranker(), Counter()
    for job in jobs:
        if pick(job):
            count[place_triage.norm(job['location'])] += 1 + closeness(job)
    ordered = rank.titles(list(count), rank.in_your_places(lambda location: feeds.mentions(feeds.PLACE, location)), lambda location: -count[location])
    # Only what nobody placed yet: a place the map's cache gave (known_now) is never answered again after its jobs were handed (code review of sf place PR a)
    placed = feeds.placed()   # this reader's view, read in its own thread: the batches land from the call's worker threads
    placed.update(place_triage.decide([where for where in ordered if placed.get(where) is None], feeds._SEARCH, **({'land': placed.update} if land else {})))
    placed.update(place_triage.vague(ordered, feeds._SEARCH))   # of the ones outside: which name no town of their own


def _guarded(work, said):
    """work() -> its result; a failure is said (`said(reason)`) and gives None, so a reader goes on with the place words: the one catch of the place steps here.
    Why (code review of sf place PR a): the map read now runs in the reader's thread, and feed_scan calls triage_with_places without a try."""
    try:
        return work()
    except Exception as error:  # noqa: BLE001 — not placed this run: the place words decide, said
        print(f'Warning: {said(reason(error))}', flush=True)
        detail('sources', error)
        return None


def names_own_country(where):
    """True when the text names the country of one of the person's places, from the kept map's answers (src/geo.py): under "Country" the places are often only cities (the drafting prompt leaves country_wide empty),
    so PLACE alone never matched "Remote, Ireland" for a Dublin search (retro review of #3687, Gitar, 10 Nov 2026). A place the map does not know yet adds nothing: the floor stays as it was.
    No cache of its own (a module-level one was refused by tests/guards/rules/test_run_state_only_shrinks.py and keyed on id()): inside a Find jobs run the map is the reader's per-scope copy (geo.load)."""
    from .. import geo
    from ..ai import place_triage
    from . import feeds
    known = geo.load()
    words = place_triage.places_words(feeds._SEARCH)
    names = {geo.country_name((known.get(geo.norm(place)) or {}).get('cc')) for key in ('best_places', 'anywhere_in', 'cities_abroad') for place in words.get(key) or []} - {None}
    return bool(names) and feeds.mentions(feeds.place_regex(sorted(names)), where)
