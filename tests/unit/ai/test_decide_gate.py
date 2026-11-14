"""Callers asking the same small AI question at the same moment share one model call (src/ai/decide_gate.py, wired in src/ai/decide.py).
Why (owner, 12 Nov 2026: "how can we optimize it?", "Let's do. let's proceed."): 168 recorded first searches made 48 AI calls each; 22 were the
link-kind question, one call per page read. Offline: a fake model that holds its answer until the test lets it go; temp stores."""
import json
import pathlib
import sqlite3
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest import mock

from src.ai import decide, decide_gate

ANSWERS = ('job_list', 'other')


class Model:
    """Answers 'job_list' for every item; each call waits for `go` and records the wordings it was sent."""
    def __init__(self, fail=False):
        self.calls, self.go, self.started, self.fail = [], threading.Event(), threading.Semaphore(0), fail
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kw):
        text = kw['messages'][0]['content']
        wordings = [part.split('\n', 1)[1].strip() for part in text.split('### Item ')[1:]]
        self.calls.append(wordings)
        self.started.release()
        assert self.go.wait(10), 'the test never let the model answer'
        if self.fail:
            raise RuntimeError('the model is down')
        body = json.dumps({str(n): 'job_list' for n in range(len(wordings))})
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=body)], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class SharedCalls(unittest.TestCase):
    """Temp stores, no pack, the real gate; LANES lanes. The helpers only: the tests are in the classes below."""
    LANES = 1

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        for patch in (mock.patch.object(decide, '_db', lambda: sqlite3.connect(self.tmp / 'd.sqlite')), mock.patch.object(decide.cost, 'side'),
                      mock.patch.object(decide.engine, 'structured', lambda *a, **k: {}), mock.patch('src.ai.meanings_pack.queue'), mock.patch.object(decide_gate, 'LANES', self.LANES),
                      mock.patch('src.ai.meanings_pack.first', return_value=None), mock.patch('src.ai.meanings_pack.ai_first', return_value=True)):
            patch.start()
            self.addCleanup(patch.stop)
        decide.reset_run()
        self.addCleanup(decide.reset_run)
        self.assertEqual(decide.GATES.open, {}, 'positive control: no question is being asked when a test starts')

    def ask(self, model, page, out):
        out[page] = decide.decide('link-kind', {f'{page} link {n}': f'{page} link {n}' for n in range(2)}, ANSWERS, 'what a link is', client=model, floor=False)

    def pages(self, model, names, lanes=1):
        """One thread a page, started one after another; -> (answers by page, the threads). Each is asking or waiting when this returns."""
        out, threads = {}, []
        for name in names:
            thread = threading.Thread(target=self.ask, args=(model, name, out), daemon=True)
            thread.start()
            threads.append(thread)
            if len(threads) <= lanes:
                self.assertTrue(model.started.acquire(timeout=5), 'a caller with a free lane asks at once')
        return out, threads

    def wait_queued(self, n):
        for _ in range(500):
            if sum(len([c for c in gate['callers'] if c.untaken]) for gate in list(decide.GATES.open.values())) == n:
                return
            threading.Event().wait(0.01)
        self.fail(f'{n} callers never queued')



