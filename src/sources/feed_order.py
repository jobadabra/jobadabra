"""The two keys the title sort gets from feeds.triage (#2918): how near each title's job is, for the one queue's order (src/ai/title_queue.py), and where the jobs of
a landed batch go (scoring, as the batch lands). Moved out of feeds.py for the 500-line rule; both take what they need from it, so this file imports nothing of it."""


class _Nearness:
    """One reader's title jobs; initial sorting uses one map snapshot, waiting batch ranks take a fresh snapshot."""

    def __init__(self, asked, search, in_my_place):
        from ..time_budget import near_best
        from ..ai.title_triage import _norm
        self.tops = (search.get('locations') or {}).get('top_tier') or []
        self.in_my_place, self.by_title = in_my_place, {}
        self.stamp = self._store_stamp()
        self.current = near_best(self.tops)
        for job in asked:
            self.by_title.setdefault(_norm(job['title']), []).append(job)

    def _key(self, title, near):
        return min(((0 if self.in_my_place(job) else 1, near(job.get('location'))) for job in self.by_title.get(title, ())), default=(1, float('inf')))

    def __call__(self, title):
        return self._key(title, self.current)

    @staticmethod
    def _store_stamp():
        from .. import geo
        try:
            saved = geo.STORE.stat()
            return (saved.st_mtime_ns, saved.st_size, saved.st_ino)
        except OSError:
            return None

    def rank(self, titles):
        """Rank waiting titles from current geographic facts; parse the map again only when its file changed, with no model call."""
        from ..time_budget import near_best
        # Why (7 Nov 2026, #2920): outside reader scopes geo.load parses a fresh dict; cache unchanged files while scoped map views still update in place.
        stamp = self._store_stamp()
        if stamp != self.stamp:
            self.current, self.stamp = near_best(self.tops), stamp
        return min(self._key(title, self.current) for title in titles)


def nearness(asked, search, in_my_place):
    """Callable title priority for initial sorting, with rank(titles) for refreshing waiting batches from current geographic facts."""
    return _Nearness(asked, search, in_my_place)


def handing(asked, wanted_location):
    """The land(fit titles, batch) of a reader that hands its jobs to scoring as each batch of titles lands (title_queue.handing_to), else None: its jobs whose title the
    AI says fits and that are in one of your places, as they are read (the reader's final pass after the whole sort takes them as they are)."""
    from ..ai import title_queue
    from ..ai.title_triage import _norm
    hand = title_queue.handing()
    if hand is None:
        return None
    by_title = {}
    for job in asked:
        by_title.setdefault(_norm(job['title']), []).append(job)

    def land(fit, batch):
        hand([job for title in fit for job in by_title.get(title, ()) if wanted_location(job)])
    return land
