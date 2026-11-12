"""Callers that ask the same small AI question at the same moment share one model call (src/ai/decide.py decide).

Why (12 Nov 2026, owner: "how can we optimize it?" then "Let's do. let's proceed." on "Fewer calls: ask several small questions in one call"):
168 recorded first searches made 48 AI calls each (median); 22 of them were the link-kind question, one call per page read, each paying
the AI program's start-up (116 s a search, summed) and a wait for one of the 4 slots (85 s), while a job board's read waited behind them.
Design: one gate per question (topic, answers, task, the pool that pays, client), open only while a call of it runs. Its states, owned here only:
- a lane is free (fewer than LANES calls of this question are running): the caller asks at once, alone, as before;
- no lane is free: the caller waits in the gate's queue; when a lane's call ends, the first waiting caller takes the lane and asks for
  every caller waiting then, in one call. Nobody waits for a timer, and a caller alone is never delayed.
A caller that waited WAIT_S without a lane leaves unanswered (its items stay unknown this run, as past the call cap).
Invariants: the gates live in a Gates object's own attributes (decide.GATES, part of the Run's `ai`, src/press/run.py), never at module level;
a question with no call running holds nothing: its gate is dropped, so nothing passes from one search to the next.
Tests: tests/unit/ai/test_decide_gate.py."""
import threading

LANES = 2      # calls of one question running at once; the rest of the AI's slots stay free for titles, places and scores
WAIT_S = 90    # a waiting caller leaves unanswered after this (a search's AI window is about 2 minutes)
UNASKED = object()   # the answer of an item no call was made for (the cap, a failure, the wait): unknown this run, asked again next run

class _Caller:
    def __init__(self, pairs):
        self.pairs, self.answers, self.batch, self.woken = pairs, None, None, threading.Event()


class Gates:
    """The questions being asked right now: {question key: {'flying': calls running, 'queue': [callers waiting]}} in `open`."""
    def __init__(self):
        self.lock, self.open = threading.Lock(), {}

    def shared(self, key, pairs, ask, lanes=None, wait=WAIT_S):
        """The answers for `pairs` [(item key, text)], in their order: an answer, None (asked, not answered) or UNASKED.
        ask(pairs) -> such a list for the pairs it is given; it makes the model call(s) and never raises. Each text is asked once per call."""
        me, lanes = _Caller(list(pairs)), lanes or LANES
        with self.lock:
            gate = self.open.setdefault(key, {'flying': 0, 'queue': []})
            if gate['flying'] < lanes:
                gate['flying'] += 1
                me.batch = [me]
            else:
                gate['queue'].append(me)
        if me.batch is None:
            if not me.woken.wait(wait):
                with self.lock:
                    if me in gate['queue']:   # nobody took it: unknown this run
                        gate['queue'].remove(me)
                        return [UNASKED] * len(me.pairs)
                me.woken.wait()   # a lane's caller took it meanwhile: its call is running
            if me.batch is None:
                return me.answers   # another caller asked for this one
        return self._lead(key, gate, me, ask)

    def _lead(self, key, gate, me, ask):
        """Asks once for every caller of the batch, hands each its answers, then gives the lane to the callers that queued meanwhile."""
        batch = me.batch
        try:
            asked = list({text: (item, text) for caller in batch for item, text in caller.pairs}.values())   # one question per wording
            got = dict(zip((text for _, text in asked), ask(asked)))
            for caller in batch:
                caller.answers = [got.get(text, UNASKED) for _, text in caller.pairs]
        finally:
            for caller in batch:
                if caller.answers is None:   # the ask failed in a way it should not: nobody is left waiting
                    caller.answers = [UNASKED] * len(caller.pairs)
                if caller is not me:
                    caller.woken.set()
            with self.lock:
                waiting, gate['queue'][:] = gate['queue'][:], []
                if waiting:
                    waiting[0].batch = waiting   # the first one waiting leads the next call, for all of them
                    waiting[0].woken.set()
                else:
                    gate['flying'] -= 1
                    if not gate['flying']:
                        self.open.pop(key, None)   # no call of this question runs: nothing is kept
        return me.answers