class SmallQuestions(SharedCalls):
    def test_pages_that_ask_while_a_call_runs_share_the_next_call(self):
        model = Model()
        out, threads = self.pages(model, ['a', 'b', 'c', 'd'])
        self.wait_queued(3)
        self.assertEqual(model.calls, [['a link 0', 'a link 1']], 'positive control: the first page asked at once, alone; the others wait')
        model.go.set()
        for thread in threads:
            thread.join(10)
        self.assertEqual(len(model.calls), 2, 'four pages, two calls: the three that waited were asked together')
        self.assertEqual(sorted(model.calls[1]), sorted(f'{p} link {n}' for p in 'bcd' for n in range(2)))
        self.assertEqual(out, {p: {f'{p} link {n}': 'job_list' for n in range(2)} for p in 'abcd'}, 'every page got its own answers')

    def test_a_page_alone_asks_at_once_as_before(self):
        model = Model()
        model.go.set()
        out = {}
        self.ask(model, 'a', out)
        self.ask(model, 'b', out)
        self.assertEqual([len(call) for call in model.calls], [2, 2])

    def test_the_same_wording_on_two_waiting_pages_is_asked_once(self):
        model = Model()
        out, threads = {}, []
        same = lambda page: out.__setitem__(page, decide.decide('link-kind', {'careers': 'careers'}, ANSWERS, 'what a link is', client=model, floor=False))
        first = threading.Thread(target=self.ask, args=(model, 'a', out), daemon=True)
        first.start()
        self.assertTrue(model.started.acquire(timeout=5))
        for page in ('b', 'c'):
            threads.append(threading.Thread(target=same, args=(page,), daemon=True))
            threads[-1].start()
        self.wait_queued(2)
        model.go.set()
        for thread in (first, *threads):
            thread.join(10)
        self.assertEqual(model.calls[1], ['careers'])
        self.assertEqual((out['b'], out['c']), ({'careers': 'job_list'}, {'careers': 'job_list'}))

    def test_a_failed_shared_call_leaves_every_waiting_page_unknown_and_none_hanging(self):
        model = Model(fail=True)
        with mock.patch.object(decide, 'detail'):
            out, threads = self.pages(model, ['a', 'b', 'c'])
            self.wait_queued(2)
            model.go.set()
            for thread in threads:
                thread.join(10)
        self.assertFalse(any(thread.is_alive() for thread in threads), 'nobody is left waiting')
        self.assertEqual(out, {'a': {}, 'b': {}, 'c': {}}, 'unknown, never a guess')
        self.assertEqual(decide.GATES.open, {}, 'the lane is free again: nothing is kept')

    def test_a_different_question_never_shares_a_call(self):
        model = Model()
        out = {}
        first = threading.Thread(target=self.ask, args=(model, 'a', out), daemon=True)
        first.start()
        self.assertTrue(model.started.acquire(timeout=5))
        other = threading.Thread(target=lambda: out.__setitem__('t', decide.decide('title-kind', {'x': 'x'}, ANSWERS, 'what a title is', client=model, floor=False)), daemon=True)
        other.start()
        self.assertTrue(model.started.acquire(timeout=5), 'another topic has its own lane: asked at once')
        model.go.set()
        first.join(10), other.join(10)
        self.assertEqual(len(model.calls), 2)

    def test_callers_that_pay_from_different_allowances_never_share_a_call(self):
        """Invariant of decide.own_allowance: only the thread that opened an allowance draws from it."""
        model, out = Model(), {}

        def scoped():
            with decide.own_allowance('board pass', 5):
                self.ask(model, 'a', out)
        first = threading.Thread(target=scoped, daemon=True)
        first.start()
        self.assertTrue(model.started.acquire(timeout=5))
        other = threading.Thread(target=self.ask, args=(model, 'b', out), daemon=True)
        other.start()
        self.assertTrue(model.started.acquire(timeout=5), 'the run\'s own cap pays for this one: asked at once, not through the allowance\'s call')
        model.go.set()
        first.join(10), other.join(10)
        self.assertEqual((decide.spent('board pass'), len(model.calls)), (1, 2))

    def test_a_caller_that_waited_too_long_leaves_unanswered(self):
        asked = threading.Event()
        release = threading.Event()
        slow = lambda pairs: (asked.set(), release.wait(10), ['x'] * len(pairs))[2]
        gates = decide_gate.Gates()
        lead = threading.Thread(target=gates.shared, args=('k', [('a', 'a')], slow), kwargs={'lanes': 1}, daemon=True)
        lead.start()
        self.assertTrue(asked.wait(5))
        self.assertEqual(gates.shared('k', [('b', 'b')], slow, lanes=1, wait=0.05), [decide_gate.UNASKED])
        release.set()
        lead.join(10)
        self.assertEqual(gates.open, {}, 'no call of the question runs: its gate is dropped')


class Lanes(Model):
    """Model that also counts the calls in flight at once (`most`). hold=page: the first call carrying that page's wordings is recorded only after
    `hold_until` other calls were (CI's load, forced: the thread that built it is paused after the gate let go of its lock)."""
    def __init__(self, hold=None, hold_until=0):
        super().__init__()
        self.flying, self.most, self.lock, self.hold, self.hold_until = 0, 0, threading.Lock(), hold, hold_until

    def create(self, **kw):
        if self.hold and f'{self.hold} link' in kw['messages'][0]['content']:
            self.hold = None
            for _ in range(500):   # a hang guard only: the other lane makes the other calls meanwhile
                if len(self.calls) >= self.hold_until:
                    break
                threading.Event().wait(0.01)
        with self.lock:
            self.flying += 1
            self.most = max(self.most, self.flying)
        try:
            return super().create(**kw)
        finally:
            with self.lock:
                self.flying -= 1


