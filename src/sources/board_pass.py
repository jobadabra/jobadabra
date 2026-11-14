"""The search's last judging pass over the job boards' jobs: what the AI still owes an answer is placed, then title-judged, before the run's end.
Design (owner, 14 Nov 2026, asked via AskUserQuestion: "Judge in search + show both (Recommended)"; L05: "Yes, stop new reads then (Recommended)"):
- Every board job read before the pass's time (read_budget.pass_at, its one owner) is placed and title-judged in the search; one read after it waits
  for the queue after the search (src/sources/waiting_jobs.py), as before.
- One pass, at the end only: one place round (the locations nobody placed, most-shared first: feed_places' order), then one title round (feeds.triage's
  order, your places nearest first). No order of its own and no gate of its own: the existing owners (place_triage.decide, title_triage.decide) ask,
  under time_budget.to_the_end, so no step's share or reserve stops them, and no AI call starts in the run's last seconds (L04).
- Run by the run's last hand-over (boards_first.Beside.last_pass, from daily_search.keep_late_boards), in the thread that owns the job cache.
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


def judge(jobs):
    """Places, then titles, of the jobs of `jobs` still owed an answer, in this search -> those an answer came for, to be kept again (aggregators.kept
    lists the ones both answers say yes to). Says one plan line and, per board, what each round answered. Asks nothing once the run has ended."""
    from .. import time_budget
    from . import feed_places, feeds
    waiting = owed(jobs)
    if not waiting or time_budget.ended():
        return []
    # only the places still open: a job the place words put in your places waits for its title alone (job_stage.of)
    unplaced = [job for job in waiting if feeds.place_of(job) is None and not feeds.wanted_location(job) and (job.get('location') or '').strip()]
    began, end = time_budget.BEGAN or time_budget.now(), time_budget.end() - time_budget.part(time_budget.TAIL)
    print(f"Board pass: at {int(time_budget.now() - began)}s of {int(end - began)}s: {len({(job.get('location') or '').strip() for job in unplaced})} "
          f"location(s) and {len({job.get('title') for job in waiting})} title(s) to ask", flush=True)
    with time_budget.to_the_end():
        feed_places.place_jobs(unplaced, chosen=True)
        titled = [job for job in waiting if job.get('title') and feeds.wanted_location(job)]   # the ones feeds.triage asks about
        feeds.triage(waiting)
    _say(unplaced, titled)
    return [job for job in waiting if (feeds.place_of(job) is not None) or feeds.judged_title(job.get('title') or '') is not None]


def _host(job):
    return urlparse(job.get('url') or '').netloc or '-'


def _say(unplaced, titled):
    """Per board: `Board pass: <host> places asked n · inside i · outside o · no answer u`, then the titles' line (tools/persona-search reads them)."""
    from . import feeds
    places, titles = defaultdict(Counter), defaultdict(Counter)
    for job in unplaced:
        verdict = feeds.place_of(job)
        places[_host(job)][('no answer' if verdict is None else 'outside' if verdict == 'out' else 'inside')] += 1
    for job in titled:
        verdict = feeds.judged_title(job.get('title') or '')
        titles[_host(job)][('no answer' if verdict is None else 'fit' if verdict else 'not')] += 1
    for host, counts in places.items():
        print(f"Board pass: {host} places asked {sum(counts.values())} · inside {counts['inside']} · outside {counts['outside']} · no answer {counts['no answer']}", flush=True)
    for host, counts in titles.items():
        print(f"Board pass: {host} titles asked {sum(counts.values())} · fit {counts['fit']} · not {counts['not']} · no answer {counts['no answer']}", flush=True)
