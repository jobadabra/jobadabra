"""Board-pass accounting prepared for the owner's six-part split; the search does not call this module yet.
Part 3 constructs Track/Done, calls counts/cut and consumes listable, settled and Done.report.
Part 4 starts the production pass. _where/_host serve counts; Done.said formats Done.report's snapshot.
Why (14 Nov 2026, owner): split the large judging PR so accounting is reviewed and tested before scheduling is connected.
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
    return (job.get('location') or '').strip()


def _host(job):
    return urlparse(job.get('url') or '').netloc or '-'


def counts(jobs, unplaced=(), listed=(), ended=False):
    """Return URL-deduplicated totals, per-board counts, answered jobs and settled URLs; read each job's place/title once.
    Invariants: owed = listed + refused + waiting; vague places remain unanswered; only ended passes settle an outside place.
    Why (#4311 and owner, 14 Nov 2026): separate summary/per-board counters disagreed on earlier deliveries and repeated URLs."""
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
        if url in asking:
            places.add(_where(job))
            board['places asked'] += 1
            board['places ' + ('no answer' if place in (None, 'vague') else 'outside' if place == 'out' else 'inside')] += 1
            if place in ('best', 'in', 'out'):
                got_places.add(_where(job))
        if job.get('title'):
            titles.add(job['title'])
            board['titles asked'] += 1
            board['titles ' + ('no answer' if title is None else 'fit' if title else 'not')] += 1
            board['placed outside'] += place == 'out'
            if title is not None:
                got_titles.add(job['title'])
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
