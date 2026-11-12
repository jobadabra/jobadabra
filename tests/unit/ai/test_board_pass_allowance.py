"""Every AI answer the central scout's board pass needs comes from its own allowance (src/ai/decide.py own_allowance; owner, 26 Oct 2026,
"Own 15-call allowance", then the whole pass): run 40384536845 counted posao.hr 40/37 local, yet kept no fact, because title sorting had spent
the scout's 600 calls and the jobs' kinds of work were never asked. The class: places, kinds of work, a board's country, and any AI step added to
the pass later. Fake AI only."""
import json
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from src import scout_boards, scout_cells
from src.ai import decide
from src.sources import careers

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def board(host):
    return {'name': host, 'host': host, 'search_url': f'https://{host}/search?q={{role}}', 'countries': ['Moldova'], 'kinds': ['any'], 'source_kind': 'general'}


class BoardPassAllowance(unittest.TestCase):
    def setUp(self):
        decide.reset_run()
        self.addCleanup(decide.reset_run)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.ai.meanings_pack.queue')):
            patch.start()
            self.addCleanup(patch.stop)
        self.db = sqlite3.connect(':memory:')
        scout_cells.keep(self.db, [{'countries': [c]} for c in scout_cells.EUROPE if c != 'md' for _ in range(5)])   # Moldova: the thinnest
        self.calls = []

    def fake_decide(self, topic, items, answers, instructions, client=None, db=None, since='', floor=True, ask=True, allowance=None):
        self.calls.append((topic, decide.own_scope(), allowance))
        pick = {'pool-country': 'md', 'pool-family': 'sales_retail'}.get(topic, answers[0])
        return {key: pick for key in items}

    def test_every_ai_step_of_the_pass_runs_on_its_own_allowance(self):
        jobs = [{'title': f'Vânzător {n}', 'location': 'Chișinău', 'url': f'https://x/{n}'} for n in range(4)]
        jobs += [{'title': f'Casier {n}', 'location': '', 'url': f'https://y/{n}'} for n in range(3)]
        reads = {'a.md': (jobs[:4], 'ok', None), 'b.md': (jobs[4:] + jobs[:1], 'ok', None)}
        out = []
        with mock.patch.object(decide, 'decide', self.fake_decide), mock.patch('src.sources.careers.get_text', lambda url: '<title>Board</title>'):
            got = scout_boards.run(self.db, ideas=lambda search: [board(host) for host in reads], read_board=lambda item, *a: reads[item['host']],
                                   out=out.append, google=lambda *a: [])
        self.assertEqual({fact['host'] for fact in got}, {'a.md', 'b.md'}, out)
        topics = {topic for topic, *_ in self.calls}
        self.assertTrue({'pool-country', 'pool-family', 'job board country'} <= topics, topics)
        self.assertEqual([call for call in self.calls if call[1] != 'central scout board pass' and call[2] is None], [],
                         "an AI step of the pass outside its allowance gets nothing once title sorting spent the scout's cap")

    def test_the_allowance_answers_past_the_run_s_cap_and_only_inside(self):
        decide._calls['n'] = decide.CENTRAL_MAX_CALLS
        asked = []

        class Client:
            from types import SimpleNamespace as N
            messages = N(create=lambda **kw: asked.append(kw) or Client.N(stop_reason='end_turn', usage=None, content=[
                Client.N(type='text', text='{"results": [{"index": 0, "answer": "yes"}]}')]))
        with mock.patch('src.ai.cost.side'):
            self.assertIsNone(decide.one('t', 'a', 'x', ('yes', 'no'), 'task', Client(), self.db), 'outside: the spent cap')
            with decide.own_allowance('pass', 2):
                self.assertEqual([decide.one('t', key, 'x', ('yes', 'no'), 'task', Client(), self.db) for key in 'bcd'], ['yes', 'yes', None])
            self.assertIsNone(decide.one('t', 'e', 'x', ('yes', 'no'), 'task', Client(), self.db), 'after the scope: the cap again')
        self.assertEqual((len(asked), decide._calls['n']), (2, decide.CENTRAL_MAX_CALLS))

    def test_a_feed_check_left_running_does_not_spend_the_pass_s_allowance(self):
        """Lab scout run, France, 12 Nov 2026: "Board pass: France: 12 boards proposed, 0 with 3+ local jobs; ... 40/10 (no kinds of work from
        the AI: not kept), ... 165/132 (no kinds of work from the AI: not kept)". The feed pass's time ran out with its checks still asking the AI
        (src/scout_index.py: shutdown(wait=False)); the allowance was process-wide, so those threads spent the pass's calls and the kinds of work
        of two boards with local jobs were never asked."""
        asked = []

        class Client:
            from types import SimpleNamespace as N

            def __init__(self):
                self.messages = self.N(create=self.create)

            def create(self, **kw):
                n = kw['messages'][0]['content'].count('### Item')
                answer = 'retail_sales' if 'family of jobs' in kw['messages'][0]['content'] else 'md'
                asked.append(answer)
                return self.N(stop_reason='end_turn', usage=None, content=[self.N(type='text', text=json.dumps(
                    {'results': [{'index': i, 'answer': answer} for i in range(n)]}))])
        inside, leftover_done = threading.Event(), threading.Event()

        def leftover_feed_check():   # a feed check the feed pass no longer waits for: it keeps asking while the pass runs
            inside.wait(5)
            for n in range(scout_boards.PASS_CALLS + 5):
                decide.decide('job-region', {f'place {n}': f'place {n}'}, ('a', 'none'), 'task', client=Client(), db=sqlite3.connect(':memory:'))
            leftover_done.set()

        def read(item, *a):
            inside.set()
            leftover_done.wait(5)
            return [{'title': f'Vânzător {n}', 'location': 'Chișinău', 'url': f'https://x/{n}'} for n in range(4)], 'ok', None
        thread = threading.Thread(target=leftover_feed_check)
        thread.start()
        out = []
        with mock.patch('src.ai.engine.ready', return_value=True), mock.patch('src.ai.engine.client', lambda **kw: Client()), \
                mock.patch('src.ai.meanings_pack.first', return_value=None), mock.patch('src.ai.meanings_pack.every', return_value=[]), \
                mock.patch('src.ai.cost.side'), mock.patch.object(decide, 'MODEL', 'fake'), mock.patch.object(scout_boards.pool_tags, 'countries', lambda texts: ['md']):
            got = scout_boards.run(self.db, ideas=lambda search: [board('a.md')], read_board=read, out=out.append, google=lambda *a: [])
        thread.join(5)
        self.assertTrue(leftover_done.is_set())
        self.assertEqual([(fact['host'], fact['families']) for fact in got], [('a.md', ['retail_sales'])], out)
        self.assertIn(f'its AI calls: 1 of {scout_boards.PASS_CALLS}', out[-1], "the line counts the pass's own calls only: the next run shows who spent them")

    def test_a_board_with_local_jobs_but_no_kinds_of_work_says_so(self):
        jobs = [{'title': 'Vânzător', 'location': 'Chișinău', 'url': f'https://x/{n}'} for n in range(4)]
        out = []
        with mock.patch.object(scout_boards.pool_tags, 'countries', lambda texts: ['md']), \
                mock.patch.object(scout_boards.pool_tags, 'families', lambda titles: []):
            scout_boards.run(self.db, ideas=lambda search: [board('a.md')], read_board=lambda *a: (jobs, 'ok', None), out=out.append, google=lambda *a: [])
        self.assertIn('a.md 4/4 (no kinds of work from the AI: not kept)', out[-1])


if __name__ == '__main__':
    unittest.main()
