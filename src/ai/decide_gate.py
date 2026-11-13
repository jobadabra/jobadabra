"""Callers that ask the same small AI question at the same moment share its model calls (src/ai/decide.py decide), one batch of wordings a call.

Why (12 Nov 2026, owner: "how can we optimize it?" then "Let's do. let's proceed." on "Fewer calls: ask several small questions in one call"):
168 recorded first searches made 48 AI calls each (median); 22 of them were the link-kind question, one call per page read, each paying
the AI program's start-up (116 s a search, summed) and a wait for one of the 4 slots (85 s), while a job board's read waited behind them.
Why one batch a call (13 Nov 2026, owner "yes" to sa's "find out why link-finding takes 80 s on those three Madrid boards and fix that cause"):
the first gate handed every waiting caller's wordings to ONE ask, which made its 50-wording calls one after another; on c04 (run 43473395249)
Infoempleo, Trabajos.com and Infojobs queued behind two pages, their 145 + 300 + 57 wordings became 11 calls in a row, and all three got their
links at 96 s ("job links 82 s / 80 s / 82 s"), too late for their 60 jobs to be checked.
Design: one gate per question (topic, answers, task, the pool that pays, client), open only while a caller of it waits. Its states, owned here only:
- each caller's wordings are untaken (no call has them yet), asking (in a call now) or answered; a caller leaves the moment its own are answered;
- a lane is a call of this question running; at most LANES at once. A waiting caller with a free lane takes it and asks the next batch: up to
  `size` untaken wordings, the caller with the fewest untaken first (then the earliest), topped up from the next; a wording asked once
  answers every caller that has it. So a page alone asks at once, as before; a big page's batches use both lanes; nobody waits for a timer.
A caller whose wordings no call took within WAIT_S leaves with those unanswered (unknown this run, as past the call cap).
Invariants: the gates live in a Gates object's own attributes (decide.GATES, part of the Run's `ai`, src/press/run.py), never at module level;
a question no caller waits for holds nothing: its gate is dropped, so nothing passes from one search to the next; ask() is given at most `size` pairs.
Tests: tests/unit/ai/test_decide_gate.py."""
import threading
import time

LANES = 2      # calls of one question running at once; the rest of the AI's slots stay free for titles, places and scores
WAIT_S = 90    # a caller leaves with what no call took after this (a search's AI window is about 2 minutes)
SIZE = 50      # wordings a call (decide.BATCH passes its own)
UNASKED = object()   # the answer of an item no call was made for (the cap, a failure, the wait): unknown this run, asked again next run


class _Caller:
    """One decide() caller: its (item, text) pairs, its distinct texts no call took yet (`untaken`, as pairs), the ones still unanswered (`need`)."""
    def __init__(self, pairs, asking):
        self.pairs, self.got = pairs, {}
        unique = list({text: (item, text) for item, text in pairs}.values())
        self.need = {text for _, text in unique}
        self.untaken = [pair for pair in unique if pair[1] not in asking]   # never asked twice: the running call answers it

    def answers(self):
        return [self.got.get(text, UNASKED) for _, text in self.pairs]


class Gates:
    """The questions being asked right now: {question key: {'lanes': calls running, 'callers': [callers waiting, by arrival], 'asking': {texts}}} in `open`."""
    def __init__(self):
        self.lock = threading.Condition()
        self.open = {}

    def shared(self, key, pairs, ask, lanes=None, wait=WAIT_S, size=SIZE):
        """The answers for `pairs` [(item key, text)], in their order: an answer, None (asked, not answered) or UNASKED.
        ask(pairs) -> such a list for the at most `size` pairs it is given; it makes the model call and never raises. Each text is asked once per call."""
        lanes, until = lanes or LANES, time.monotonic() + wait
        with self.lock:
            gate = self.open.setdefault(key, {'lanes': 0, 'callers': [], 'asking': set()})
            me = _Caller(list(pairs), gate['asking'])
            gate['callers'].append(me)
            try:
                while me.need:
                    if gate['lanes'] < lanes and any(caller.untaken for caller in gate['callers']):
                        self._call(gate, ask, size)
                        continue
                    left = until - time.monotonic()
                    if left <= 0 and me.untaken:   # no call took these in time: unknown this run
                        self._settle(gate, {text: UNASKED for _, text in me.untaken}, me)
                        continue
                    self.lock.wait(left if me.untaken else None)
            finally:
                if me in gate['callers']:   # an ask that raised: this caller leaves anyway, so nobody asks for it
                    gate['callers'].remove(me)
                if not gate['lanes'] and not gate['callers']:
                    self.open.pop(key, None)   # no caller of this question waits: nothing is kept
        return me.answers()

    def _call(self, gate, ask, size):
        """Takes a lane and asks one batch (the lock is let go during the call); the answers reach every caller that has those texts."""
        batch, texts = [], set()
        for caller in sorted((c for c in gate['callers'] if c.untaken), key=lambda c: len(c.untaken)):   # fewest first, so a small board never waits for a big one's batches
            for item, text in caller.untaken:
                if len(batch) < size and text not in texts:
                    texts.add(text)
                    batch.append((item, text))
        for caller in gate['callers']:
            caller.untaken = [pair for pair in caller.untaken if pair[1] not in texts]
        gate['lanes'] += 1
        gate['asking'] |= texts
        got = []
        self.lock.release()
        try:
            got = list(ask(batch))
        finally:
            self.lock.acquire()
            gate['lanes'] -= 1
            gate['asking'] -= texts
            answers = dict(zip((text for _, text in batch), got))
            self._settle(gate, {text: answers.get(text, UNASKED) for text in texts})   # a failed ask leaves nobody waiting: unknown
            self.lock.notify_all()

    @staticmethod
    def _settle(gate, answers, only=None):
        """Hands `answers` {text: answer} to the callers that need them (all, or `only`); a caller with nothing left to wait for leaves the gate."""
        for caller in list(gate['callers']):
            if only is not None and caller is not only:
                continue
            for text in caller.need & answers.keys():
                caller.got[text] = answers[text]
            caller.need -= answers.keys()
            caller.untaken = [pair for pair in caller.untaken if pair[1] not in answers]
            if not caller.need:
                gate['callers'].remove(caller)