class _Asking(set):
    """A gate's set of texts being asked that logs each batch the moment the gate takes a lane for it (`|=`, under the gate's lock)."""
    def __init__(self, log):
        super().__init__()
        self.log = log

    def __ior__(self, texts):
        self.log.append(sorted(texts))
        return super().__ior__(texts)


class BuildOrder(dict):
    """decide.GATES.open whose gates log their batches in the order the gate built them (`batches`).
    Why (xc, 14 Nov 2026, #4248's run 43612944028, "13 not less than or equal to 4"): the model records a call after the gate lets go of its lock,
    so under CI load the thread holding Infojobs's batch, built first, was paused while the other lane ran ten calls, and it was recorded 13th.
    The order the gate decided is the one asserted; the model's own list stays the positive control (the same calls)."""
    def __init__(self):
        super().__init__()
        self.batches = []

    def setdefault(self, key, gate):
        if key not in self:
            gate['asking'] = _Asking(self.batches)
        return super().setdefault(key, gate)


class BoardsTogether(SharedCalls):
    """The owner's scenario (13 Nov 2026, run 43473395249, c04 = Madrid electrician): Infoempleo, Trabajos.com and Infojobs asked the link-kind
    question at 13 s while two earlier pages held both lanes; their 145 + 300 + 57 wordings went into ONE ask that made its 11 calls one after
    another, and all three got their links at 96 s ("job links 82 s / 80 s / 82 s"), too late for their jobs to be checked."""
    LANES = 2   # as in the app

    def board(self, model, page, n, out):
        out[page] = decide.decide('link-kind', {f'{page} link {i}': f'{page} link {i}' for i in range(n)}, ANSWERS, 'what a link is', client=model, floor=False)

    def last_call(self, batches, page):
        return max(i for i, batch in enumerate(batches, 1) if any(w.startswith(f'{page} link') for w in batch))

    def test_boards_that_ask_together_each_get_their_links_after_their_own_calls_not_everyones(self):
        self.play(Lanes())

    def test_the_order_holds_when_the_first_batch_is_recorded_last(self):
        """#4248's run 43612944028: Infojobs's first batch was built first and recorded 13th; the old measure (the model's list) read 13 > 4."""
        model = Lanes(hold='infojobs', hold_until=12)
        self.play(model)
        self.assertIn('infojobs link 0', model.calls[-1], 'positive control: the forced case happened (the first batch was recorded last)')

    def play(self, model):
        out, threads = {}, []
        decide.GATES.open = order = BuildOrder()
        for page in ('h1', 'h2'):   # two earlier pages hold both lanes
            threads.append(threading.Thread(target=self.ask, args=(model, page, out), daemon=True))
            threads[-1].start()
            self.assertTrue(model.started.acquire(timeout=5))
        for queued, (page, n) in enumerate((('trabajos', 300), ('infoempleo', 145), ('infojobs', 57)), 1):   # the order that hurt most: the smallest last
            threads.append(threading.Thread(target=self.board, args=(model, page, n, out), daemon=True))
            threads[-1].start()
            self.wait_queued(queued)
        model.go.set()
        for thread in threads:
            thread.join(10)
        self.assertFalse(any(thread.is_alive() for thread in threads))
        self.assertEqual(len(model.calls), 2 + 11, 'positive control: the same calls as before (502 wordings, 50 a call), no more')
        self.assertEqual({p: len(out[p]) for p in ('trabajos', 'infoempleo', 'infojobs')}, {'trabajos': 300, 'infoempleo': 145, 'infojobs': 57}, 'every board got all its answers')
        self.assertEqual(sorted(order.batches), sorted(sorted(call) for call in model.calls), 'positive control: the gate logged every call the model got')
        self.assertLessEqual(self.last_call(order.batches, 'infojobs'), 4, 'Infojobs (57 wordings) is answered by the first two calls after the lanes free, not the last of 11')
        self.assertLessEqual(self.last_call(order.batches, 'infoempleo'), 7, 'Infoempleo (145) next: it never waits for Trabajos.com\'s 300')
        self.assertTrue(all(len(call) <= decide.BATCH for call in model.calls))
        self.assertLessEqual(model.most, 2, 'never more than LANES calls of one question at once')


if __name__ == '__main__':
    unittest.main()
