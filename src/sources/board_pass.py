"""Standalone board-job judging and accounting; the production search does not call this module yet.
Part 3c prepares the hand-over consumer of judge/listable/settled/Done.report; part 4 starts and connects production work.
The direct judge API uses owed, _titles, _say and the merged clock/answer hooks; _where/_host serve counts.
Why (14 Nov 2026, owner): part 3a isolates judging after part 2's hooks; hand-over and activation stay separate.
"""
from collections import Counter, defaultdict
from urllib.parse import urlparse


class Track:
    """A single publisher assigns (owed jobs, jobs needing placement, start second) to plan; None means no plan was published."""

    def __init__(self):
        self.plan = None


def cut(track):
    """Return a partial Done from the published plan and current answer stores, or None without a plan.
    Why (#4219): counts and answered jobs must come from the same read while answers may still change."""
    if track.plan is None:
        return None
    waiting, unplaced, at = track.plan
    measured = counts(waiting, unplaced)
    return Done(measured['answered'], at, measured['places'], measured['titles'], None, measured['got'], owed=waiting, unplaced=unplaced)


def listable(done):
    """Return answered jobs eligible for a later keep check; vague places still need a posting, regardless of a title yes.
    Why (14 Nov 2026, c15 Valencia): a place naming only a country must not become listable merely because its title was answered."""
    from . import feeds
    return [job for job in done.answered if feeds.place_of(job) != 'vague']


def settled(done, listed):
    """Return owed URLs already listed or definitively refused; an unfinished outside-place answer may still become vague.
    Why (#4219 and #4332): settlement and reports share the full plan, including listed jobs or late refusals absent from answered."""
    return counts(done.owed, done.unplaced, listed, ended=done.got is None)['settled']


def _where(job):
    # Why (#4339): count the same key as the answer store, not each spelling of a place
    from ..ai.place_triage import norm
    return norm(job.get('location'))


def _host(job):
    return urlparse(job.get('url') or '').netloc or '-'


def counts(jobs, unplaced=(), listed=(), ended=False):
    """Return URL-deduplicated totals, per-board counts, answered jobs and settled URLs; read each job's place/title once.
    Places/titles count normalized input keys; per-board counters count jobs covered by those inputs.
    Invariants: owed = listed + refused + waiting; vague places remain unanswered; only ended passes settle an outside place.
    Why (#4311, #4339, 14 Nov 2026): one URL snapshot and the answer stores' normalized keys prevent repeated inputs from inflating summaries."""
    from . import feeds
    unique = {job['url']: job for job in jobs if job.get('url')}
    asking, listed = {job.get('url') for job in unplaced}, set(listed)
    totals, boards, answered, settled_urls = Counter(), defaultdict(Counter), [], []
    places, titles, got_places, got_titles = set(), set(), set(), set()
    for url, job in unique.items():
        place, title = feeds.place_of(job), feeds.judged_title(job.get('title') or '')
        board = boards[_host(job)]
        state = ('listed' if url in listed else 'refused' if title is False or (ended and place == 'out')
                 else 'posting not read' if place == 'vague' else 'no answer by the deadline')
        totals['owed'] += 1
        totals[state] += 1
        if state in ('listed', 'refused'):
            settled_urls.append(url)
        if place in ('best', 'in', 'out') or title is not None:
            answered.append(job)
        where = _where(job) if url in asking else ''
        if where:
            places.add(where)
            board['places asked'] += 1
            board['places ' + ('no answer' if place in (None, 'vague') else 'outside' if place == 'out' else 'inside')] += 1
            if place in ('best', 'in', 'out'):
                got_places.add(where)
        title_key = feeds.title_key(job.get('title'))
        if title_key:
            titles.add(title_key)
            board['titles asked'] += 1
            board['titles ' + ('no answer' if title is None else 'fit' if title else 'not')] += 1
            board['placed outside'] += place == 'out'
            if title is not None:
                got_titles.add(title_key)
    totals['waiting'] = totals['posting not read'] + totals['no answer by the deadline']
    return {**dict.fromkeys(('owed', 'listed', 'refused', 'waiting', 'posting not read', 'no answer by the deadline'), 0), **totals, 'places': len(places), 'titles': len(titles), 'got': (len(got_places), len(got_titles)),
            'boards': boards, 'answered': answered, 'settled': settled_urls}


