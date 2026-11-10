"""A reader's place call runs beside the hub, not in it (#2920, owner-seen as fewer jobs on a Find jobs press).
Why (7 Nov 2026, #2920, runs 42386229424 vs 42315566393, p10 Amsterdam and p14 Gothenburg): the employer reader placed its new locations (one AI call, 20-21 s) IN the hub thread, which runs the
other readers' hand-overs only while it waits in a title sort: EURES's 200 vacancies sat in the hub's box. The first title ask moved from 57-60 s to 101-124 s and the 2:15 clock allowed 2 title
calls instead of ~8 (titles sorted 108 -> 60 and 185 -> 58). The call now runs in a worker and the hub serves the others' hand-overs while it waits.
Why the reader's own titles still wait for the answers (review of #3512, 7 Nov 2026): `feeds.triage` marks the AI sort as run (feeds.ASKED), after which `wanted_title` stops using the role words, and
`wanted_location` falls back to the place words for a location not placed yet: a sort beside the place call raced that flag (no place call at all on big lists) and handed words-yes, AI-out jobs
("Paris, Texas") to scoring. Since sf's place PR a (10 Nov 2026) only the jobs at the locations the call asks about wait: the others' places are known (kept answers, the
map's cache), so their titles are sorted at once. Why: after #3676 a few remote locations nobody had placed started the call, and p9 Lyon's ~100 employer jobs at known
Lyon places waited 35-80 s behind 4 of them (sa's Mac run; first job 66 s, was 20 s). The race stays closed: the jobs to place are chosen before any sort sets the flag, and
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
        feeds.placed().update(place_triage.known_now([job.get('location') for job in jobs if (job.get('location') or '').strip()], feeds._SEARCH))
    chosen = [job for job in jobs if to_place(job)]   # before any sort below sets feeds.ASKED (the #3512 race)
    asked = {place_triage.norm(job['location']) for job in chosen if feeds.place_of(job) is None}
    placing, views = Future(), batch_scope.current()

    def place():
        try:
            with batch_scope.using(views):   # the reader's own views, as if the call ran in its thread
                place_jobs(chosen, chosen=True)
            placing.set_result(None)
        except BaseException as error:  # noqa: BLE001 — raised in the reader's thread below, where its caller handles it
            placing.set_exception(error)
    threading.Thread(target=slots.carry(place), daemon=True, name='place-call').start()
    held = [job for job in jobs if place_triage.norm(job.get('location') or '') in asked]   # by location: no job at an asked place is sorted on the place words
    go = [job for job in jobs if place_triage.norm(job.get('location') or '') not in asked]
    if go:
        feeds.triage(go)
    title_queue.wait_for(placing)
    if held or not go:
        feeds.triage(held)


def to_place(job):
    """A job whose location is worth asking Claude about: its title fits the words, or it is a remote job nobody has placed yet.
    Why (#3674, 10 Nov 2026, sa's check of the Dublin log): a remote job is unknown until placed, and title sorting asks only about jobs in your places, so a remote job whose title
    the role words miss ("Senior Clinical Research Associate" for a nurse) was never asked about either, and would stay unknown for a person who accepts remote too."""
    from . import feeds
    if not ((job.get('location') or '').strip() and job.get('title')):
        return False
    if feeds.wanted_title(job['title']):
        return True
    return feeds.placing() and feeds.judged_title(job['title']) is not False and feeds.place_of(job) is None and not feeds.wanted_location(job) and feeds.could_be_in_places(job)


def place_jobs(jobs, chosen=False):
    """Ask Claude where the new locations are, for the jobs that could be kept (to_place; `chosen`: these jobs were chosen by it already); each location once per
    version of the places. Off without AI or with JOBADABRA_DISABLE=place_triage: the place words only."""
    from .. import features
    from ..ai import engine
    from . import feeds
    pick = (lambda job: True) if chosen else to_place
    locations = [job.get('location') for job in jobs if pick(job)]
    if not locations or features.disabled('place_triage') or not engine.ready():
        return
    try:
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
        feeds.placed().update(place_triage.decide(ordered, feeds._SEARCH))
        feeds.placed().update(place_triage.vague(ordered, feeds._SEARCH))   # of the ones outside: which name no town of their own
    except Exception as error:  # noqa: BLE001 — not placed this run: the place words decide, said
        print(f'Warning: job locations not placed by {providers.who()} ({reason(error)}): the place words decide this run (remote jobs wait)')
        detail('sources', error)
