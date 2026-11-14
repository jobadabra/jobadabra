"""The search's last judging pass over the job boards' jobs: what the AI still owes an answer is placed, then title-judged, before the run's end.
Design (owner, 14 Nov 2026, asked via AskUserQuestion: "Judge in search + show both (Recommended)"; L05: "Yes, stop new reads then (Recommended)"):
- Every board job read before the pass's time (read_budget.pass_at, its one owner) is placed and title-judged in the search; one read after it waits
  for the queue after the search (src/sources/waiting_jobs.py), as before.
- One pass, at the end only: one place round (the locations nobody placed, most-shared first: feed_places' order) and, beside it, one title round
  of every owed job (your places' titles first). No order of its own and no gate of its own: the existing owners (place_triage.decide,
  title_triage.decide) ask, under time_budget.to_the_end, so no step's share or reserve stops them, and no AI call starts in the run's last seconds (L04).
  Each batch's answers reach the shared stores as it lands; a pass still out at the deadline lists what they cover (cut), the rest waits for the queue.
  Why (#4199 try 3, pair 43604153744, d05): map, place and title rounds one after the other did not fit the pass's ~16 s, and a cut pass kept nothing.
  The cost: a title is asked for a job the place round then puts outside (`placed outside` on the per-board line).
- Asked by the boards' lane in a thread of its own at the pass's time (boards_first.Beside._pass), which writes only the shared AI answer stores;
  the job cache stays the main thread's: its last hand-over (Beside.last_pass, from daily_search.keep_late_boards) keeps them again, whenever
  scoring lets it come, with no AI call of its own.
  Why (#4187 try 2, pair 43601353056): run by that hand-over, the pass ran on no side: scoring held the main thread to 161-174 s, past the run's end.
- Says what it did (`Board pass: asked N place(s), M title(s), listed K, at S s`) or that it did not run and why, so a pair never reads as a
  result when nothing ran.
Why (14 Nov 2026, 12 CI searches of the GTM 6 profiles): 486 board jobs with a place text were read and never asked; 0 place passes ran in 7 of 12.
A pass per group would put place rounds in the boards' loop (12 Nov 2026, places_later: the board read then missed the titles' stop).
Tests: tests/unit/sources/test_board_pass.py."""
from collections import Counter, defaultdict
from urllib.parse import urlparse


def owed(jobs):
    """The jobs of `jobs` the AI still owes an answer for (job_stage 'never_asked'): not listed, and not refused by an answer."""
    from . import feeds, job_stage
    places, out = {}, []
    for job in jobs:
        if not job.get('url') or (feeds.wanted_title(job.get('title') or '') and feeds.wanted_location(job)):
            continue
        if job_stage.of(job, places) == 'never_asked':
            out.append(job)
    return out


class Track:
    """What a pass set out to ask, filled as it starts (judge), so the last hand-over lists what was answered by the deadline when the pass is
    still out (cut). Written by the lane's pass thread once, before its first AI call; read by the main thread after it."""

    def __init__(self):
        self.plan, self.why = None, None   # plan: (owed jobs, the ones whose place is asked, the second it began), set in one assignment


