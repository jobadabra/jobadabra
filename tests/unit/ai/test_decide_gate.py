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
        body = json.dumps({'results': [{'index': n, 'answer': 'job_list'} for n in range(len(wordings))]})
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=body)], usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class SharedCalls(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        for patch in (mock.patch.object(decide, '_db', lambda: sqlite3.connect(self.tmp / 'd.sqlite')), mock.patch.object(decide.cost, 'side'),
                      mock.patch.object(decide.engine, 'structured', lambda *a, **k: {}), mock.patch('src.ai.meanings_pack.queue'), mock.patch.object(decide_gate, 'LANES', 1),
                      mock.patch('src.ai.meanings_pack.first', return_value=None), mock.patch('src.ai.meanings_pack.ai_first', return_value=True)):
            patch.start()
            self.addCleanup(patch.stop)
        decide.reset_run()
        self.addCleanup(decide.reset_run)
        self.addCleanup(decide_gate._gates.clear)
        decide_gate._gates.clear()

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
            if sum(len(gate['queue']) for gate in decide_gate._gates.values()) == n:
                return
            threading.Event().wait(0.01)
        self.fail(f'{n} callers never queued')

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
        self.assertEqual(decide_gate._gates and [gate['flying'] for gate in decide_gate._gates.values()], [0], 'the lane is free again')

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
        lead = threading.Thread(target=decide_gate.shared, args=('k', [('a', 'a')], slow), kwargs={'lanes': 1}, daemon=True)
        lead.start()
        self.assertTrue(asked.wait(5))
        self.assertEqual(decide_gate.shared('k', [('b', 'b')], slow, lanes=1, wait=0.05), [decide_gate.UNASKED])
        release.set()
        lead.join(10)
        self.assertEqual(decide_gate._gates['k'], {'flying': 0, 'queue': []})


if __name__ == '__main__':
    unittest.main()