class Done:
    """Accounting value: owed is the full plan, answered its partial result; got=None means ended, a pair means partial.
    report() formats both summaries and settled URLs from one snapshot; this value starts no work and writes no stores."""

    def __init__(self, answered, at, places, titles, why, got=None, owed=(), unplaced=()):
        self.answered, self.at, self.places, self.titles, self.why, self.got, self.owed = answered, at, places, titles, why, got, list(owed)
        self.unplaced = list(unplaced)

    def report(self, listed):
        """Return settled URLs and both summaries from one counts() snapshot, including URLs already in listed."""
        measured = counts(self.owed, self.unplaced, listed, ended=self.got is None)
        lines = [] if self.why else [
            f"Board pass: owed {measured['owed']} · listed {measured['listed']} · refused {measured['refused']} · waiting {measured['waiting']} "
            f"(posting not read {measured['posting not read']} · no answer by the deadline {measured['no answer by the deadline']})"]
        lines.append(self.said(measured['listed'], measured))
        return measured['settled'], lines

    def said(self, listed, measured=None):
        """Format supplied counts: asked/answered and listed, or why nothing ran; this formatter performs no clock check."""
        if self.why:
            return f'Board pass: not run: {self.why}'
        places, titles = (self.places, self.titles) if measured is None else (measured['places'], measured['titles'])
        got = self.got if measured is None else measured['got']
        if self.got is not None:
            return (f'Board pass: answered {got[0]} of {places} place(s), {got[1]} of {titles} title(s) by the deadline, '
                    f'listed {listed}, at {self.at} s')
        return f'Board pass: asked {places} place(s), {titles} title(s), listed {listed}, at {self.at} s'


def owed(jobs):
    """The jobs of `jobs` the AI still owes an answer for (job_stage 'never_asked'): not listed, and not refused by an answer; each url once.
    Why (#4302, 14 Nov 2026): repeated URLs are owed once, and a definitive title refusal needs no further place or title call."""
    from . import feeds, job_stage
    places, out, seen = {}, [], set()
    for job in jobs:
        if not job.get('url') or job['url'] in seen or feeds.judged_title(job.get('title') or '') is False:
            continue
        if feeds.wanted_title(job.get('title') or '') and feeds.wanted_location(job):
            continue
        if job_stage.of(job, places) == 'never_asked':
            seen.add(job['url'])
            out.append(job)
    return out


def judge(jobs, track=None):
    """Directly judge owed jobs with parallel place/title rounds under the existing search clock; return Done, never write job records.
    Each round uses the existing decision owner and lands partial answers. Both joins spend the same remaining clock; unfinished
    workers leave a partial snapshot. Part 4 connects production startup; this API starts nothing without an explicit caller.
    Why (#4300, #4311, 14 Nov 2026): either held round must release its caller and diagnostics when the shared clock expires."""
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
        return Done([], at, 0, 0, why)
    unplaced = [job for job in waiting if feeds.place_of(job) is None and not feeds.wanted_location(job) and (job.get('location') or '').strip()]
    track.plan = (waiting, unplaced, at)   # Why (#4219): publish the full plan before either round can land an answer
    measured = counts(waiting, unplaced)
    end = time_budget.end() - time_budget.part(time_budget.TAIL)
    print(f"Board pass: at {at}s of {int(end - began)}s: {measured['places']} location(s) and {measured['titles']} title(s) to ask", flush=True)
    said = lambda round_: print(f'Board pass: {round_} answered at {int(time_budget.now() - began)}s', flush=True)
    with time_budget.to_the_end():
        sorting = threading.Thread(target=slots.carry(lambda: (_titles(waiting), said('titles'))), name='boards-pass-titles', daemon=True)
        sorting.start()
        placing = threading.Thread(target=slots.carry(lambda: (feed_places.place_jobs(unplaced, chosen=True, land=True), said('places'))),
                                   name='boards-pass-places', daemon=True)
        placing.start()
        # Why (Gitar on #4300 and #4311; 14 Nov 2026): neither a title nor a place call may hold the pass's diagnostics past the search's clock;
        # either worker still out after its join means a cut pass, so its summary reports partial answers, never completion
        for worker in (sorting, placing):
            worker.join(timeout=max(0.0, end - time_budget.now()))
    # Why (14 Nov 2026): completion observed after the snapshot could label partial answers complete; only workers already ended make it final
    unfinished = sorting.is_alive() or placing.is_alive()
    measured = counts(waiting, unplaced)
    _say(measured)
    got = measured['got'] if unfinished else None
    return Done(measured['answered'], at, measured['places'], measured['titles'], None, got, owed=waiting, unplaced=unplaced)


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
    with stage.guard('board pass titles') as caught:
        store.update(title_triage.decide(titles, feeds._SEARCH, local=[job['title'] for job in waiting if feeds.in_my_place(job)],
                                         land=lambda fit, batch: store.update({title: title in fit for title in batch})))
    if caught:
        print(f'Warning: the board pass did not sort its titles with {providers.who()} ({caught.reason}); remaining titles stay unanswered', flush=True)


def _say(measured):
    """Format per-board job counts from the same snapshot as the input-key totals; compute no counters here."""
    for host, board in measured['boards'].items():
        if board['places asked']:
            print(f"Board pass: {host} places asked {board['places asked']} · inside {board['places inside']} · outside {board['places outside']} · no answer {board['places no answer']}", flush=True)
        if board['titles asked']:
            print(f"Board pass: {host} titles asked {board['titles asked']} · fit {board['titles fit']} · not {board['titles not']} · no answer {board['titles no answer']} · placed outside {board['placed outside']}", flush=True)
