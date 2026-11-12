"""The central scout's board pass (src/scout_boards.py): per thin country, the boards that give jobs located there, kept as facts the index publish sends.
24 Oct 2026, owner: "A. Central scout measures boards" (a first search in Moldova depended on which boards the AI happened to name)."""
import sqlite3
import unittest
from datetime import date
from unittest import mock

from src import scout_boards, scout_cells
from src.ai import decide
from src.sources import careers, found_boards


def board(host):
    return {'name': host, 'host': host, 'search_url': f'https://{host}/search?q={{role}}', 'countries': ['Moldova'], 'kinds': ['any'], 'source_kind': 'general'}


def job(place, title='Developer'):
    return {'title': title, 'location': place, 'url': f'https://x/{place}/{title}'}


class BoardPassTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        scout_cells.keep(self.db, [{'countries': [c]} for c in scout_cells.EUROPE if c != 'md' for _ in range(5)])   # Moldova has none: the thinnest
        patches = [mock.patch.object(scout_boards.pool_tags, 'countries_each', lambda texts: ({t: {'md'} if 'Chi' in t else set() for t in texts}, [])),
                   mock.patch.object(scout_boards.pool_tags, 'families_read', lambda titles: (['software_dev'] if titles else [], []))]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def run_pass(self, reads, ideas=None):
        out = []
        seen = {}

        def read_board(item, search, fetch):
            seen['reader'] = careers.READER
            return reads[item['host']]
        got = scout_boards.run(self.db, ideas=ideas or (lambda search: [board(host) for host in reads]), read_board=read_board, out=out.append,
                               google=lambda db, country, kinds, out: [])   # Google's results: tests/unit/ai/test_scout_google_boards.py
        return got, out, seen

    def test_a_board_with_enough_jobs_located_in_the_country_becomes_a_fact(self):
        got, out, _ = self.run_pass({'a.md': ([job('Chisinau')] * 3 + [job('Berlin')], 'ok', None), 'b.md': ([job('Berlin')] * 9, 'ok', None)})
        self.assertEqual([(f['host'], f['country'], f['local_jobs'], f['families']) for f in got], [('a.md', 'md', 3, ['software_dev'])])
        self.assertIn('2 boards proposed, 1 with 3+ local jobs', out[0])
        self.assertTrue(out[0].startswith('Board pass: Moldova (software, '), 'the line names the kinds of work the boards were asked for')

    def test_the_kinds_turn_moves_on_after_a_pass_that_read_boards(self):
        # Gitar on #3913: the per-board loop rebound `families`, so a pass by kinds that read a board never moved the country's turn on
        self.run_pass({'a.md': ([job('Chisinau')] * 3, 'ok', None)})
        self.assertEqual(len(scout_cells._meta(self.db, scout_boards.ASKED_KINDS, {}).get('md') or []), scout_boards.KINDS_PER_COUNTRY)

    def test_worldwide_remote_and_other_countries_do_not_count(self):
        got, _, _ = self.run_pass({'a.md': ([job('Remote')] * 10 + [job('Chisinau')] * 2, 'ok', None)})
        self.assertEqual(got, [], '2 local jobs are under the floor however many remote ones there are')

    def test_the_ai_page_reader_is_off_while_the_boards_are_read_and_back_after(self):
        before = careers.READER
        _, _, seen = self.run_pass({'a.md': ([job('Chisinau')] * 3, 'ok', None)})
        self.assertIsNone(seen['reader'])
        self.assertEqual(careers.READER, before)

    def test_boards_the_rules_could_not_read_are_named_in_the_log(self):
        _, out, _ = self.run_pass({'a.md': ([], 'empty', None), 'b.md': ([], 'browser', None)})
        self.assertIn('not measured (rules could not read the page): a.md, b.md', out[0])

    def test_a_board_the_rules_read_as_empty_is_read_once_more_by_the_ai_page_reader(self):
        # 12 Nov 2026, owner, asked via AskUserQuestion: "AI reads once, recipe after (Recommended)": a Slovak board's page held 40 ads, the rules read 0
        decide.reset_run()
        self.addCleanup(decide.reset_run)
        readers = []

        def read_board(item, search, fetch):
            readers.append(careers.READER)
            return ([job('Chisinau')] * 3, 'ok', None) if careers.READER else ([], 'empty', None)
        out = []
        with mock.patch.object(careers, 'READER', 'auto'), mock.patch('src.ai.page_reader.usable', return_value=True):
            got = scout_boards.run(self.db, ideas=lambda search: [board('a.md')], read_board=read_board, out=out.append, google=lambda *a: [])
            self.assertEqual(careers.READER, 'auto', 'the reader is back as it was after the pass')
        self.assertEqual(readers, [None, 'auto'], 'rules first, then the AI page reader once')
        self.assertEqual([fact['host'] for fact in got], ['a.md'])
        self.assertIn('a.md 3/3 (read by the AI page reader)', out[0])

    def test_the_ai_page_reads_stop_when_their_calls_are_spent_and_a_page_built_by_scripts_is_not_one(self):
        decide.reset_run()
        self.addCleanup(decide.reset_run)
        ai_reads = []

        def read_board(item, search, fetch):
            if careers.READER:
                ai_reads.append(item['host'])
                decide.probe_take(), decide.probe_take()   # the page reader's two pages of this board, counted on the step's pool
            return [], 'browser' if item['host'] == 'script.md' else 'empty', None
        self.assertEqual(scout_boards.PAGE_CALLS, 12, 'the cap is a cost: a raise is a deliberate edit (6 left up to 5 boards a run unread in 7 of 11 lab runs, 12 Nov 2026)')
        boards_by_ai = scout_boards.PAGE_CALLS // found_boards.AI_ASKS
        self.assertEqual(boards_by_ai, scout_boards.MAX_BOARDS // 2, 'the AI page reader reaches half the boards a pass reads')
        hosts = ['script.md'] + [f'{n}.md' for n in range(boards_by_ai + 2)]
        out = []
        with mock.patch.object(careers, 'READER', 'auto'), mock.patch('src.ai.page_reader.usable', return_value=True):
            scout_boards.run(self.db, ideas=lambda search: [board(host) for host in hosts], read_board=read_board, out=out.append, google=lambda *a: [])
        self.assertEqual(ai_reads, [f'{n}.md' for n in range(boards_by_ai)], f'{scout_boards.PAGE_CALLS} calls, two a board; no AI read for a page built by scripts')
        self.assertIn(f'pages {scout_boards.PAGE_CALLS} of {scout_boards.PAGE_CALLS}', out[0])

    def test_without_a_usable_page_reader_an_empty_board_is_not_fetched_again(self):
        # #3922's first CI: every empty board was read twice when no AI could read it (a read with no call never drew from the pool)
        readers = []
        with mock.patch.object(careers, 'READER', 'auto'), mock.patch('src.ai.page_reader.usable', return_value=False):
            scout_boards.run(self.db, ideas=lambda search: [board('a.md'), board('b.md')], read_board=lambda item, *a: readers.append(careers.READER) or ([], 'empty', None),
                             out=lambda line: None, google=lambda *a: [])
        self.assertEqual(readers, [None, None])

    def test_a_board_read_by_the_ai_with_no_call_still_counts_as_one_of_its_boards(self):
        readers = []
        with mock.patch.object(careers, 'READER', 'auto'), mock.patch('src.ai.page_reader.usable', return_value=True):
            scout_boards.run(self.db, ideas=lambda search: [board(f'{n}.md') for n in range(6)], read_board=lambda item, *a: readers.append(careers.READER) or ([], 'empty', None),
                             out=lambda line: None, google=lambda *a: [])
        self.assertEqual(readers.count('auto'), scout_boards.PAGE_CALLS // 2, 'at most PAGE_CALLS / 2 boards a run, even when the reader answers from its cache')

    def test_a_reader_kept_off_stays_off(self):
        readers = []
        with mock.patch.object(careers, 'READER', None):
            scout_boards.run(self.db, ideas=lambda search: [board('a.md')], read_board=lambda item, *a: readers.append(careers.READER) or ([], 'empty', None),
                             out=lambda line: None, google=lambda *a: [])
        self.assertEqual(readers, [None], 'a process whose page reader is off (tests, a person who keeps pages from the AI) never turns it on')

    def browser_pass(self, reads, browsed):
        """One pass where `reads` is each board's plain read and `browsed` its headless browser read (host -> (jobs, state, stop)); -> (facts, line, browsed hosts)."""
        out, asked = [], []

        def browser(item, search):
            asked.append(item['host'])
            return browsed[item['host']]
        got = scout_boards.run(self.db, ideas=lambda search: [board(host) for host in reads], read_board=lambda item, *a: reads[item['host']],
                               out=out.append, google=lambda *a: [], browser=browser, named='md')
        return got, out[0], asked

    def test_a_board_that_refuses_the_plain_reader_is_measured_once_in_the_browser_and_published_marked(self):
        # Owner, 12 Nov 2026 (asked via AskUserQuestion by sa): "Boards now, employers next (Recommended)": the scout's browser reads it, installs see "needs a browser".
        from src.sources import board_yield
        refused = ([], board_yield.Needs('HTTP 403'), None)
        got, line, asked = self.browser_pass({'a.md': refused, 'b.md': ([job('Chisinau')] * 3, 'ok', None), 'c.md': ([], board_yield.scripted(), None)},
                                             {'a.md': ([job('Chisinau')] * 4, 'ok', '')})
        self.assertEqual(asked, ['a.md'], 'only the refused board: a readable one and a page built by scripts are not opened in the browser')
        self.assertEqual({f['host']: f.get('browser') for f in got}, {'a.md': True, 'b.md': None})
        self.assertEqual({f['host']: f.get('browser') for f in scout_boards.facts(self.db)}, {'a.md': True, 'b.md': None}, 'the publish sends the mark, true only')
        self.assertIn('a.md 4/4 (read in the browser)', line)

    def test_a_refusal_bot_check_or_sign_in_page_in_the_browser_is_final(self):
        # Owner, 12 Nov 2026: "Final, never again (Recommended)".
        from src.sources import board_yield
        refused = ([], board_yield.Needs('HTTP 403'), None)
        _, line, asked = self.browser_pass({'a.md': refused, 'b.md': refused}, {'a.md': ([], board_yield.Needs('HTTP 401'), 'HTTP 401'), 'b.md': ([], board_yield.Needs('unknown'), 'a login page')})
        self.assertEqual(asked, ['a.md', 'b.md'])
        self.assertIn('the browser was stopped, never asked again: a.md (HTTP 401), b.md (a login page)', line)
        _, _, again = self.browser_pass({'a.md': refused, 'b.md': refused}, {})
        self.assertEqual(again, [], 'a later pass never opens them in the browser again')
        self.assertEqual(scout_boards.facts(self.db), [])

    def test_a_stop_seen_in_a_trial_and_named_by_hand_is_never_opened_by_the_next_real_pass(self):
        # sa for the owner, 12 Nov 2026: "Final, never again" and "never retry a 401 or 403"; a trial saves no memory, so its stop is named by hand.
        from src.sources import board_yield
        scout_boards.ensure(self.db)
        lines = []
        kept = scout_boards.seed_final(self.db, 'Refusing.example, www.other.example  not a host, refusing.example', out=lines.append)
        self.assertEqual(kept, ['refusing.example', 'other.example'])
        self.assertIn('never opened: refusing.example, other.example', lines[0])
        _, _, asked = self.browser_pass({'refusing.example': ([], board_yield.Needs('HTTP 403'), None)}, {})
        self.assertEqual(asked, [], 'the real pass never opens it in the browser')
        self.assertEqual(scout_boards.seed_final(self.db, ''), [], 'no input: nothing kept')

    def test_with_no_browser_here_the_pass_reads_as_before(self):
        from src.sources import board_yield
        got, line, _ = self.browser_pass({'a.md': ([], board_yield.Needs('HTTP 403'), None)}, {'a.md': None})
        self.assertEqual(got, [])
        self.assertIn('not measured (rules could not read the page): a.md', line)
        self.assertFalse(scout_boards.browser_final(self.db, 'a.md'), 'not measured is not final: the next pass with a browser reads it')

    def test_the_browser_read_stops_at_a_sign_in_page_it_lands_on_and_at_a_refusal(self):
        from src.sources import careers as plain, render
        search = {'role_keywords': ['developer'], 'locations': {'top_tier': [], 'country_wide': ['Moldova'], 'abroad': []}}

        def lands_on(path):
            def show(url):
                render._state['landed'][url] = f'https://a.md{path}'
                return '<html><body>Sign in to continue</body></html>'
            return show

        def refuses(url):
            raise render.Refused('HTTP 403')
        self.addCleanup(render._state['landed'].clear)
        for show, stop in ((lands_on('/account/login'), 'a login page'), (refuses, 'HTTP 403')):
            with self.subTest(stop), mock.patch.object(plain, 'renderer', lambda: show):
                jobs, state, why = scout_boards.browse(board('a.md'), search)
                self.assertEqual((jobs, state, why), ([], 'browser', stop))
        with mock.patch.object(plain, 'renderer', lambda: None):
            self.assertIsNone(scout_boards.browse(board('a.md'), search), 'no browser here: not measured')
        with mock.patch.object(plain, 'renderer', lambda: lands_on('/jobs')), mock.patch.object(render, '_app', lambda: ('http://127.0.0.1:1', 'k')):
            self.assertIsNone(scout_boards.browse(board('a.md'), search), "the app's renderer says no landed address: not measured, never read past a sign-in page")
        loads = []

        def once(url):
            loads.append(url)
            raise render.Refused('HTTP 403')
        from src.sources import found_boards

        def swallowing(item, search, fetch, show=None):   # a reader that catches the error and asks the next page anyway
            for url in ('https://a.md/1', 'https://a.md/2'):
                try:
                    fetch(url)
                except render.Refused:
                    pass
            return [], 'empty', None
        with mock.patch.object(plain, 'renderer', lambda: once), mock.patch.object(found_boards, 'read_board', swallowing):
            self.assertEqual(scout_boards.browse(board('a.md'), search)[2], 'HTTP 403')
        self.assertEqual(loads, ['https://a.md/1'], 'after a stop no other page of the board is loaded')

    def test_facts_are_kept_for_the_publish_and_expire_after_thirty_days(self):
        self.run_pass({'a.md': ([job('Chisinau')] * 3, 'ok', None)})
        self.assertEqual([f['host'] for f in scout_boards.facts(self.db)], ['a.md'])
        self.assertEqual(scout_boards.facts(self.db, today=date(2099, 1, 1)), [])

    def test_a_countrys_kinds_of_work_take_turns_run_after_run(self):
        """A by-hand pass of one country, 12 Nov 2026: every run asked for software and the same 2 thinnest kinds, so the boards of the other kinds were never asked for."""
        asked = []
        ideas = lambda search: asked.append(search['role_keywords']) or []
        every = ('software', *scout_cells.AIMED)
        seen = []
        for _ in range(-(-len(every) // scout_boards.KINDS_PER_COUNTRY)):
            seen += scout_boards.kinds_for(self.db, 'md')
            scout_boards.run(self.db, ideas=ideas, read_board=lambda *a: ([], 'empty', None), out=lambda line: None, named='md', google=lambda *a: [])
        self.assertEqual(sorted(seen[:len(every)]), sorted(every), 'every kind of work is asked once before any is asked twice')
        self.assertEqual(seen[0], 'software', 'a country nobody asked yet starts as before: software first')
        self.assertNotEqual(asked[0], asked[1], 'positive control: the second run asked the AI for other roles than the first')

    def test_kinds_named_by_hand_are_the_ones_asked_and_a_wrong_name_falls_back_to_the_turn(self):
        asked, googled = [], []
        ideas = lambda search: asked.append(search['role_keywords']) or []
        scout_boards.run(self.db, ideas=ideas, read_board=lambda *a: ([], 'empty', None), out=lambda line: None, named='md',
                         google=lambda db, country, kinds, out: googled.append(kinds) or [], kinds=scout_boards.named_kinds(' Trades, education ,nonsense'))
        self.assertEqual(googled, [['trades', 'education']])
        self.assertEqual(scout_boards.named_kinds('nonsense'), [])
        self.assertEqual(scout_boards.kinds_for(self.db, 'md', [])[0], 'software', 'no valid name: the turn, and software has not been asked yet')

    def test_a_pass_that_fails_before_its_reads_keeps_the_kinds_turn(self):
        before = scout_boards.kinds_for(self.db, 'md')
        def broken(search):
            raise RuntimeError('no AI')
        scout_boards.run(self.db, ideas=broken, out=lambda line: None, named='md', google=lambda *a: [])
        self.assertEqual(scout_boards.kinds_for(self.db, 'md'), before)

    def test_one_thin_country_a_run_then_the_next(self):
        first = scout_boards.next_country(self.db)
        self.assertEqual(first, 'md', 'the country with no employers at all')
        self.assertNotEqual(scout_boards.next_country(self.db), first)

    def test_a_failure_is_said_and_never_raised(self):
        out = []

        def broken(search):
            raise RuntimeError('no AI')
        self.assertEqual(scout_boards.run(self.db, ideas=broken, out=out.append), [])
        self.assertIn('board pass skipped: RuntimeError: no AI', out[0])

    def test_the_index_publish_sends_the_facts_only_when_there_are_some(self):
        import json
        from src.scout_index import publish_index
        sent = []
        feeds = [{'ats': 'ashby', 'slug': 'a'}]
        publish_index(feeds, 'https://x/api/index', 'k', send=lambda request: sent.append(json.loads(request.data)) or 200)
        publish_index(feeds, 'https://x/api/index', 'k', send=lambda request: sent.append(json.loads(request.data)) or 200,
                      board_facts=[{'host': 'a.md', 'url': 'https://a.md/?q={role}', 'country': 'md', 'families': ['software_dev'], 'local_jobs': 4}])
        self.assertNotIn('board_facts', sent[0])
        self.assertEqual(sent[1]['board_facts'][0]['host'], 'a.md')

    def test_a_country_name_no_list_knows_fails_with_the_accepted_names_and_never_reads_another_country(self):
        """12 Nov 2026, sa: "Slovakia" and "Slovenia" were unknown, so the by-hand runs silently did Moldova and Estonia instead."""
        for wrong in ('Narnia', 'Slovak republic', 'xx'):
            with self.assertRaises(ValueError) as caught:
                scout_boards.named_country(wrong)
            self.assertIn('accepted:', str(caught.exception))
            self.assertIn('Moldova (md)', str(caught.exception))
        self.assertEqual([scout_boards.named_country(x) for x in ('Slovakia', 'sk', 'Slovenia', 'LT', 'latvia', 'Cyprus', 'mt')],
                         ['sk', 'sk', 'si', 'lt', 'lv', 'cy', 'mt'])

    def test_the_by_hand_run_with_a_wrong_name_stops_before_any_board_is_read(self):
        """The run's input path (src/scout.py --board-pass): the wrong name ends the process with the line, the board pass never starts."""
        import os
        import sys
        from src import scout
        with mock.patch.dict(os.environ, {'SCOUT_BOARD_COUNTRY': 'Narnia'}), mock.patch.object(sys, 'argv', ['scout', '--board-pass', '--db', ':memory:']), \
                mock.patch.object(scout_boards, 'run') as ran, mock.patch.object(scout.scout_core, 'CENTRAL', False):   # main() and the pass set it; restored on exit so no later test sees central mode
            with self.assertRaises(SystemExit) as stopped:
                scout.main()
        self.assertIn('unknown country', str(stopped.exception))
        ran.assert_not_called()

    def test_a_country_named_by_hand_is_read_and_each_board_says_listed_and_local(self):
        """24 Oct 2026, owner: "Small step + Moldova run": the by-hand scout run picks the country; the line shows listed/local per board."""
        self.assertEqual([scout_boards.named_country(x) for x in ('md', 'Moldova', ' moldova ', '', None)], ['md', 'md', 'md', None, None])
        out = []
        reads = {'a.md': [job('Chisinau')] * 4 + [job('Paris')], 'b.md': []}
        scout_boards.run(self.db, ideas=lambda search: [board(h) for h in reads], read_board=lambda item, *a: (reads[item['host']], 'ok', None),
                         out=out.append, named='md')
        self.assertIn('2 boards proposed, 1 with 3+ local jobs; listed/local: a.md 5/4, b.md 0/0', out[-1])
        self.assertTrue(out[-1].startswith('Board pass: Moldova ('))
        self.assertIn('md', scout_cells._meta(self.db, 'boards_aimed', []))   # it counts as done: the rotation moves on



class RealBoardIdeasTest(unittest.TestCase):
    def test_the_scouts_country_search_reaches_the_ai_with_an_empty_places_cache(self):
        """24 Oct 2026, scout run 40115771200: "0 boards proposed, took 0 s": country_wide ['Moldova'] resolved to no country in CI (empty places
        cache), so board_ideas.asked_for returned None before any AI call. The earlier tests passed a fake `ideas` and never saw it."""
        import json
        import tempfile
        from pathlib import Path
        from types import SimpleNamespace
        from src.ai import board_ideas
        db = sqlite3.connect(':memory:')
        scout_cells.keep(db, [{'countries': [c]} for c in scout_cells.EUROPE if c != 'md' for _ in range(5)])
        answer = {'boards': [{'name': 'Local', 'search_url': 'https://jobs.example.md/?q={role}', 'countries': ['Moldova'], 'kinds': ['any']}]}
        asked = []

        def create(**kwargs):
            asked.append(json.loads(kwargs['messages'][0]['content']))
            return SimpleNamespace(stop_reason='end_turn', usage=None, content=[SimpleNamespace(type='text', text=json.dumps(answer))])
        client = SimpleNamespace(messages=SimpleNamespace(create=create))
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        out = []
        with mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={}), \
                mock.patch('src.ai.engine.ready', return_value=True), mock.patch('src.ai.engine.client', return_value=client), \
                mock.patch.object(board_ideas, 'served', return_value=[]):
            scout_boards.run(db, read_board=lambda *a: ([], 'empty', None), out=out.append)
        self.assertEqual([a['countries'] for a in asked], [['Moldova']], out)
