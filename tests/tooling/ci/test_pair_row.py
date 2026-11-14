"""Guard: release — the "Search before/after" row decides whether a search PR looks safe to merge (3/3 makes "All checks passed" read it): a wrong band reds honest PRs or greens a loss,
and a pair that did not count must never read green (owner via sa, 13 Nov 2026: "instead of having \"DONT MERGE\"... we'll just have red check")."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'tools' / 'persona-search'))
import pair_row  # noqa: E402


def moves(before, after):
    return {'before': before, 'after': after, 'd': None, 'line': ''}


def rows(**sides):
    return {person: {'main': [{'valid': True, 'shared': True, 'wait_p90_ms': 1000}], 'pr': [{'valid': True, 'shared': True, 'wait_p90_ms': 1000}]} for person in sides}


class TheRow(unittest.TestCase):
    def test_a_loss_beyond_the_band_is_red_with_the_person_and_the_numbers_and_the_way_out(self):
        out = pair_row.decide({'c04': moves(15, 5)}, ['c04'], {'c04'}, {'c04': None}, 1, rows(c04=1))
        self.assertEqual(out['conclusion'], 'failure')
        self.assertIn('c04 15 → 5', out['title'])
        self.assertIn('ruleset override', out['summary'])

    def test_run_43498213279s_same_code_spread_of_7_is_not_a_loss(self):
        out = pair_row.decide({'c04': moves(15, 8)}, ['c04'], {'c04'}, {'c04': None}, 1, rows(c04=1))   # 8 vs 15, the same code both sides
        self.assertEqual(out['conclusion'], 'success')
        self.assertIn('within ±7, not a proven gain', out['title'])

    def test_the_band_is_never_below_the_same_minute_noise_floor(self):
        """Gitar on #4114: the night's across-days spread (1-2 jobs for a steady person) is not the main-vs-PR noise of one minute: run 43498213279 gave 8 vs 15 for the same code, and 13 Nov 2026's
        c04 gave 17 / 15 / 36 on the same code in three same-minute rounds."""
        verdict = lambda before, after, spread: pair_row.decide({'p3': moves(before, after)}, ['p3'], {'p3'}, {'p3': spread}, 1, rows(p3=1))['conclusion']   # noqa: E731
        self.assertEqual(verdict(10, 6, 1), 'success', 'lost 4 with spread 1: inside the floor of 7')
        self.assertEqual(verdict(10, 3, 1), 'success', 'lost 7 = the floor, not beyond it')
        self.assertEqual(verdict(10, 2, 1), 'failure', 'positive control: lost 8 is beyond the floor')
        self.assertEqual(verdict(30, 19, 10), 'failure', 'a measured spread above the floor still sets the band (lost 11 > 10)')
        self.assertEqual(verdict(30, 21, 10), 'success')

    def test_a_gain_beyond_the_band_says_so(self):
        out = pair_row.decide({'c15': moves(5, 20)}, ['c15'], {'c15'}, {'c15': None}, 1, rows(c15=1))
        self.assertIn('gain beyond ±7', out['title'])

    def test_a_pair_that_did_not_count_runs_once_more_then_stays_pending_never_red_or_green(self):
        flat = {'b10': {'main': [{'valid': False, 'shared': False}], 'pr': [{'valid': False, 'shared': False}]}}
        first = pair_row.decide({}, ['b10'], {'b10'}, {}, 1, flat)
        self.assertEqual((first['conclusion'], first['rerun']), ('pending', ['b10']))
        self.assertIn('boards not shared', first['title'])
        second = pair_row.decide({}, ['b10'], {'b10'}, {}, 2, flat)
        self.assertEqual((second['conclusion'], second['rerun']), ('pending', []))   # sa, 13 Nov 2026: a stalled call is not a loss, never red
        self.assertTrue(second['title'].startswith('not counted: b10'))
        self.assertIn('run it again', second['title'])
        self.assertNotIn('failure', (first['conclusion'], second['conclusion']))
        self.assertIn('run the pair by hand', first['summary'])   # #4103: an unowned second run that never starts is closed by a pair by hand, and the row says so
        self.assertNotIn('running once more', first['title'])

    def test_a_person_who_never_searched_is_not_run_again_but_says_run_it_again(self):   # Gitar on #4065 and #3967: the turn found no room; a second long wait is not queued
        out = pair_row.decide({'c04': moves(15, 14)}, ['c04', 'b10'], {'c04'}, {'c04': None}, 1, rows(c04=1))
        self.assertEqual((out['conclusion'], out['rerun']), ('pending', []))
        self.assertIn('run it again', out['title'])

    def test_three_people_all_fit_in_the_title_which_is_all_the_checks_list_shows(self):   # Gitar on #4077
        done = {p: moves(15, 14) for p in ('c04', 'c10', 'c15')}
        out = pair_row.decide(done, list(done), set(done), {p: None for p in done}, 1, rows(c04=1, c10=1, c15=1))
        self.assertEqual(out['conclusion'], 'success')
        self.assertLessEqual(len(out['title']), 140)
        for person in done:
            self.assertIn(f'{person} 15 → 14', out['title'])

    def test_the_second_run_keeps_the_first_runs_counted_lines_in_front(self):   # Gitar on #4059: the re-run counts only the missing people, the row must still show the first run's
        first = 'c04 15 → 14 right jobs (one run a side, within the usual difference of 7: not a proven gain)'
        out = pair_row.decide({'b10': moves(2, 9)}, ['b10'], {'b10'}, {'b10': None}, 2, rows(b10=1), earlier=[first])
        self.assertEqual(out['conclusion'], 'success')
        self.assertTrue(out['summary'].startswith(first))
        self.assertIn('b10 2 → 9', out['title'])

    def test_a_newer_head_makes_the_old_row_grey_and_runs_nothing(self):
        out = pair_row.decide({'c04': moves(15, 5)}, ['c04'], {'c04'}, {}, 1, rows(c04=1), newer_head=True)
        self.assertEqual((out['conclusion'], out['rerun']), ('neutral', []))

    def test_a_loss_is_red_even_when_another_person_did_not_count(self):
        out = pair_row.decide({'c04': moves(15, 5)}, ['c04', 'b10'], {'c04', 'b10'}, {}, 1, rows(c04=1, b10=1))
        self.assertEqual((out['conclusion'], out['rerun']), ('failure', []))   # a loss is never run again

    def test_the_clock_text_names_when_it_started_and_about_when_it_ends(self):
        self.assertEqual(pair_row.running('20:29', 'running'), 'running since 20:29Z, ends ~20:40Z')
        self.assertEqual(pair_row.ends('23:55'), '00:06Z')


def row_of(state, owner='7', people=('c04',), summary=''):
    return {'external_id': pair_row.external_id(state, people, owner), 'summary': summary}


def ev(kind, **more):
    base = {'run_id': '7', 'run_url': 'u', 'comment_url': 'c', 'started': '20:29', 'now': 'n', 'people': ['c04'], 'claim': False, 'ended': 'failure', 'newer': False,
            'done': {'c04': moves(15, 14)}, 'ran': ['c04'], 'seen': {'c04'}, 'spreads': {'c04': None}, 'rows': rows(c04=1), 'rerun_failed': False}
    return {**base, 'kind': kind, **more}


def after(old, event):
    out = pair_row.next_row(old, event)
    return 'noop' if out['noop'] else out['state']


class TheRowsStatesHaveOneWriter(unittest.TestCase):
    """The table at the top of pair_row.py, as a test: every state meets every event, and the result is the one the table says (Design, 13 Nov 2026; sa: no more patch-by-case)."""
    def test_the_table(self):
        none = {}
        table = [   # (old row, event) -> the new state, or noop
            (none, ev('started'), 'running'), (none, ev('started', claim=True), 'noop'),
            (row_of('waiting', ''), ev('started', claim=True), 'running'), (row_of('waiting', ''), ev('started'), 'running'),
            (row_of('unproven', ''), ev('started'), 'running'), (row_of('unproven', ''), ev('started', claim=True), 'noop'),
            (row_of('running', '3'), ev('started'), 'noop'), (row_of('running', '3'), ev('started', claim=True), 'noop'),   # another pair holds it
            (row_of('rerunning', ''), ev('started', claim=True), 'rerunning'), (row_of('rerunning', ''), ev('started'), 'rerunning'),   # asked, nobody started it
            (row_of('rerunning', '3'), ev('started'), 'noop'), (row_of('rerunning', '3'), ev('started', claim=True), 'noop'),   # owned: a second dispatched run does not take it
            (row_of('running'), ev('died', ended='failure', newer=True), 'superseded'),   # any death on an old head is superseded (the table), not "run it again"
            (row_of('running'), ev('searching'), 'running'), (row_of('rerunning'), ev('searching'), 'rerunning'),
            (row_of('running'), ev('ended'), 'counted'), (row_of('running'), ev('died'), 'unproven'),
            (row_of('running'), ev('died', ended='cancelled', newer=True), 'superseded'), (row_of('running'), ev('died', ended='cancelled', newer=False), 'unproven'),
            (row_of('running'), ev('ended', newer=True), 'superseded'),
            (row_of('running'), ev('ended', done={}, rows=rows(c04=1)), 'rerunning'),   # not counted, a side ran: once more
            (row_of('running'), ev('ended', done={}, seen=set(), rows={}), 'unproven'),   # never searched: not run again (#3967)
            (row_of('running'), ev('ended', done={}, rerun_failed=True), 'unproven'),
            (row_of('rerunning'), ev('ended', done={}), 'unproven'),   # never a third
            (row_of('running', '3'), ev('ended'), 'noop'), (row_of('running', '3'), ev('died'), 'noop'),   # another run's row
            (row_of('waiting', ''), ev('ended'), 'noop'), (row_of('unproven', ''), ev('died'), 'noop'),
        ]
        for old, event, want in table:
            self.assertEqual(after(old, event), want, (old['external_id'] if old else 'no row', event['kind']))

    def test_a_finished_row_is_never_rewritten_by_the_pair_runs_only_a_new_pair_gets_a_new_row(self):
        for state in pair_row.FINISHED:
            old = row_of(state)
            for kind in ('ended', 'died', 'searching'):
                self.assertEqual(after(old, ev(kind)), 'noop', (state, kind))
            self.assertEqual(after(old, ev('started', claim=True)), 'noop', state)
            out = pair_row.next_row(old, ev('started'))
            self.assertEqual((out['state'], out['new']), ('running', True), state)

    def test_the_start_workflows_events_never_touch_a_pair_in_flight_nor_repeat_themselves(self):
        waiting = {'kind': 'opened', 'verdict': 'waiting', 'people': ['c04'], 'title': 't', 'summary': 's'}
        self.assertEqual(after({}, waiting), 'waiting')
        self.assertEqual(after(row_of('waiting', '', ('c04',)), waiting), 'noop')   # a body edit with the same people
        self.assertEqual(after(row_of('waiting', '', ('b10',)), waiting), 'waiting')   # other people: the same queued row, rewritten
        self.assertEqual(after(row_of('running'), waiting), 'noop')
        self.assertEqual(after(row_of('counted'), {**waiting, 'people': ['b10']}), 'waiting')   # a new row beside the finished one
        self.assertTrue(pair_row.next_row(row_of('counted'), {**waiting, 'people': ['b10']})['new'])
        self.assertEqual(after({}, {**waiting, 'verdict': 'unnamed', 'people': []}), 'unnamed')
        self.assertEqual(pair_row.next_row({}, {**waiting, 'verdict': 'nothing', 'people': []})['api']['conclusion'], 'success')
        self.assertEqual(after({}, {'kind': 'carried', 'people': ['c04'], 'conclusion': 'success', 'title': 't', 'summary': 's'}), 'carried')

    def test_people_in_the_external_id_are_sorted_so_a_reordered_moves_line_is_the_same_row(self):
        self.assertEqual(pair_row.external_id('waiting', [3, 'c04']), pair_row.external_id('waiting', ['c04', 3]))
        self.assertEqual(pair_row.parse_external_id('search-pair:running:3,c04:99'), ('running', ['3', 'c04'], '99'))
        self.assertEqual(pair_row.parse_external_id('something else'), (None, [], ''))

    def test_the_whole_story_of_a_pair_that_does_not_count_then_counts(self):
        out = pair_row.next_row({}, ev('started', run_id='1'))
        self.assertTrue(out['new'])
        row = {'external_id': out['api']['external_id'], 'summary': out['api']['output']['summary']}
        first = pair_row.next_row(row, ev('ended', run_id='1', done={}))
        self.assertEqual((first['state'], first['rerun']), ('rerunning', ['c04']))
        second_start = pair_row.next_row({'external_id': first['api']['external_id'], 'summary': first['api']['output']['summary']}, ev('started', run_id='2', claim=True))
        self.assertEqual(second_start['state'], 'rerunning')
        second = pair_row.next_row({'external_id': second_start['api']['external_id'], 'summary': second_start['api']['output']['summary']}, ev('ended', run_id='2', done={}))
        self.assertEqual((second['state'], second['rerun'], second['api']['status']), ('unproven', [], 'in_progress'))   # never red, never green
        self.assertIn('run it again', second['api']['output']['title'])

    def test_a_failed_second_dispatch_says_so_and_asks_for_nothing(self):
        out = pair_row.next_row(row_of('running'), ev('ended', done={}, rerun_failed=True))
        self.assertEqual((out['state'], out['rerun']), ('unproven', []))
        self.assertIn('second run did not start', out['api']['output']['title'])

    def test_the_second_runs_numbers_keep_the_first_runs_counted_lines(self):
        first = 'c04 15 → 14 right jobs (one run a side, within the usual difference of 7: not a proven gain)'
        out = pair_row.next_row(row_of('rerunning', '7', ('b10', 'c04'), summary=first + '\nnot counted: b10'), ev('ended', people=['b10'], ran=['b10'], done={'b10': moves(2, 9)}, rows=rows(b10=1), seen={'b10'}))
        self.assertIn('c04 15 → 14', out['api']['output']['summary'])
        self.assertIn('b10 2 → 9', out['api']['output']['title'])

class TheRowsPageLinksTheRun(unittest.TestCase):
    """Owner on #4187, 14 Nov 2026: "I don't see the actual run". GitHub ignores details_url for a check run the github-actions app creates (read back: its own page), so the summary is the link."""
    URL = 'https://github.com/o/r/actions/runs/43601353056'

    def test_the_summary_opens_with_a_link_to_the_run_for_every_event_that_names_it(self):
        started = pair_row.next_row({}, {'kind': 'started', 'run_id': '1', 'run_url': self.URL, 'started': '13:50', 'now': '2026-11-14T13:50:00Z', 'people': [3], 'claim': False})
        self.assertEqual(started['api']['output']['summary'].splitlines()[0], f'[Open the search run]({self.URL})')
        old = {'id': 7, 'external_id': started['api']['external_id'], 'summary': started['api']['output']['summary']}
        died = pair_row.next_row(old, {'kind': 'died', 'run_id': '1', 'run_url': self.URL, 'ended': 'cancelled', 'newer': True})
        text = died['api']['output']['summary']
        self.assertEqual(text.splitlines()[0], f'[Open the search run]({self.URL})')
        self.assertEqual(text.count('[Open the search run]('), 1, 'a link already first is replaced, never doubled')


if __name__ == '__main__':
    unittest.main()
