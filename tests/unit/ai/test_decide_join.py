"""decide() joins the same question asked by several threads within JOIN_S into one model call (src/ai/decide.py, as 1/2, 11 Nov 2026): each asker
gets only its own items, a lone question waits at most JOIN_S, an item the answer misses stays unknown, a failed call leaves every asker's items
unknown and counted, an error while asking reaches every asker, and a search tape asks each question alone."""
import json
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src.ai import decide  # noqa: E402

ANSWERS = ('yes', 'no')


class FakeClient:
    """Answers each `### Item` block with answer_for(text); None leaves the item out of the answer. fail=True raises like a broken AI."""

    def __init__(self, answer_for=lambda text: 'yes', fail=False):
        self.answer_for, self.fail, self.calls, self.lock = answer_for, fail, [], threading.Lock()
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        texts = [block.split('\n', 1)[1].strip() for block in kwargs['messages'][0]['content'].split('### Item ')[1:]]
        with self.lock:
            self.calls.append(texts)
        if self.fail:
            raise RuntimeError('AI did not answer')
        results = [{'index': i, 'answer': answer} for i, text in enumerate(texts) if (answer := self.answer_for(text)) is not None]
        return SimpleNamespace(stop_reason='end_turn', usage=None, content=[SimpleNamespace(type='text', text=json.dumps({'results': results}))])


class JoinTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.mkdtemp()
        self.path = str(Path(folder) / 'jobs.sqlite')   # never the app's jobs.sqlite: decide's own db is this temp file
        patches = [mock.patch.object(decide, '_db', lambda: sqlite3.connect(self.path, timeout=30)),
                   mock.patch.object(decide.engine, 'ready', return_value=True),
                   mock.patch.object(decide.budget_tape, 'active', return_value=False)]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        decide.reset_run()
        decide.FAILED[0] = 0

    def with_client(self, client):
        patch = mock.patch.object(decide.engine, 'client', return_value=client)
        patch.start()
        self.addCleanup(patch.stop)
        return client

    def ask_together(self, asks):
        """Each (topic, items) asked by its own thread, all started at once -> [result or the exception raised]."""
        out, gate = [None] * len(asks), threading.Barrier(len(asks))

        def run(n, topic, items):
            gate.wait()
            try:
                out[n] = decide.decide(topic, items, ANSWERS, 'Is it a job page?')
            except Exception as error:  # noqa: BLE001 — the test reads what each asker got
                out[n] = error
        threads = [threading.Thread(target=run, args=(n, *ask)) for n, ask in enumerate(asks)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
        return out

    def test_the_same_question_asked_at_once_is_one_call_and_each_asker_gets_its_own_items(self):
        client = self.with_client(FakeClient(lambda text: 'yes' if 'careers' in text else 'no'))
        got = self.ask_together([('t-join', {'a': 'careers page'}), ('t-join', {'b': 'blog post'}), ('t-join', {'c': 'careers list'})])
        self.assertEqual(len(client.calls), 1, 'three askers within JOIN_S: one model call')
        self.assertEqual(sorted(client.calls[0]), ['blog post', 'careers list', 'careers page'])
        self.assertEqual(got, [{'a': 'yes'}, {'b': 'no'}, {'c': 'yes'}], 'each asker gets only its own items')
        self.assertEqual(decide.WAITING['calls'], {'t-join': 1}, 'the run counts the calls made, not the askers')
        self.assertEqual(decide.kept('t-join', ['a', 'b', 'c'], sqlite3.connect(self.path)), {'a': 'yes', 'b': 'no', 'c': 'yes'})

    def test_a_question_asked_alone_waits_at_most_join_s(self):
        client = self.with_client(FakeClient())
        started = time.monotonic()
        self.assertEqual(decide.one('t-alone', 'a', 'careers page', ANSWERS, 'Is it a job page?'), 'yes')
        waited = time.monotonic() - started
        self.assertEqual(len(client.calls), 1)
        self.assertLess(waited, decide.JOIN_S + 0.25, f'a lone question paid {waited:.2f} s, more than JOIN_S ({decide.JOIN_S} s)')

    def test_different_questions_are_never_joined(self):
        client = self.with_client(FakeClient())
        self.ask_together([('t-one', {'a': 'x'}), ('t-two', {'b': 'y'})])
        self.assertEqual(len(client.calls), 2)

    def test_an_item_the_joined_answer_misses_stays_unknown(self):
        self.with_client(FakeClient(lambda text: None if text == 'blog post' else 'yes'))
        got = self.ask_together([('t-miss', {'a': 'careers page'}), ('t-miss', {'b': 'blog post'})])
        self.assertEqual(got, [{'a': 'yes'}, {}], 'b was not answered: unknown, never guessed')
        self.assertEqual(decide.kept('t-miss', ['b'], sqlite3.connect(self.path)), {})

    def test_a_failed_joined_call_leaves_every_askers_items_unknown_and_counted(self):
        self.with_client(FakeClient(fail=True))
        with mock.patch.object(decide, 'detail'):
            got = self.ask_together([('t-fail', {'a': 'x'}), ('t-fail', {'b': 'y', 'c': 'z'})])
        self.assertEqual(got, [{}, {}], 'the AI ran and failed: {} (unknown), not None (no AI)')
        self.assertEqual(decide.WAITING['n'], 3, 'all three items wait for the next run')
        self.assertEqual(decide.FAILED[0], 2, 'each asker can tell "not judged" from "judged no"')

    def test_an_error_while_asking_reaches_every_asker(self):
        with mock.patch.object(decide.engine, 'client', side_effect=ValueError('no client')):
            got = self.ask_together([('t-err', {'a': 'x'}), ('t-err', {'b': 'y'})])
        self.assertTrue(all(isinstance(result, ValueError) for result in got), got)

    def test_on_a_search_tape_each_question_is_asked_alone(self):
        client = self.with_client(FakeClient())
        with mock.patch.object(decide.budget_tape, 'active', return_value=True), mock.patch.object(decide.budget_tape, 'within', return_value=True):
            self.ask_together([('t-tape', {'a': 'x'}), ('t-tape', {'b': 'y'})])
        self.assertEqual(len(client.calls), 2, 'a tape keys each answer by its whole request: no batch made of whoever came first')

    def test_a_full_batch_does_not_wait_and_the_next_asker_starts_another(self):
        client = self.with_client(FakeClient())
        big = {f'k{n}': f'item {n}' for n in range(decide.BATCH)}
        started = time.monotonic()
        decide.decide('t-full', big, ANSWERS, 'Is it a job page?')
        self.assertLess(time.monotonic() - started, decide.JOIN_S, 'BATCH items: asked at once')
        self.assertEqual(len(client.calls), 1)


if __name__ == '__main__':
    unittest.main()
