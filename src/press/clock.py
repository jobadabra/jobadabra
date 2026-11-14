"""A refresh's time budget (owner, 7 Oct 2026: "never more than 2-3 minutes"; a run read 1,650 jobs and sorted 600 titles for 30 minutes).
`start(seconds)` at the top of a run. Each AI step then takes a batch it can finish (`batch`): its share of the time left divided by its own
pace, measured on this computer by earlier refreshes (`record`), best places first (owner: "not a hard cut, a batch that is reasonably small").
What is not in the batch waits for the next refresh, said in the log. `over()` stays as a safety net for a slow day: a step starts no new
call past the deadline (a call already running finishes). No budget (a CLI run, a cloud run, a test): every step takes all it has.
One deadline, wall clock (owner, 26 Oct 2026: "A find jobs session should take at most 3min"; runs with --budget 180 took 12-23 min): every
stage in STAGES shares the run's DEADLINE, set once at start() and never moved; the reads stop at their cut (src/sources/read_budget.py),
the AI steps at their reserve, every floor at the end; a stage past its time only queues its work and says so once (later).
The seconds below are planned for the app's 180 s and scaled to the run's own budget (part). Tests: tests/unit/sources/test_three_minutes.py.
One Find jobs press runs several processes (the job boards' step, then the search, then the scout): each counts from the press (SEARCH_AT, set
by the app, desktop/lib/search-steps.js), not from its own start, so they share one deadline; a step with a share of it ends at its stage
(owner's 06:21 press, 26 Oct 2026: 269 s, the job boards' step 177 s of it with no clock before the search's own 3 minutes).

Moved here from src/time_budget.py (plan 2026-11-07-the-press 4/6, a pure move): `Clock` is the one place a Find jobs run reads its time. The
process has one Clock; src/time_budget.py is its shim (its module namespace IS that Clock's attribute dictionary, so `time_budget.DEADLINE`,
`time_budget.over` and a test's `mock.patch.object(time_budget, ...)` still reach it). The numbers are rows of src/press/budget.json. The
stage table (name, owner file, budget row, runs-beside) is src/press/stages.py. Attribute names are the ones time_budget always had."""
import contextlib
import json
import os
import threading
import time
from datetime import datetime, timezone

from .. import budget_tape
from . import budget, resume


class Calls:
    """The seconds one batch's AI calls took, split by how each ended (thread-safe): `lost` is the share spent on calls that failed.
    Why (#3058, 3 Nov 2026): a pace divided the whole batch's seconds, failed calls included, by the scores that worked ("about 10.8 s each"
    against 3 s on a tester whose key answered 401), and the next batch shrank to 3 of 303."""
    def __init__(self):
        self.worked = self.failed = 0.0
        self._lock = threading.Lock()

    def run(self, call, *args):
        """call(*args), its time counted as worked or failed."""
        began = time.monotonic()
        try:
            result = call(*args)
        except BaseException:
            self._add('failed', time.monotonic() - began)
            raise
        self._add('worked', time.monotonic() - began)
        return result

    def _add(self, kind, seconds):
        with self._lock:
            setattr(self, kind, getattr(self, kind) + seconds)

    @property
    def lost(self):
        total = self.worked + self.failed
        return self.failed / total if total else 0.0


