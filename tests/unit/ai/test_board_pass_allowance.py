"""Every AI answer the central scout's board pass needs comes from its own allowance (src/ai/decide.py own_allowance; owner, 26 Oct 2026,
"Own 15-call allowance", then the whole pass): run 40384536845 counted posao.hr 40/37 local, yet kept no fact, because title sorting had spent
the scout's 600 calls and the jobs' kinds of work were never asked. The class: places, kinds of work, a board's country, and any AI step added to
the pass later. Fake AI only."""
import contextlib
import json
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from src import scout_boards, scout_cells, scout_google_boards
from src.ai import cost, decide
from src.sources import careers

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/unit/sources/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def board(host):
    return {'name': host, 'host': host, 'search_url': f'https://{host}/search?q={{role}}', 'countries': ['Moldova'], 'kinds': ['any'], 'source_kind': 'general'}


class Relay:
    """A stand-in for the job's relay (desktop/e2e/lib/broker-relay-serve.mjs): counts every model call, refuses past JOB_CALLS, answers each question
    with the first fitting choice (this country, a field board, Moldova, else the first real answer), and counts place and kinds-of-work questions."""
    from types import SimpleNamespace as N

    class Refused(Exception):
        status_code = 429

    def __init__(self):
        self.calls, self.refused, self.asked = 0, 0, {'places': 0, 'kinds': 0}

    def create(self, **kw):
        if self.calls >= scout_boards.JOB_CALLS:
            self.refused += 1
            raise self.Refused("AI limit reached: this run's cap is used")
        self.calls += 1
        text = kw['messages'][0]['content']
        self.asked['places'] += 'Answer the country it is in' in text
        self.asked['kinds'] += 'family of jobs' in text
        answers = [a.strip() for a in text.split('Allowed answers: ', 1)[1].split('\n', 1)[0].split(',')]
        pick = next((a for a in ('this country', 'field board', 'md', 'Moldova') if a in answers), next(a for a in answers if a != 'none'))
        return self.N(stop_reason='end_turn', usage=self.N(input_tokens=1, output_tokens=1), content=[self.N(type='text', text=json.dumps(
            {str(i): pick for i in range(text.count('### Item'))}))])

    def idea(self):
        """The board ideas: one call for one country, counted as src/ai/board_ideas.py counts it."""
        self.calls += 1
        cost.side('fake', self.N(input_tokens=1, output_tokens=1), 'board_ideas')

    def serving(self):
        stack = contextlib.ExitStack()
        for patch in (mock.patch('src.ai.engine.ready', return_value=True), mock.patch('src.ai.engine.client', lambda **kw: self.N(messages=self.N(create=self.create))),
                      mock.patch('src.ai.meanings_pack.first', return_value=None), mock.patch('src.ai.meanings_pack.every', return_value=[]),
                      mock.patch.dict(cost.TOPICS, clear=True), mock.patch.dict(cost.SIDE, clear=True), mock.patch('src.ai.cost.usd', return_value=0.0),
                      mock.patch('src.read_methods.ai'), mock.patch.object(decide, 'MODEL', 'fake'),
                      mock.patch('src.sources.careers.get_text', lambda url: '<title>Board</title>')):
            stack.enter_context(patch)
        return stack


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
        self.assertEqual([call for call in self.calls if call[1] not in (scout_boards.PLACES, scout_boards.KINDS) and call[2] is None], [],
                         "an AI step of the pass outside its allowance gets nothing once title sorting spent the scout's cap")

    def test_the_allowance_answers_past_the_run_s_cap_and_only_inside(self):
        decide._calls['n'] = decide.CENTRAL_MAX_CALLS
        asked = []

        class Client:
            from types import SimpleNamespace as N
            messages = N(create=lambda **kw: asked.append(kw) or Client.N(stop_reason='end_turn', usage=None, content=[
                Client.N(type='text', text='{"0": "yes"}')]))
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
                    {str(i): answer for i in range(n)}))])
        inside, leftover_done = threading.Event(), threading.Event()

        def leftover_feed_check():   # a feed check the feed pass no longer waits for: it keeps asking while the pass runs
            inside.wait(5)
            for n in range(scout_boards.PLACE_CALLS + scout_boards.KIND_CALLS + 5):
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
                mock.patch('src.ai.cost.side'), mock.patch.object(decide, 'MODEL', 'fake'), mock.patch.object(scout_boards.pool_tags, 'countries_each', lambda texts: ({t: {'md'} for t in texts}, [])):
            got = scout_boards.run(self.db, ideas=lambda search: [board('a.md')], read_board=read, out=out.append, google=lambda *a: [])
        thread.join(5)
        self.assertTrue(leftover_done.is_set())
        self.assertEqual([(fact['host'], fact['families']) for fact in got], [('a.md', ['retail_sales'])], out)
        self.assertIn(f'kinds 1 of {scout_boards.KIND_CALLS}', out[-1], "the line counts the pass's own calls only: the next run shows who spent them")

    def test_its_own_job_behind_a_relay_capped_at_job_calls_keeps_every_board(self):
        """Owner, 12 Nov 2026: "own job". Lab France run 43149389454: the pass ran last in the scout's run, the relay had counted 281 calls of the passes
        before it, and refused every call of the pass ("its AI calls: 1 of 24"): boards with local jobs were not kept. Its own job's relay counts every
        model call from zero and refuses past JOB_CALLS; with each step at its own brake (Google's judge past its 15, places, a board's country, kinds of
        work), the pass stays inside the cap and keeps every board. Example names only."""
        relay = Relay()

        def ideas(search):
            relay.idea()
            return [board(f'b{n}.example') for n in range(scout_boards.MAX_BOARDS)]

        def google(db, country, kinds, out):   # more sites than the judge's allowance: the ones past it wait, unasked
            for n in range(scout_google_boards.MAX_JUDGED + 5):
                decide.one('job site kind for a field', f'site{n}.example', 'a job site', ('field board', 'job board', 'one employer', 'other'), 'task',
                           allowance=scout_google_boards.MAX_JUDGED)
            return []

        def read(item, *a):   # half the boards name a town of their own, half name no place (the AI then names the board's country)
            n = int(item['host'][1:].split('.')[0])
            place = f'Town {n}' if n % 2 else ''
            return [{'title': f'Role {n} {k}', 'location': place, 'url': f'https://{item["host"]}/{k}'} for k in range(4)], 'ok', None
        out = []
        with relay.serving():
            got = scout_boards.run(self.db, ideas=ideas, read_board=read, out=out.append, google=google)
        self.assertEqual(relay.refused, 0, out)
        self.assertLessEqual(relay.calls, scout_boards.JOB_CALLS)
        self.assertEqual(len(got), scout_boards.MAX_BOARDS, out)
        self.assertIn(f"{relay.calls} of {scout_boards.JOB_CALLS} in all", out[-1], "the line's total is the relay's count (Gitar, #3876)")

    def run_boards(self, places_by_board):
        """The pass on boards whose 'n' jobs each name a distinct unknown town, behind the relay; returns (facts, out, relay)."""
        relay, out = Relay(), []
        hosts = {f'b{n}.example': count for n, count in enumerate(places_by_board)}

        def read(item, *a):
            return [{'title': f"Role {item['host']} {k}", 'location': f"Town {item['host']} {k}", 'url': f"https://{item['host']}/{k}"} for k in range(hosts[item['host']])], 'ok', None
        with relay.serving():
            got = scout_boards.run(self.db, ideas=lambda search: relay.idea() or [board(host) for host in hosts], read_board=read, out=out.append, google=lambda *a: [])
        return got, out, relay

    def test_a_board_with_forty_unknown_places_still_gets_its_kinds_of_work_asked(self):
        """Owner, 12 Nov 2026: "Reserve kinds + batch places". France trial 43154452142: one call per place spent the pass's 24, and three boards with
        local jobs were never asked their kinds of work ("no kinds of work from the AI: not kept")."""
        got, out, relay = self.run_boards([40])
        self.assertEqual(relay.asked['kinds'], 1, out)
        self.assertEqual([fact['host'] for fact in got], ['b0.example'], out)

    def test_places_are_asked_fifty_a_call_never_one_call_each(self):
        sizes = [120, 30, 51]
        _, out, relay = self.run_boards(sizes)
        self.assertEqual(relay.asked['places'], sum(-(-n // 50) for n in sizes), out)   # 3 + 1 + 2
        # 13 Nov 2026 (bp): every job read is asked (KIND_BATCH titles a question, MAX_TITLES at most), no longer a first 40: 3 + 1 + 2
        self.assertEqual(relay.asked['kinds'], sum(-(-n // scout_boards.KIND_BATCH) for n in sizes), 'a board takes the questions its jobs need, whatever the places spent')
        self.assertLessEqual(relay.asked['kinds'], scout_boards.KIND_CALLS)

    def test_a_board_with_local_jobs_but_no_kinds_of_work_says_so(self):
        jobs = [{'title': 'Vânzător', 'location': 'Chișinău', 'url': f'https://x/{n}'} for n in range(4)]
        out = []
        with mock.patch.object(scout_boards.pool_tags, 'countries_each', lambda texts: ({t: {'md'} for t in texts}, [])), \
                mock.patch.object(scout_boards.pool_tags, 'families_each', lambda titles: ({}, [])):
            scout_boards.run(self.db, ideas=lambda search: [board('a.md')], read_board=lambda *a: (jobs, 'ok', None), out=out.append, google=lambda *a: [])
        self.assertIn('a.md 4/4 (no kinds of work from the AI: not kept)', out[-1])


if __name__ == '__main__':
    unittest.main()