def judge(jobs, track=None):
    """Places and titles, side by side, of the jobs of `jobs` still owed an answer, in this search, by the lane at the pass's time
    (boards_first.Beside._pass) -> Done: the jobs an answer came for (to be kept again by the main thread: aggregators.kept lists the ones both
    answers say yes to), the second it began, how many places and titles it asked, and `why` it asked nothing (None when it ran). Says one plan
    line, each round's second as it ends, and per board what each round answered; or one `Board pass: not run: <why>` line. Asks nothing once
    the run has ended (L04). Writes only the shared AI answer stores (place_triage, title_triage), each answer as its batch lands: the job cache
    stays the main thread's (Beside.last_pass). `track` (Track): filled before the first call, for cut().
    Why side by side (#4199 try 3, pair 43604153744, d05): the map, place and title rounds ran one after the other in ~16 s; nothing came by the deadline."""
    import threading
    from .. import time_budget
    from ..ai import slots
    from . import feed_places, feeds
    track = track if track is not None else Track()
    waiting = owed(jobs)
    why = ('the search has no time budget' if time_budget.DEADLINE is None else 'no board job waits for an answer' if not waiting
           else 'the run had ended (its last seconds start no AI call)' if time_budget.ended() else None)
    began = time_budget.BEGAN or time_budget.now()
    at = int(time_budget.now() - began)
    if why:
        print(f'Board pass: not run at {at}s: {why}', flush=True)
        track.why = why
        return Done([], at, 0, 0, why)
    # only the places still open: a job the place words put in your places waits for its title alone (job_stage.of)
    unplaced = [job for job in waiting if feeds.place_of(job) is None and not feeds.wanted_location(job) and (job.get('location') or '').strip()]
    track.plan = (waiting, unplaced, at)   # one assignment: the main thread reads all three or none (Gitar on #4219)
    places, titles = _counts(waiting, unplaced)
    end = time_budget.end() - time_budget.part(time_budget.TAIL)
    print(f"Board pass: at {at}s of {int(end - began)}s: {places} location(s) and {titles} title(s) to ask", flush=True)
    said = lambda round_: print(f'Board pass: {round_} answered at {int(time_budget.now() - began)}s', flush=True)
    with time_budget.to_the_end():
        sorting = threading.Thread(target=slots.carry(lambda: (_titles(waiting), said('titles'))), name='boards-pass-titles', daemon=True)
        sorting.start()
        feed_places.place_jobs(unplaced, chosen=True, land=True)
        said('places')
        sorting.join()
    _say(unplaced, [job for job in waiting if job.get('title')])
    return Done([job for job, place, title in _answers(waiting) if place or title is not None], at, places, titles, None)


def cut(track):
    """The pass still out at the deadline -> Done with what its answers cover now (Beside.last_pass), or None when it had not begun.
    Each job's answers are read once and the counts come from that one read (Gitar on #4219: the pass's threads are still writing)."""
    if track.plan is None or track.why:
        return None
    waiting, unplaced, at = track.plan
    places, titles = _counts(waiting, unplaced)
    answers = _answers(waiting)
    asked = {id(job) for job in unplaced}
    got = (len({_where(job) for job, place, _ in answers if place and id(job) in asked}), len({job.get('title') for job, _, title in answers if title is not None}))
    return Done([job for job, place, title in answers if place or title is not None], at, places, titles, None, got)


def listable(done):
    """The jobs of `done.answered` the last hand-over may keep again: never one whose place names no town and whose posting is not read yet
    ('vague': feeds.wanted_location keeps it open until then); it waits for the queue, which reads its posting.
    Why (xc, 14 Nov 2026, ot's c15 Valencia pair on 01870a59): the pass listed 28 more jobs, 0 right by the blind judge; all 28 said only "Spain"."""
    from . import feeds
    return [job for job in done.answered if feeds.place_of(job) != 'vague']


def settled(done, listed):
    """The urls of `done.answered` the queue owes nothing (their waiting rows leave, waiting_jobs.listed): listed (`listed`: their urls), or
    refused by an answer: a title the AI said no to, or a place outside when the pass ended (a cut pass's "out" may still turn "vague",
    a posting to read, in the vague-location round). Why (Gitar on #4219): a row left for any answer, though its job was never listed."""
    from . import feeds
    return [job['url'] for job in done.answered if job.get('url') in listed or feeds.judged_title(job.get('title') or '') is False
            or (done.got is None and feeds.place_of(job) == 'out')]


