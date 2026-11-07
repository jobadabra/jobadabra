"""The two keys the title sort gets from feeds.triage (#2918): how near each title's job is, for the one queue's order (src/ai/title_queue.py), and where the jobs of
a landed batch go (scoring, as the batch lands). Moved out of feeds.py for the 500-line rule; both take what they need from it, so this file imports nothing of it."""


def nearness(asked, search, in_my_place):
    """title -> (0 in your places else 1, km from the job's place to your nearest best place): the key the one title queue orders batches by; a title several jobs
    share takes its nearest job's. Geo's kept answers only, no call; a place never placed is last (time_budget.near_best)."""
    from ..time_budget import near_best
    from ..ai.title_triage import _norm
    near = near_best((search.get('locations') or {}).get('top_tier') or [])
    by_title = {}
    for job in asked:
        by_title.setdefault(_norm(job['title']), []).append(job)

    def key(title):
        # Why (7 Nov 2026, #2920): the map may learn a reader's locations after its jobs reach sorting; the reader's shared map view updates in place, so recompute distance without rereading the map per title.
        return min(((0 if in_my_place(job) else 1, near(job.get('location'))) for job in by_title.get(title, ())), default=(1, float('inf')))
    return key


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
