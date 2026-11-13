"""The central scout's board pass (src/scout_boards.py): per thin country, the boards that give jobs located there, kept as facts the index publish sends.
24 Oct 2026, owner: "A. Central scout measures boards" (a first search in Moldova depended on which boards the AI happened to name)."""
import sqlite3
import unittest
from datetime import date
from unittest import mock

from src import scout_board_cells, scout_boards, scout_cells
from src.ai import decide
from src.sources import careers, found_boards


def board(host):
    return {'name': host, 'host': host, 'search_url': f'https://{host}/search?q={{role}}', 'countries': ['Moldova'], 'kinds': ['any'], 'source_kind': 'general'}


def job(place, title='Developer'):
    return {'title': title, 'location': place, 'url': f'https://x/{place}/{title}'}


def summary(out):
    """The pass's one summary line (the per-board 'Board kinds:' lines, 13 Nov 2026, come beside it)."""
    return next(line for line in out if line.startswith('Board pass: '))


class BoardPassTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        scout_cells.keep(self.db, [{'countries': [c]} for c in scout_cells.EUROPE if c != 'md' for _ in range(5)])   # Moldova has none: the thinnest
        patches = [mock.patch.object(scout_boards.pool_tags, 'countries_each', lambda texts: ({t: {'md'} if 'Chi' in t else set() for t in texts}, [])),
                   mock.patch.object(scout_boards.pool_tags, 'families_each', lambda titles: ({t: ['software_dev'] for t in titles}, []))]
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
        self.assertIn('2 boards proposed, 1 with 3+ local jobs', summary(out))
        self.assertTrue(summary(out).startswith('Board pass: Moldova (software, '), 'the line names the kinds of work the boards were asked for')

    def by_cells(self, reads, labels, asked, searched, url='https://{host}/search?q={{role}}'):
        """One board-discovery pass for `asked` ({family: its words}); the fake reader says which words it searched (as found_boards does) and returns reads[host]."""
        def read_board(item, search, fetch):
            item['learn'].setdefault('terms', []).extend(searched)
            return reads[item['host']]
        with mock.patch.object(scout_boards.pool_tags, 'families_each', lambda titles: ({t: labels(t) for t in titles}, [])):
            return scout_boards.run(self.db, ideas=lambda search: [{**board(host), 'search_url': url.format(host=host)} for host in reads], read_board=read_board,
                                    out=lambda line: None, named='md', google=lambda *a: [], families=list(asked), words=lambda db, country, families: asked)

    def test_slow_rereads_of_known_boards_do_not_use_up_the_time_of_the_new_boards(self):
        """13 Nov 2026 (bp, run 43498167418, Spain): the stale re-read of airlinejobs.com took 264 s, past BUDGET_S (240), so the loop stopped and the 10 other proposed boards
        never started. Re-reads have their own time (Gitar on #4037: with two slow ones the second used to stop the pass too): a re-read the time has run out for waits, not stamped,
        and the budget for new boards starts after them."""
        now, read = [0.0], []

        def read_board(item, search, fetch):
            read.append(item['host'])
            now[0] += 300 if item['host'].startswith('known') else 10   # the re-reads are slow, every new board is quick
            return [], 'ok', None
        known = [{**board(host), 'search_url': f'https://{host}/search?q={{role}}'} for host in ('known1.example', 'known2.example')]
        scout_boards.run(self.db, ideas=lambda search: [board('new1.example'), board('new2.example')], read_board=read_board, out=lambda line: None, named='md',
                         google=lambda *a: [], families=['software_dev'], words=lambda db, country, families: {'software_dev': ['programator']},
                         again=known, clock=lambda: now[0])
        self.assertEqual(read, ['known1.example', 'new1.example', 'new2.example'], 'the second re-read had no time left; both new boards were read')
        self.assertEqual(scout_cells._meta(self.db, scout_board_cells.SKIPPED, {}), {'md': ['known2.example']})

    def test_one_slow_reread_still_lets_every_new_board_be_read(self):
        now, read = [0.0], []

        def read_board(item, search, fetch):
            read.append(item['host'])
            now[0] += 300 if item['host'] == 'known.example' else 10
            return [], 'ok', None
        known = {**board('known.example'), 'search_url': 'https://known.example/search?q={role}'}
        scout_boards.run(self.db, ideas=lambda search: [board('new1.example'), board('new2.example')], read_board=read_board, out=lambda line: None, named='md',
                         google=lambda *a: [], families=['software_dev'], words=lambda db, country, families: {'software_dev': ['programator']},
                         again=[known], clock=lambda: now[0])
        self.assertEqual(read, ['known.example', 'new1.example', 'new2.example'])

    def test_a_fact_counts_the_jobs_of_each_family_over_every_job_read_not_just_the_families_seen(self):
        """13 Nov 2026 (bp, owner: "Why ? Let's fix it."): an airline board with 178 Spanish jobs, one an aircraft electrician, was 'measured' for electricians. The count is
        per family, over every job the pass read (60 titles here: past the old first 40), only for families the board was asked for by their own word."""
        electrician = lambda n: f'Electricista {n}'
        jobs = [job('Chisinau', electrician(n)) for n in range(60)] + [job('Chisinau', 'Camarero')] * 2 + [job('Chisinau', 'Piloto')]
        labels = lambda title: ['electrical_mechanical'] if title.startswith('Electricista') else ['service_hotel'] if title == 'Camarero' else []
        asked = {'electrical_mechanical': ['electricista'], 'service_hotel': ['camarero'], 'construction': ['albañil']}
        got = self.by_cells({'a.md': (jobs, 'ok', None)}, labels, asked, searched=['electricista', 'camarero'])
        self.assertEqual(got[0]['family_jobs'], {'electrical_mechanical': 60, 'service_hotel': 2}, 'construction was never searched by its word: not measured, absent, never 0')
        self.assertEqual(scout_boards.proven_families(got[0]), ['electrical_mechanical'], 'two waiters prove no board for hotel work')
        self.assertEqual(scout_boards.facts(self.db)[0]['family_jobs'], got[0]['family_jobs'], 'the publish sends the numbers')

    def test_the_airline_board_with_one_electrician_is_not_proven_for_electricians(self):
        jobs = [job('Chisinau', 'Cabin crew')] * 20 + [job('Chisinau', 'Aircraft electrician')]
        labels = lambda title: ['electrical_mechanical'] if 'electrician' in title else ['service_hotel']
        got = self.by_cells({'airline.md': (jobs, 'ok', None)}, labels, {'electrical_mechanical': ['electrician']}, searched=['electrician'])
        self.assertEqual(got[0]['family_jobs'], {'electrical_mechanical': 1})
        self.assertEqual(scout_boards.proven_families(got[0]), [])

    def test_a_board_that_lists_its_jobs_with_no_search_is_measured_for_every_family_asked(self):
        labels = lambda title: ['kitchen']
        got = self.by_cells({'a.md': ([job('Chisinau', f'Cook {n}') for n in range(4)], 'ok', None)}, labels, {'kitchen': ['cook'], 'nursing_care': ['nurse']}, searched=[],
                            url='https://{host}/jobs')
        self.assertEqual(got[0]['family_jobs'], {'kitchen': 4, 'nursing_care': 0}, 'its list is the board: no nurse in it is a measured zero')

    def test_the_families_whose_word_ran_on_any_board_are_noted_even_when_no_board_is_kept(self):
        """Gitar on #4027: an all-empty pass must still say which families were asked, so the cell queue does not rest the others as misses."""
        asked = {'electrical_mechanical': ['electricista'], 'service_hotel': ['camarero'], 'construction': ['albañil']}
        got = self.by_cells({'a.md': ([job('Berlin')] * 5, 'ok', None)}, lambda title: [], asked, searched=['electricista', 'camarero'])   # nothing local: no fact
        self.assertEqual(got, [])
        self.assertEqual(scout_cells._meta(self.db, 'board_ran', {}), {'md': ['electrical_mechanical', 'service_hotel']}, 'construction\'s word never ran')

    def test_a_pass_by_kinds_of_work_counts_no_family(self):
        got, _, _ = self.run_pass({'a.md': ([job('Chisinau')] * 3, 'ok', None)})
        self.assertNotIn('family_jobs', got[0])

    def test_a_later_pass_replaces_the_count_of_its_family_and_keeps_the_others(self):
        reads = {'a.md': ([job('Chisinau', f'T{n}') for n in range(5)], 'ok', None)}
        self.by_cells(reads, lambda title: ['data_ai'], {'data_ai': ['data']}, searched=['data'])
        self.by_cells(reads, lambda title: ['graphic_design'], {'graphic_design': ['design']}, searched=['design'])
        self.assertEqual(scout_boards.facts(self.db)[0]['family_jobs'], {'data_ai': 5, 'graphic_design': 5})
        self.by_cells(reads, lambda title: ['data_ai'] if title in ('T0', 'T1') else [], {'data_ai': ['data']}, searched=['data'])
        self.assertEqual(scout_boards.facts(self.db)[0]['family_jobs'], {'data_ai': 2, 'graphic_design': 5}, 'the newer count of a family replaces its older one')

    def test_a_fact_kept_before_the_count_is_published_without_one(self):
        scout_boards.ensure(self.db)
        self.db.execute("INSERT INTO scout_board_facts (host, country, url, families, local_jobs, read_at) VALUES ('old.md', 'md', 'https://old.md/?q={role}', 'software_dev', 5, ?)",
                        ('2026-11-13',))
        self.assertNotIn('family_jobs', scout_boards.facts(self.db, today=date(2026, 11, 13))[0])

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
        self.assertIn('not measured (rules could not read the page): a.md, b.md', summary(out))

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
        self.assertIn('a.md 3/3 (read by the AI page reader)', summary(out))

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
        self.assertIn(f'pages {scout_boards.PAGE_CALLS} of {scout_boards.PAGE_CALLS}', summary(out))

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
        return got, summary(out), asked

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

    def test_a_later_pass_for_other_kinds_of_work_keeps_the_kinds_an_earlier_pass_measured(self):
        """13 Nov 2026: Germany's data pass kept a general board at 05:39; the 07:45 pass for photography, video and design read it again and its
        row lost data: a data analyst's first search no longer started on it."""
        reads = {'a.md': ([job('Chisinau')] * 3, 'ok', None)}
        for seen in (['data_ai'], ['graphic_design']):
            with mock.patch.object(scout_boards.pool_tags, 'families_each', lambda titles, seen=seen: ({t: seen for t in titles}, [])):
                scout_boards.run(self.db, ideas=lambda search: [board('a.md')], read_board=lambda item, *a: reads[item['host']], out=lambda line: None,
                                 named='md', google=lambda *a: [])
        self.assertEqual([sorted(f['families']) for f in scout_boards.facts(self.db)], [['data_ai', 'graphic_design']])
        self.db.execute("UPDATE scout_board_facts SET read_at = '2000-01-01'")   # a measurement past FACT_DAYS is not carried: only this pass's kinds
        with mock.patch.object(scout_boards.pool_tags, 'families_each', lambda titles: ({t: ['nursing_care'] for t in titles}, [])):
            scout_boards.run(self.db, ideas=lambda search: [board('a.md')], read_board=lambda item, *a: reads[item['host']], out=lambda line: None,
                             named='md', google=lambda *a: [])
        self.assertEqual([f['families'] for f in scout_boards.facts(self.db)], [['nursing_care']])

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
        self.assertIn('2 boards proposed, 1 with 3+ local jobs; listed/local: a.md 5/4 (no layout: none learned on this read), b.md 0/0', out[-1])
        self.assertTrue(out[-1].startswith('Board pass: Moldova ('))
        self.assertIn('md', scout_cells._meta(self.db, 'boards_aimed', []))   # it counts as done: the rotation moves on

    def test_the_log_says_what_the_kinds_question_got_and_the_right_jobs_per_family(self):
        """13 Nov 2026, sa: "the run log must print right jobs per board and family"; Spain run 43502695338 dropped a 40-job board as "no kinds of work" without saying what was asked."""
        out = []
        reads = {'a.md': [job('Chisinau', title=f'Programmer {n}') for n in range(4)], 'b.md': [job('Chisinau', title=f'Odd title {n}') for n in range(4)]}
        with mock.patch.object(scout_boards.pool_tags, 'families_each', lambda titles: ({t: (['software_dev'] if t.startswith('Programmer') else []) for t in titles}, [])):
            scout_boards.run(self.db, ideas=lambda search: [board(h) for h in reads], read_board=lambda item, *a: (reads[item['host']], 'ok', None), out=out.append, named='md')
        lines = {line.split(':')[1].strip(): line for line in out if line.startswith('Board kinds: ')}
        self.assertIn('4 local jobs, 4 titles asked, 4 job(s) put in a family, 0 title(s) unanswered', lines['a.md'])
        self.assertNotIn('asked, no family', lines['a.md'])
        self.assertIn("0 job(s) put in a family, 0 title(s) unanswered; right jobs per family: none; asked, no family: 'Odd title 0' | 'Odd title 1' | 'Odd title 2' | 'Odd title 3'", lines['b.md'])



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