def _titles(waiting):
    """The title round of the pass: every owed job's title, whatever its place (the place round runs beside it), your places' titles first.
    Each batch's answers reach the shared title store as it lands (title_triage's land), so a cut pass keeps them."""
    from .. import features
    from ..ai import engine, providers, title_triage
    from ..press import stage
    from . import feeds
    titles = [job['title'] for job in waiting if job.get('title')]
    if not titles or features.disabled('title_triage') or not engine.ready():
        return
    store = feeds._triaged()   # read in this thread: the batches land in title_triage's own
    store[feeds.ASKED] = True
    with stage.guard('board pass titles') as caught:   # not sorted in the search: the queue after it asks them, said and counted
        store.update(title_triage.decide(titles, feeds._SEARCH, local=[job['title'] for job in waiting if feeds.in_my_place(job)],
                                         land=lambda fit, batch: store.update({title: title in fit for title in batch})))
    if caught:
        print(f'Warning: the board pass did not sort its titles with {providers.who()} ({caught.reason}): the queue after the search asks them', flush=True)


def _where(job):
    return (job.get('location') or '').strip()


def _answers(waiting):
    """[(job, placed, title answer)] read once each: placed is True only for best/in/out ('vague' is a posting not read yet: no answer)."""
    from . import feeds
    return [(job, feeds.place_of(job) in ('best', 'in', 'out'), feeds.judged_title(job.get('title') or '')) for job in waiting]


def _counts(waiting, unplaced):
    return len({_where(job) for job in unplaced}), len({job.get('title') for job in waiting})


class Done:
    """What one pass did: `answered` jobs, the second it began (`at`), the places and titles it asked, `why` it asked nothing (None: it ran),
    and `got`: (places, titles) answered by the deadline when it was cut (None: it ended)."""

    def __init__(self, answered, at, places, titles, why, got=None):
        self.answered, self.at, self.places, self.titles, self.why, self.got = answered, at, places, titles, why, got

    def said(self, listed):
        """The main thread's line once it kept them: `Board pass: asked N place(s), M title(s), listed K, at S s`, or for a cut pass
        `Board pass: answered n of N place(s), m of M title(s) by the deadline, listed K, at S s` (or not run, and why)."""
        if self.why:
            return f'Board pass: not run: {self.why}'
        if self.got is not None:
            return (f'Board pass: answered {self.got[0]} of {self.places} place(s), {self.got[1]} of {self.titles} title(s) by the deadline, '
                    f'listed {listed}, at {self.at} s')
        return f'Board pass: asked {self.places} place(s), {self.titles} title(s), listed {listed}, at {self.at} s'


def _host(job):
    return urlparse(job.get('url') or '').netloc or '-'


def _say(unplaced, titled):
    """Per board: `Board pass: <host> places asked n · inside i · outside o · no answer u`, then the titles' line (read by [xb] 2/2's card and funnel lines; nothing reads them before it)."""
    from . import feeds
    places, titles = defaultdict(Counter), defaultdict(Counter)
    for job in unplaced:
        verdict = feeds.place_of(job)
        places[_host(job)][('no answer' if verdict in (None, 'vague') else 'outside' if verdict == 'out' else 'inside')] += 1   # vague: its posting not read (listable)
    for job in titled:
        verdict = feeds.judged_title(job.get('title') or '')
        titles[_host(job)][('no answer' if verdict is None else 'fit' if verdict else 'not')] += 1
        titles[_host(job)]['placed outside'] += feeds.place_of(job) == 'out'   # asked beside the place round: the cost of side by side
    for host, counts in places.items():
        print(f"Board pass: {host} places asked {sum(counts.values())} · inside {counts['inside']} · outside {counts['outside']} · no answer {counts['no answer']}", flush=True)
    for host, counts in titles.items():
        asked = counts['fit'] + counts['not'] + counts['no answer']
        print(f"Board pass: {host} titles asked {asked} · fit {counts['fit']} · not {counts['not']} · no answer {counts['no answer']} · placed outside {counts['placed outside']}", flush=True)
