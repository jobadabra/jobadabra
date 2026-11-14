"""The search's last judging pass over the job boards' jobs: what the AI still owes an answer is placed, then title-judged, before the run's end.
Design (owner, 14 Nov 2026, asked via AskUserQuestion: "Judge in search + show both (Recommended)"; L05: "Yes, stop new reads then (Recommended)"):
- Every board job read before the pass's time (read_budget.pass_at, its one owner) is placed and title-judged in the search; one read after it waits
  for the queue after the search (src/sources/waiting_jobs.py), as before.
- One pass, at the end only: one place round (the locations nobody placed, most-shared first: feed_places' order), then one title round (feeds.triage's
  order, your places nearest first). No order of its own and no gate of its own: the existing owners (place_triage.decide, title_triage.decide) ask,
  under time_budget.to_the_end, so no step's share or reserve stops them, and no AI call starts in the run's last seconds (L04).
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


def judge(jobs):
    """Places, then titles, of the jobs of `jobs` still owed an answer, in this search, by the lane at the pass's time (boards_first.Beside._pass)
    -> Done: the jobs an answer came for (to be kept again by the main thread: aggregators.kept lists the ones both answers say yes to), the
    second it began, how many places and titles it asked, and `why` it asked nothing (None when it ran). Says one plan line and, per board, what
    each round answered, or one `Board pass: not run: <why>` line. Asks nothing once the run has ended (L04). Writes only the shared AI answer
    stores (place_triage, title_triage through feeds): the job cache stays the main thread's (Beside.last_pass)."""
    from .. import time_budget
    from . import feed_places, feeds
    waiting = owed(jobs)
    why = ('the search has no time budget' if time_budget.DEADLINE is None else 'no board job waits for an answer' if not waiting
           else 'the run had ended (its last seconds start no AI call)' if time_budget.ended() else None)
    began = time_budget.BEGAN or time_budget.now()
    at = int(time_budget.now() - began)
    if why:
        print(f'Board pass: not run at {at}s: {why}', flush=True)
        return Done([], at, 0, 0, why)
    # only the places still open: a job the place words put in your places waits for its title alone (job_stage.of)
    unplaced = [job for job in waiting if feeds.place_of(job) is None and not feeds.wanted_location(job) and (job.get('location') or '').strip()]
    places, titles = len({(job.get('location') or '').strip() for job in unplaced}), len({job.get('title') for job in waiting})
    end = time_budget.end() - time_budget.part(time_budget.TAIL)
    print(f"Board pass: at {at}s of {int(end - began)}s: {places} location(s) and {titles} title(s) to ask", flush=True)
    with time_budget.to_the_end():
        feed_places.place_jobs(unplaced, chosen=True)
        titled = [job for job in waiting if job.get('title') and feeds.wanted_location(job)]   # the ones feeds.triage asks about
        feeds.triage(waiting)
    _say(unplaced, titled)
    answered = [job for job in waiting if (feeds.place_of(job) is not None) or feeds.judged_title(job.get('title') or '') is not None]
    return Done(answered, at, places, titles, None)


class Done:
    """What one pass did: `answered` jobs, the second it began (`at`), the places and titles it asked, `why` it asked nothing (None: it ran)."""

    def __init__(self, answered, at, places, titles, why):
        self.answered, self.at, self.places, self.titles, self.why = answered, at, places, titles, why

    def said(self, listed):
        """The main thread's line once it kept them: `Board pass: asked N place(s), M title(s), listed K, at S s` (or not run, and why)."""
        if self.why:
            return f'Board pass: not run: {self.why}'
        return f'Board pass: asked {self.places} place(s), {self.titles} title(s), listed {listed}, at {self.at} s'


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