class Clock:
    """One Find jobs run's clock: its deadline and stage end on the monotonic clock, its floors and its batches. `Clock()` counts from the
    press in JOBADABRA_SEARCH_AT (read at each start()); `Clock(search_at=<epoch seconds>)` from that moment (a test with a fixed clock)."""
    SEARCH_AT = 'JOBADABRA_SEARCH_AT'   # epoch seconds of the Find jobs press, the same for each of its processes (desktop/lib/search-steps.js)
    # Every stage that reads or calls the AI after the budget starts (tests/unit/sources/test_three_minutes.py loops over them; a new one goes here and there).
    STAGES = ('web search', 'job boards', 'employer sites', 'free job APIs', 'Google Jobs', 'job-alert emails', 'descriptions', 'places',
              'title sorting', 'scoring', 'job facts', 'kits', 'employer names')
    # Each step's share of the time left when it starts: title sorting least (a backlog that shrinks to a few dozen titles a day), scoring all
    # that remains (it puts jobs in your list with a fit). Default paces (seconds of wall time per item, Claude Code taking 2 calls at a time):
    # measured on the owner's Mac, 7 Oct 2026; replaced by this computer's own after one refresh.
    NOUN = {'place_rounds': 'round(s) of place calls', 'place_vague': 'round(s) of vague-location calls', 'place_reading': 'round(s) of postings read for their place', 'title_rounds': 'round(s) of title calls', 'enrich': 'job(s) to read', 'score': 'job(s) to score', 'job': 'new job(s)'}
    WORDS = {'place_rounds': 'places {n} of {total} job locations', 'place_vague': 'checks {n} of {total} locations for a town', 'place_reading': 'reads {n} of {total} postings for their place', 'title_rounds': 'sorts {n} of {total} job titles', 'enrich': 'reads {n} of {total} new jobs', 'score': 'scores {n} of {total} jobs',
             'job': 'reads and scores {n} of {total} new jobs'}

    def __init__(self, search_at=None):
        self._search_at = search_at
        self.DEADLINE = None
        self.STAGE_END = None   # this process's own end on the search's clock (the job boards' step: its share), before DEADLINE; None: DEADLINE
        self.STARTED = None
        self.BEGAN = None   # when the search started (src/sources/read_budget.py cut_at)
        self.PLANNED = budget.value('time_budget.PLANNED')   # the app's budget, which the seconds below are planned for (part)
        self.RESERVE = budget.group('time_budget.RESERVE')   # seconds kept for the AI steps that come after this one
        self.TAIL = budget.value('time_budget.TAIL')    # no AI call starts this close to the end: one already running finishes by it (Free AI answered in ~15 s, 26 Oct 2026)
        self.SCORING = budget.value('time_budget.SCORING')   # seconds before scoring's own stop where the title floor (LOCAL_TITLES) starts only calls that leave scoring its time (title_room; 26 Oct 2026, a proof
        #                on a copy of the owner's data: the floor's title calls held the board read to 136 s and a search scored only its 3 floor jobs)
        self.SCORE_FIRST = False
        self._end_pass = threading.local()   # this thread runs the search's last judging pass (to_the_end, at_the_end)
        self._said = set()   # the stages that said their time-up line in this search (later)
        self.FLOOR = budget.value('time_budget.FLOOR')     # the first jobs of a search are scored whatever the clock says (owner, 18 Oct 2026: "Yes, always 3"): a new user sees fits in press 1
        self._scored = [0]  # scores started in this search (may_score)
        self.LOCAL_TITLES = budget.value('time_budget.LOCAL_TITLES')  # titles in the user's own places sorted whatever the clock says, like FLOOR for scores (local_titles)
        self._local = [0]
        self.FEED = budget.value('time_budget.FEED')   # local titles a call still sorts in scoring's share while the jobs waiting for a score keep their time: one batch feeds scoring (local_titles)
        self._lock = threading.Lock()
        self.SHARE = budget.group('time_budget.SHARE')
        self.PACE = budget.group('time_budget.PACE')   # job: read and scored, end to end; *_rounds: per round of calls

    def now(self):
        """The monotonic clock, the one every stage reads its seconds from (a stage file never calls time.monotonic itself: tests/guards/rules/test_press_clock_in_one_place.py)."""
        return time.monotonic()

    def wall(self):
        """The wall clock's date and time, UTC (a file's age, a spacing in hours), never a deadline."""
        return datetime.now(timezone.utc)

    def _since_press(self):
        """Seconds since the Find jobs press this process belongs to (SEARCH_AT), 0 without one (a CLI run, a cloud run, a test)."""
        try:
            at = float(self._search_at if self._search_at is not None else os.environ.get(self.SEARCH_AT) or 0)
        except ValueError:
            return 0.0
        return max(0.0, time.time() - at) if at > 0 else 0.0

    def start(self, seconds, now=None, stage=None, name=None):
        """The run's budget: `seconds` from the press (SEARCH_AT) or from now. stage: this process ends at that many of the PLANNED seconds
        (part), a step that has only its share of the press. name: a step that is not a search of its own on a search tape (budget_tape)."""
        self.STARTED = self.BEGAN = (now if now is not None else time.monotonic()) - (self._since_press() if seconds and now is None else 0)
        self.DEADLINE = self.STARTED + seconds if seconds else None
        self.STAGE_END = None
        if seconds and stage:
            self.STAGE_END = min(self.DEADLINE, self.BEGAN + self.part(stage))
        if seconds:
            budget_tape.new_search(name)
        self.score_first(False)
        self._end_pass = threading.local()
        self._said.clear()
        resume.begin()
        self._scored[0] = 0   # a new search: its first FLOOR scores start again whatever the clock
        self._local[0] = 0

    def part(self, seconds):
        """`seconds` of the app's PLANNED budget, in this run's own (a 3-second test run keeps the same parts as the app's 3 minutes)."""
        if self.DEADLINE is None or self.BEGAN is None:
            return seconds
        return seconds * (self.DEADLINE - self.BEGAN) / self.PLANNED

    def end(self):
        """When this process's time is over: its stage's end (STAGE_END) or the run's DEADLINE; None without a budget."""
        return self.STAGE_END if self.STAGE_END is not None else self.DEADLINE

    def ended(self, now=None):
        """The run's time is over: no AI call starts, TAIL before the deadline so a call running ends by it. The floors (FLOOR scores,
        LOCAL_TITLES) beat every step's reserve, never this (26 Oct 2026, a proof run: local-title calls started at 179 s ended the run at 188 s)."""
        return self.DEADLINE is not None and (now if now is not None else time.monotonic()) >= self.end() - self.part(self.TAIL)

    def later(self, stage, n, noun):
        """Every line about work left over starts with "⏱ ": the e2e quality suite refreshes again on that mark (desktop/e2e/lib/quality.mjs workLeft).
        Say once per search that `stage` (one of STAGES) stopped at the run's time and `n` `noun` wait for the next search (the panel shows
        it, desktop/renderer/human-log.js). Returns True, so a stage can `return` on it."""
        if stage not in self._said and n:
            self._said.add(stage)
            resume.note(stage, n)   # the planner's counts (src/press/resume.py), saved as the line is said
            spent = int(time.monotonic() - self.BEGAN) if self.BEGAN is not None else 0
            print(f'⏱ Time is up ({spent // 60} min {spent % 60:02d} s) for {stage}: {n} {noun} {"waits" if n == 1 else "wait"} for the next search', flush=True)
        return True

    def floor_left(self):
        """Scores this search still starts whatever the clock says (FLOOR minus those already started)."""
        return max(0, self.FLOOR - self._scored[0])

    def local_titles(self, wanted):
        """How many of `wanted` titles located in the user's own places are sorted whatever the clock says (and counted): the search's first
        LOCAL_TITLES. 24 Oct 2026, Chisinau: ~750 worldwide-remote titles spent the 3 minutes, and a Moldovan board's titles (the only local jobs)
        were left "for the next refresh" at 158 s."""
        if self.ended():
            return 0
        with self._lock:
            if self._scorings():   # the floor beats the titles' reserve, never the run's end nor scoring's share (SCORING), but while the jobs this search
                # matched keep the time their scores need, one batch a call, or scoring has nothing to take (27 Oct 2026: the quality suite on Free AI,
                # "No time left" for its 10 titles, 0 of 12 postings listed; a benchmark first press left 28 local titles unsorted at 80 s of 135
                # with its one match scored).
                if not self.title_room():
                    return 0
                n = max(0, min(wanted, self.FEED, self.LOCAL_TITLES - self._local[0]))
            else:
                n = max(0, min(wanted, self.LOCAL_TITLES - self._local[0]))
            self._local[0] += n
            return n

    def title_room(self, now=None):
        """False when one more round of title calls would cost the jobs waiting for a score their time, at this computer's paces (_paces); True before scoring's share.
        Asked by each title call as it starts, so several rounds side by side overrun by one round at most.
        Why (5 Nov 2026, #2918, Copenhagen): any waiting job stopped the floor, so one job held back the titles of 200 EURES rows at 82 s of 135: 0 of them listed, and the press
        ended 30 s early. Scoring keeps the time it needs, not all of its share."""
        if not self._scorings(now):
            return True
        from .. import run_counts
        waiting = run_counts.waiting()
        if not waiting:
            return True
        paces = self._paces()
        need = waiting * max(0.5, paces['score']) + max(0.5, paces['title_rounds'])
        return self.DEADLINE - self.reserve('score') - (now if now is not None else time.monotonic()) >= need

    def _scorings(self, now=None):
        """Scoring's own share has begun: SCORING seconds before scoring stops (reserve('score'))."""
        return self.DEADLINE is not None and (now if now is not None else time.monotonic()) >= self.DEADLINE - self.reserve('score') - self.part(self.SCORING)

    def may_score(self, now=None):
        """True when one more job's score may start (and is counted); on a search tape the recorded answer."""
        if now is None:
            return budget_tape.decide('may_score', [], lambda: self._may_score(None))
        return self._may_score(now)

    def _may_score(self, now):
        """One job's score may start now (and is counted): before the deadline, or while the search has started fewer than FLOOR scores.
        18 Oct 2026, the persona rerun: the driver's 33 jobs were listed in press 1 and none scored, the budget spent before scoring began;
        the floor moves those 3 scores from the next search to this one (no new spend)."""
        with self._lock:
            if self._over('score', now) and (not self.floor_left() or self.ended(now)):   # the floor beats scoring's reserve, never the run's end
                return False
            self._scored[0] += 1
            return True

    def score_first(self, on=True):
        """This refresh scores first and reads the facts after (src/daily_search.py): scoring has the budget to its end (minus TAIL) and the reading takes the
        seconds scoring leaves. 10 Oct 2026: scoring took every second and no job ever had its facts: 0 of 103 read. Why no seconds kept for them any more (ts,
        10 Nov 2026, owner asked via AskUserQuestion: "Yes, facts later"): the 25 s kept were read as "0 of 74, Time is up" on every night log, while 71 jobs waited for a score."""
        self.SCORE_FIRST = on

    @contextlib.contextmanager
    def to_the_end(self):
        """For the block, in this thread and the calls it carries (carried), the search's last judging pass (src/sources/board_pass.py): every step's AI
        calls stop at the run's end (TAIL before the deadline, as ended()), and its rounds take all the time left, not a share: no step comes after it
        to keep seconds for. Never past ended(): no AI call starts in the run's last seconds (L04). Other threads keep their reserves and shares.
        Design (owner, 14 Nov 2026, asked via AskUserQuestion: "Judge in search + show both (Recommended)")."""
        before = self.at_the_end()
        self._end_pass.on = True
        try:
            yield
        finally:
            self._end_pass.on = before

    def at_the_end(self):
        """This thread runs the search's last judging pass (to_the_end)."""
        return bool(getattr(self._end_pass, 'on', False))

    def carried(self, fn):
        """`fn` to run in another thread (the title queue's workers, the place pool's) with the calling thread's to_the_end mode.
        Why (Gitar on #4187): a process-wide mode let scoring and the lane's own calls skip their reserves while the pass ran."""
        on = self.at_the_end()

        def run(*args, **kwargs):
            before = self.at_the_end()
            self._end_pass.on = on
            try:
                return fn(*args, **kwargs)
            finally:
                self._end_pass.on = before
        return run

    def reserve(self, step):
        """Seconds before the deadline at which `step` starts no new call (this run's part of them, the TAIL included)."""
        if step == 'titles' and self.scored_beside():
            return self.part(self.TAIL)
        if self.SCORE_FIRST:
            return self.part({'titles': self.RESERVE['titles'], 'enrich': 0}.get(step, 0) + self.TAIL)
        return self.part(self.RESERVE.get(step, 0) + self.TAIL)

    def scored_beside(self):
        """A scorer runs beside this search (src/press/scorer.py): the title sort keeps no seconds for it and plans its rounds on all the time left, to the run's
        end (TAIL); a title batch takes the next free AI slot before a waiting score (src/ai/slots.py TITLES before SCORE), on half the slots (title_triage._workers).
        Why (sa, 11 Nov 2026, CI run 43020224640 p10): the 70 s kept after the titles (RESERVE, 26 Oct) and their fifth of the time (SHARE) date from when
        scoring ran after the sort; since the scorer runs beside it (#3649, #3685) they stopped title calls at 95 s of 180 with AI slots free: 81 local
        titles waited at 116 s, and one batch of 30 that did run took 4.7 s and gave 12 jobs."""
        from . import scorer
        return scorer.shared()

    def over(self, step='score', now=None, key=None):
        """True when `step` must not start another AI call: the run's budget, minus what the later steps keep, is spent. On a search tape the
        answer is the recorded one (src/budget_tape.py): a replay takes the recording's path, not its own clock's. Batches that run side by
        side name themselves with `key` (their first item): the answer is kept per batch, not per call position, which is the threads' arrival order
        (19 Oct 2026, heal proof 6: 18 title questions the recording had skipped as out of time were asked by the replay)."""
        if now is None:
            return budget_tape.decide('over', [step] if key is None else [step, str(key)], lambda: self._over(step, None))
        return self._over(step, now)

    def _stop(self, step):
        """When `step` starts no new call: the run's end minus what the later steps keep (reserve) and the TAIL. One line, drawn here, for over() and for the rounds that fit before it."""
        if self.at_the_end():
            return self.end() - self.part(self.TAIL)
        return min(self.DEADLINE - self.reserve(step), self.end() - self.part(self.TAIL))

    def _over(self, step, now):
        if self.DEADLINE is None:
            return False
        return (now if now is not None else time.monotonic()) >= self._stop(step)

    def _paces(self):
        from ..paths import DATA
        try:
            return {**self.PACE, **json.loads((DATA / 'step_pace.json').read_text())}
        except (OSError, ValueError):
            return dict(self.PACE)

    def batch(self, step, wanted, now=None, say=True):
        """How many of `wanted` items `step` takes in this refresh (see _batch); on a search tape the recorded answer. Returns an int, `wanted` without a budget; no data of its own beyond the clock and this computer's pace file."""
        if now is None:
            return budget_tape.decide('batch', [step, wanted], lambda: self._batch(step, wanted, None, say))
        return self._batch(step, wanted, now, say)

    def _batch(self, step, wanted, now, say):
        """How many of `wanted` items this step takes so the refresh ends on time: its share of the time left, at its measured pace. Says the
        plan in the log when it takes fewer (say=False: a step that tops up with further batches says what is left once, at its end). Without a budget: all of them."""
        if self.DEADLINE is None or wanted <= 0:
            return wanted
        floor = min(wanted, self.floor_left()) if step == 'score' and not self.ended(now) else 0   # never fewer than the search's first scores (may_score)
        stop = self.end()   # a stage's own end comes first; scoring keeps no seconds for the facts (ts, 10 Nov 2026)
        left = stop - (now if now is not None else time.monotonic()) - self.part(self.TAIL)
        pace = max(0.5, self._paces().get(step, self.PACE[step]))
        share = 1.0 if self.at_the_end() or (step == 'title_rounds' and self.scored_beside()) else self.SHARE[step]
        n = max(floor, min(wanted, int(left * share / pace)))
        if not say:
            return n
        if not n:
            print(f'⏱ No time left in this refresh to {self.WORDS[step].split(" ", 1)[0].rstrip("s")} any: {wanted} {self.NOUN[step]} wait for the next one', flush=True)
        elif n < wanted:
            print(f'⏱ This refresh {self.WORDS[step].format(n=n, total=wanted)} (about {round(pace, 1):g} s each, to finish in about '
                  f'{round((self.DEADLINE - self.STARTED) / 60, 1):g} min); {wanted - n} wait for the next refresh, best places and closest jobs first', flush=True)
        return n

    def in_calls(self, step, wanted, size, parallel, now=None, noun='location(s)', stop=None):
        """How many of `wanted` items the step takes in rounds of `parallel` calls of `size`: its share of the time left. `stop`: a step whose stop (over) a first round must end by:
        one round that fits (now + this computer's measured round time <= that stop) is taken whatever the share says."""
        if now is None:
            return budget_tape.decide('in_calls', [step, wanted, size, parallel, *([stop] if stop else [])], lambda: self._in_calls(step, wanted, size, parallel, None, noun, stop))
        return self._in_calls(step, wanted, size, parallel, now, noun, stop)

    def _round_fits(self, stop, step, now):
        """One round of `step`'s calls, started now, ends by `stop`'s stop (over): now + this computer's measured round time (_paces).
        Why (#2920, 7 Nov 2026, p7 Dublin nurse): the share alone refused a round that fitted (20 s at 0.2 of 115 s left, a 25 s round and 51 s to the stop), and 104 titles waited."""
        pace = max(0.5, self._paces().get(step, self.PACE[step]))
        return (now if now is not None else time.monotonic()) + pace <= self._stop(stop)

    def _in_calls(self, step, wanted, size, parallel, now, noun, stop=None):
        """How many of `wanted` items a step that answers `size` items a call, `parallel` calls at once, takes: its share of the time left
        over its measured time per round of calls (7 Oct 2026: placing locations was paced per location, at least 0.5 s each, so a refresh
        asked 32 of 1,500 locations in one call when Haiku answers 60 a call in ~6 s, two at a time)."""
        if self.DEADLINE is None or wanted <= 0:
            return wanted
        per_round = size * max(1, parallel)
        rounds = self._batch(step, -(-wanted // per_round), now, False)
        if stop and not rounds and self._round_fits(stop, step, now):
            rounds = 1
        # No round when its share does not cover one (26 Oct 2026, #2064 measured: a floor of one round per call put a place round in the board
        # loop for each board; scoring started at 116 s instead of 55 s and a search scored 8 jobs instead of 28)
        n = min(wanted, rounds * per_round)
        if not n:
            print(f'⏱ No time left in this refresh for these: {wanted} {noun} wait for the next one', flush=True)
        elif n < wanted:
            print(f'⏱ This refresh {self.WORDS[step].format(n=n, total=wanted)} ({rounds} round(s) of {max(1, parallel)} calls, about '
                  f'{round(max(0.5, self._paces().get(step, self.PACE[step])), 1):g} s each); {wanted - n} wait for the next refresh, best places first', flush=True)
        return n

    def record(self, step, seconds, done, lost=0.0):
        """This computer's pace for `step` (wall seconds per item that worked), smoothed over refreshes, for the next one's batch. `lost`: the
        share of `seconds` spent on calls that failed (Calls.lost); it is not part of a score's pace."""
        if self.DEADLINE is None or done <= 0 or seconds <= 0:   # only a refresh with a budget measures (never a test or a one-off command)
            return
        from ..paths import DATA
        paces = self._paces()
        paces[step] = round(0.5 * paces.get(step, self.PACE[step]) + 0.5 * seconds * (1 - min(1.0, max(0.0, lost))) / done, 2)
        try:
            DATA.mkdir(parents=True, exist_ok=True)
            (DATA / 'step_pace.json').write_text(json.dumps({k: paces[k] for k in self.PACE}))
        except OSError:
            pass

    def left_line(self, step, left, noun='job(s)'):
        """The run's line for work left over: said once per step, so the user knows nothing was dropped."""
        resume.note(resume.LEFT_LINES[step], left)   # said once per step by its caller: the planner's counts (src/press/resume.py)
        return f'⏱ Time is up for this refresh: {left} {noun} left for the next one (it stops at {round((self.DEADLINE - self.STARTED) / 60, 1):g} min)'
