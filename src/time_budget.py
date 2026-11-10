"""The Find jobs run's clock under its old name: every function and number of it lives in `src/press/clock.py` (`Clock`, plan 2026-11-07-the-press
4/6, a pure move; header there: owner's words, the one deadline, the floors). This module is that process's one `Clock`: the module namespace IS
the clock's attribute dictionary, so `time_budget.DEADLINE`, `time_budget.over(...)` and a test's `mock.patch.object(time_budget, "_over", ...)`
still reach it, and the clock's own calls (over -> _over) see the patch. A caller that moves to `press.clock` drops its line here.
Still here, not clock: the jobs' order (`best_first`, `near_best`), moving to src/press/rank.py's callers in 5/6."""
import time   # noqa: F401  (tests read time_budget.time.monotonic)

from .press.clock import Calls, Clock   # noqa: F401  (Calls: score and enrich use time_budget.Calls)

CLOCK = Clock.__new__(Clock)
CLOCK.__dict__ = globals()   # Why (ps 4/6, 8 Nov 2026): the ~57 places that patch or set `time_budget.<name>` keep working, and the clock's calls read the patched name
CLOCK.__init__()
for _name, _fn in vars(Clock).items():
    if callable(_fn) and not _name.startswith('__'):
        globals()[_name] = getattr(CLOCK, _name)   # bound: time_budget.over(...) is CLOCK.over(...)
del _name, _fn
STAGES, NOUN, WORDS, SEARCH_AT = Clock.STAGES, Clock.NOUN, Clock.WORDS, Clock.SEARCH_AT


def best_first(jobs):
    """Jobs in your best places first (Search settings "Best places"), then the nearest to them, then the closest to your search (src/job_rank.py:
    your role words, level and skills), the order kept otherwise: a short search spends its time on them.
    Why (#2918, owner 5 Nov 2026: "One clear order first"): a place word cannot tell "Haute-Garonne, France" (Toulouse's own area) from Paris, both
    "in"; geo's stored place answers, or Eurostat's point of a EURES area, can (near_best). A location never placed sorts after the placed ones, as before among themselves."""
    from .paths import load_search_config, place_regex
    from .job_rank import ranker
    from .press import rank
    search = load_search_config()
    tops = (search.get('locations') or {}).get('top_tier') or []
    best = place_regex(tops or [r'(?!x)x'])
    closeness, near = ranker(search), near_best(tops)
    from .sources import feeds
    def in_best_place(job):   # Claude's answer when it placed the location (src/ai/place_triage.py), else the best places' words
        verdict = feeds.place_of(job)
        return verdict == 'best' if verdict is not None else feeds.mentions(best, job.get('location') or '')
    return rank.jobs(jobs, rank.in_your_places(in_best_place), rank.km_to_best_place(lambda job: near(job.get('location'))), rank.role_closeness(closeness))


def near_best(tops):
    """location -> km from it to the nearest of these best places, from geo's stored answers, else Eurostat's point of the EURES area it names
    (src/sources/nuts_points.py); no call here. inf when either has no point (a country, remote, not placed yet), so such a location keeps today's order.
    Why (#3670): EURES areas were placed by AI calls that answered after the run had picked its titles and scores."""
    from . import geo
    from .sources import nuts_points
    data = geo.load()
    points = [entry for entry in (data.get(geo.norm(word)) for word in tops) if entry and 'lat' in entry]

    def km(location):
        entry = data.get(geo.norm(location))
        entry = entry if entry and 'lat' in entry else nuts_points.point(location)
        return min((geo.km(entry, point) for point in points), default=float('inf')) if entry else float('inf')
    return km
