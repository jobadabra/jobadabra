"""Job locations a search met and did not ask about, asked after it: the scoring queue the app starts when a Find jobs run ends places them
(src/daily_modes.py score_mode), the map and the place store keep each answer for good, and the next search knows those towns with no AI call.

Design (12 Nov 2026, owner, asked via AskUserQuestion: "Ask places after the search, like scoring (Recommended)"):
- A location has three states for a search: placed (the place store or the map holds it), waiting here, or never met.
- One owner of the answer, as before: src/ai/place_triage.py decide (the map first, then the AI). This file only keeps the list of what to ask.
- Only readers that searched for the person's place note locations (a job board, the web search, alerts, visits): what they list one town over is the gap.
- Nothing here runs inside the search's 3 minutes except writing one small file: no AI call, no wait.
Why not inside the search (3 tries, 12 Nov 2026, test person 9, 3 searches a side each): asked of every reader, the employer sites' locations from the whole
world filled the AI (535-600 titles, place answers 15-28 s for 3-7 s); asked of the boards only, their jobs waited for the place answer and missed the
title stop (the two best boards: 0 of 60 and 0 of 31 jobs judged, for 29-33 on main 6 times of 6).
Why at all (test person 9, area "lyon"): one board searched for the city listed 80 jobs, 24 naming Lyon and 56 in its neighbouring towns; over 20
searches all 614 listed jobs named the city, none a neighbouring town.
"""
import json

from ..paths import DATA

STORE = DATA / 'places_later.json'
KEPT = 300    # locations kept waiting per search, the ones most jobs share first
ASKED = 120   # locations one queue run asks at most (4 calls of 30, src/ai/place_triage.py BATCH)


def _load():
    try:
        data = json.loads(STORE.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(data):
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(data, ensure_ascii=False))


def note(jobs):
    """Remembers the locations of these jobs that nobody has placed and the place words do not hold: counted per location, for this search's places only.
    Asks nothing, and a failure never reaches the reader (counted by stage.guard): a list of what to ask later is not worth a lost read."""
    from ..ai import place_triage
    from ..press import stage
    from . import feeds
    with stage.guard('places noted for later') as caught:
        if not feeds.placing():
            return 0
        met = {}
        for job in jobs:
            where = place_triage.norm(job.get('location'))
            if where and job.get('title') and feeds.place_of(job) is None and not feeds.wanted_location(job) and feeds.judged_title(job['title']) is not False:
                met[where] = met.get(where, 0) + 1
        if met:
            key = place_triage._key(feeds._SEARCH)
            with place_triage.LOCK:   # the place store's own lock: one writer of the place files at a time
                held = (_load().get(key) or {})   # only this version of the places: a change of places starts a new list
                for where, n in met.items():
                    held[where] = held.get(where, 0) + n
                _write({key: dict(sorted(held.items(), key=lambda item: -item[1])[:KEPT])})
        return len(met)
    print(f'Warning: locations to ask about later were not noted ({caught.reason})', flush=True)
    return 0


def waiting(search):
    """The locations waiting for these places, the ones most jobs share first."""
    from ..ai import place_triage
    held = _load().get(place_triage._key(search)) or {}
    return [where for where, _ in sorted(held.items(), key=lambda item: -item[1])]


def ask(search, out=print):
    """Asks where the waiting locations are (place_triage.decide: the map, then the AI; answers kept) and takes the answered ones off the list.
    -> (asked, in the person's places). A location the call left unanswered (no AI, a spent limit, its own clock) stays waiting: never guessed."""
    from ..ai import place_triage
    todo = waiting(search)[:ASKED]
    if not todo:
        return 0, 0
    known = place_triage.decide(todo, search)
    done = [where for where in todo if where in known]
    inside = sum(1 for where in done if known[where] in ('best', 'in'))
    key = place_triage._key(search)
    with place_triage.LOCK:
        left = {where: n for where, n in (_load().get(key) or {}).items() if where not in known}
        _write({key: left} if left else {})
    if done:
        out(f"Places: asked where {len(done)} location(s) from your last search are; {inside} are in your places (their jobs are listed from the next search)")
    return len(done), inside
