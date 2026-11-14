"""Guard: money — the PR's verdict now starts a before/after pair by itself, and a pair takes 2 AI searches per person from the broker (owner via sa, 14 Nov 2026: "I want all the PRs like that, to start the pair by themselves").
Without these tests a verdict could start pairs for PRs outside the search files, for a fork, twice for one head, without a row on the PR's checks, or past 4 starts a day (tools/pr_verdict_pair.py).
Plays publish() against a stub gh that keeps the head's check rows, the run list and the dispatches; fictional PR, no network."""
import importlib.util
import json
import re
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('pr_verdict_pair', ROOT / 'tools' / 'pr_verdict_pair.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
NOW = datetime(2026, 11, 14, 13, 0, tzinfo=timezone.utc)
REPO, SHA, OLD = 'o/r', 'a' * 40, 'b' * 40
MOVES = 'Moves: p3 right jobs 0 → pending (1 run a side, same minute, usual difference 2)\n'


class Gh:
    """A stub `gh`: check rows of the head, pair runs, comments and dispatches; `log` keeps the order of writes and dispatches."""

    def __init__(self, rows=(), runs=(), comments='', compare=None, fail_dispatch=False):
        self.rows, self.runs, self.comments, self.compare, self.fail, self.log, self.dispatched, self.queries = [dict(r) for r in rows], list(runs), comments, compare or {}, fail_dispatch, [], [], []

    @staticmethod
    def fields(args):
        out = {}
        for flag, value in zip(args, args[1:]):
            if flag == '-f':
                out[value.split('=', 1)[0]] = value.split('=', 1)[1]
        return out

    def __call__(self, *args, **kw):
        text = ' '.join(args)
        if args[:2] == ('workflow', 'run'):
            self.log.append('dispatch')
            self.dispatched.append(self.fields(args))
            if self.fail:
                raise RuntimeError('HTTP 403')
            return ''
        if args[:2] == ('run', 'list'):
            return json.dumps(self.runs)
        if 'filter=all' in text:
            return json.dumps([r.get('output[title]', '') for r in self.rows])
        if '/check-runs?per_page=100&check_name=' in text:
            return json.dumps(self.rows[-1:])   # the API's default filter: the latest of that name
        if '/issues/' in text and text.rstrip().endswith('--jq') or '/comments' in text:
            self.queries.append(text)
            return self.comments
        if '/compare/' in text:
            return json.dumps(self.compare)
        if '-X PATCH' in text or '/check-runs' in text:
            f = self.fields(args)
            if '-X' in args:
                row = next(r for r in self.rows if str(r['id']) == args[args.index('-X') + 2].rsplit('/', 1)[1])
                row.update(f)
                if f.get('status') == 'completed':   # GitHub stamps completed_at when a row is closed
                    row['completed_at'] = NOW.isoformat().replace('+00:00', 'Z')
                self.log.append('row updated')
                return '{}'
            row = {'id': 100 + len(self.rows), 'completed_at': NOW.isoformat().replace('+00:00', 'Z') if f.get('status') == 'completed' else None, **f}
            self.rows.append(row)
            self.log.append('row written')
            return json.dumps({'id': row['id']})
        return ''

    def state(self):
        return re.match(r'search-pair:([a-z]+):', self.rows[-1]['external_id']).group(1) if self.rows else None


def pulls(body=MOVES, **over):
    return [{'number': 7, 'state': 'open', 'merged_at': None, 'head_sha': SHA, 'cross_repo': False, 'body': body, **over}]


def play(gh, body=MOVES, files=('src/press/rank.py',), now=NOW, **over):
    return mod.publish(REPO, SHA, pulls(body, **over), None if files is None else list(files), gh, now)


def run_of(minutes_ago, status='completed', number=7, again=False):
    return {'displayTitle': f'Search pair · #{number} · [3] · app tier' + (' · again' if again else ''), 'status': status, 'createdAt': (NOW - timedelta(minutes=minutes_ago)).isoformat().replace('+00:00', 'Z')}


class TheVerdictStartsThePair(unittest.TestCase):
    def test_a_search_change_with_a_pending_line_gets_its_row_first_and_then_one_dispatch_that_claims_the_row(self):
        gh = Gh()
        self.assertEqual(play(gh), 'start')
        self.assertEqual(gh.log, ['row written', 'dispatch'], 'the row is on the PR before the dispatch: a failed dispatch never leaves a PR with no row')
        self.assertEqual(gh.state(), 'waiting')
        self.assertEqual(json.loads(gh.dispatched[0]['people']), [3])
        self.assertEqual(gh.dispatched[0]['check_id'], str(gh.rows[0]['id']), 'the pair claims this row, so one row exists per head')

    def test_the_same_head_is_started_once_whatever_the_number_of_verdicts(self):
        gh = Gh()
        play(gh)
        gh.runs = [run_of(0, 'queued')]   # the dispatch is listed
        for _ in range(3):
            self.assertEqual(play(gh), 'none')
        self.assertEqual(len(gh.dispatched), 1)
        gh.runs, gh.rows[-1]['external_id'] = [], 'search-pair:counted:3:1'   # numbers on this head: its row stands, a reopen or a sweep adds nothing
        self.assertEqual(play(gh), 'none')
        self.assertEqual(len(gh.dispatched), 1)

    def test_a_waiting_row_with_no_pair_on_its_way_is_started_again_but_not_while_a_pair_is_listed(self):
        gh = Gh(rows=[{'id': 1, 'external_id': 'search-pair:waiting:3:', 'completed_at': None}], runs=[run_of(40)])   # an old, finished run only: nothing is on its way
        self.assertEqual(play(gh), 'start')
        self.assertEqual(len(gh.dispatched), 1)
        self.assertEqual(gh.dispatched[0]['check_id'], '1', 'the row that exists is the one claimed, no second row')
        self.assertEqual(len(gh.rows), 1)

    def test_no_search_file_no_row_no_pair(self):
        gh = Gh()
        self.assertEqual(play(gh, files=['docs/readme.md', 'tools/ship.sh']), 'none')
        self.assertEqual((gh.log, gh.queries), ([], []))

    def test_a_fork_pr_a_replaced_head_and_a_closed_pr_get_nothing(self):
        for over in ({'cross_repo': True}, {'head_sha': OLD}, {'state': 'closed'}, {'merged_at': '2026-11-14T12:00:00Z'}):
            gh = Gh()
            self.assertEqual(play(gh, **over), 'none', over)
            self.assertEqual(gh.log, [], over)
        self.assertEqual(play(Gh(), files=None), 'none', 'a file list that was not read starts nothing')

    def test_a_dispatch_that_fails_says_so_on_the_row_and_is_tried_again_only_after_3_minutes(self):
        gh = Gh(fail_dispatch=True)
        self.assertEqual(play(gh), 'start')
        self.assertEqual(gh.log, ['row written', 'dispatch', 'row updated'])
        self.assertIn('pair not started', gh.rows[-1]['output[title]'])
        self.assertIn('gh workflow run', gh.rows[-1]['output[summary]'], 'the row says the command to run by hand')
        self.assertEqual(play(gh, now=NOW + timedelta(minutes=1)), 'none')
        self.assertEqual(len(gh.dispatched), 1, 'one try per 3 minutes, not one per verdict')
        gh.fail = False
        self.assertEqual(play(gh, now=NOW + timedelta(minutes=4)), 'start')
        self.assertEqual(len(gh.dispatched), 2)

    def test_a_quota_that_stays_out_stops_after_the_cap_not_every_3_minutes(self):
        """Gitar on #4212: a failed dispatch makes no run, so only the run list counted starts and the retry never stopped."""
        gh, minute = Gh(fail_dispatch=True), 0
        for _ in range(12):
            play(gh, now=NOW + timedelta(minutes=minute))
            minute += 4
        self.assertEqual(len(gh.dispatched), mod.CAP[0], 'one try per 3 minutes up to the cap, then the row says "pair limit" and nothing is dispatched')
        self.assertIn('pair limit', gh.rows[-1]['output[title]'])
        self.assertIn('gh workflow run', gh.rows[-1]['output[summary]'])

    def test_four_starts_in_a_day_is_the_cap_and_the_row_says_how_to_start_by_hand(self):
        gh = Gh(runs=[run_of(60 * k + 10) for k in range(4)])
        self.assertEqual(play(gh), 'capped')
        self.assertEqual(gh.dispatched, [])
        self.assertIn('pair limit', gh.rows[-1]['output[title]'])
        self.assertIn('gh workflow run', gh.rows[-1]['output[summary]'])
        reruns = Gh(runs=[run_of(60 * k + 10, again=bool(k % 2)) for k in range(4)])   # 2 starts and the pair's own 2 second runs: the cap counts heads started
        self.assertEqual(play(reruns), 'start')
        other = Gh(runs=[run_of(60 * k + 10, number=8) for k in range(4)] + [run_of(26 * 60)])   # another PR's pairs and one over a day old do not count
        self.assertEqual(play(other), 'start')

    def test_moves_nothing_is_green_with_its_why_and_starts_no_pair(self):
        gh = Gh()
        self.assertEqual(play(gh, body='Moves: nothing (a log line only)\n'), 'nothing')
        self.assertEqual((gh.state(), gh.rows[-1]['conclusion'], gh.dispatched), ('nothing', 'success', []))

    def test_no_people_named_asks_for_them_and_says_it_once(self):
        gh = Gh()
        self.assertEqual(play(gh, body='A change.\n'), 'needed')
        self.assertIn("name the people", gh.rows[-1]['output[title]'])
        self.assertEqual(gh.dispatched, [])
        self.assertEqual(play(gh, body='A change.\n', now=NOW + timedelta(minutes=5)), 'needed')
        self.assertEqual(len(gh.rows), 1, 'the same words are not written twice')
        self.assertEqual(play(gh, now=NOW + timedelta(minutes=6)), 'start', 'the person adds the line: the next check starts the pair')


class ALaterHeadKeepsOrRemeasures(unittest.TestCase):
    META = f'<!-- search-pair -->\n### Before/after\n\n<!-- search-pair-meta {json.dumps({"sha": OLD, "people": ["p3"]})} -->\n'

    def test_a_head_that_changed_no_search_file_carries_the_numbers_and_starts_nothing(self):
        gh = Gh(comments=self.META, compare={'status': 'ahead', 'count': 2, 'files': ['docs/a.md', 'tools/x.sh']},
                rows=[])
        self.assertEqual(play(gh, body='A change, numbers written.\n'), 'carry')
        self.assertEqual((gh.state(), gh.rows[-1]['conclusion'], gh.dispatched), ('carried', 'neutral', []))
        self.assertIn(OLD[:7], gh.rows[-1]['output[title]'])

    def test_a_head_that_changed_a_search_file_measures_the_same_people_again(self):
        gh = Gh(comments=self.META, compare={'status': 'ahead', 'count': 1, 'files': ['src/press/rank.py']})
        self.assertEqual(play(gh, body='A change, numbers written.\n'), 'start')
        self.assertEqual(json.loads(gh.dispatched[0]['people']), [3])

    def test_every_doubt_about_the_compare_counts_as_changed(self):
        for compare in ({}, {'status': 'diverged', 'count': 1, 'files': ['docs/a.md']}, {'status': 'ahead', 'count': 400, 'files': ['docs/a.md']}, {'status': 'ahead', 'count': 0, 'files': []}):
            gh = Gh(comments=self.META, compare=compare)
            self.assertEqual(play(gh, body='A change.\n'), 'start', compare)

    def test_only_the_workflows_own_comment_is_read(self):
        gh = Gh(comments=self.META, compare={'status': 'ahead', 'count': 1, 'files': ['docs/a.md']})
        play(gh, body='A change.\n')
        self.assertTrue(any('github-actions[bot]' in q for q in gh.queries), 'a PR author could post a comment that starts like the pair comment and forge its line')

    def test_the_people_a_comment_names_are_only_ids_of_the_fixed_shapes(self):
        forged = '<!-- search-pair -->\n<!-- search-pair-meta {"sha": "%s", "people": ["p3", "; rm -rf", "b02", "x" , "p99999"]} -->\n' % OLD
        gh = Gh(comments=forged, compare={'status': 'ahead', 'count': 1, 'files': ['src/press/rank.py']})
        play(gh, body='A change.\n')
        self.assertEqual(json.loads(gh.dispatched[0]['people']), [3, 'b02'])


class WhatThePairCommentWritesIsWhatTheStarterReads(unittest.TestCase):
    def test_the_comments_meta_line_round_trips_to_the_head_and_the_people(self):
        pair_spec = importlib.util.spec_from_file_location('pair_for_test', ROOT / 'tools' / 'persona-search' / 'pair.py')
        import sys
        sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
        pair = importlib.util.module_from_spec(pair_spec)
        pair_spec.loader.exec_module(pair)
        with tempfile.TemporaryDirectory() as folder:
            for person, side in (('p3--one', 'main'), ('p3--two', 'pr'), ('b02--one', 'main'), ('b02--two', 'pr')):
                Path(folder, person).mkdir()
                Path(folder, person, 'side.json').write_text(json.dumps({'side': side, 'right': 3, 'found': 10, 'first_s': '4', 'words': [], 'calls': 4, 'failed': 0, 'valid': True}))
            text = pair.table(folder, '7', OLD, SHA, spread=lambda person: 2)
        gh = Gh(comments=text)
        found = mod.last_pair(gh, REPO, 7)
        self.assertEqual(found, {'sha': SHA, 'people': ['b02', 'p3']})
        self.assertEqual(mod.people_of(pair, 'no pending line', found), ['b02', 3], 'night people go back as numbers, profiles as ids: the dispatch form')


class TheJobChecksOutWhatTheStarterReads(unittest.TestCase):
    def test_the_verdict_workflow_has_every_file_the_starter_loads_and_may_dispatch(self):
        text = (ROOT / '.github' / 'workflows' / 'pr-verdict.yml').read_text()
        listed = text.split('\n  verdict:\n', 1)[1].split('sparse-checkout: |', 1)[1].split('sparse-checkout-cone-mode', 1)[0]
        for name in ('tools/pr_verdict_pair.py', 'tools/pr-body-check.py', 'tools/persona-search/pair.py', 'tools/persona-search/pair_row.py', 'tools/persona-search/engine_calls.py'):
            self.assertIn(name, listed, f'{name}: without it the starter fails to load on the runner and no pair ever starts (a standalone copy would be fetched over the API on every write)')
        self.assertRegex(text.split('\n  verdict:\n', 1)[1].split('steps:', 1)[0], r'actions: write', 'the dispatch of search-pair.yml needs actions: write on the one verdict job')


class TheNothingLineIsThePrBodyChecksOwn(unittest.TestCase):
    def test_only_a_line_the_pr_body_check_accepts_counts_and_a_missing_why_does_not(self):
        check = mod.modules()[2]
        self.assertTrue(mod.says_nothing(check, 'A change.\n\nMoves: nothing (a log line only)\n'))
        self.assertTrue(mod.says_nothing(check, '- **Moves:** nothing (a log line only)\n'))
        self.assertFalse(mod.says_nothing(check, 'Moves: nothing ()\n'), 'the check refuses an empty why: so does this')
        self.assertFalse(mod.says_nothing(check, 'We said Moves: p3 right jobs 1 → 2 (1 run a side, same minute, usual difference 2)\n'))
        self.assertFalse(mod.says_nothing(check, ''))


class TheSecondRunSaysSo(unittest.TestCase):
    def test_the_pairs_own_second_run_is_named_so_the_cap_does_not_count_it(self):
        line = re.search(r'(?m)^run-name: (.*)$', (ROOT / '.github' / 'workflows' / 'search-pair.yml').read_text()).group(1)
        self.assertIn("${{ inputs.attempt == '2' && ' · again' || '' }}", line, 'pr_verdict_pair.pairs_of reads this ending; GitHub expressions: an empty string is falsy, so the true side is the non-empty one')
        self.assertTrue(line.startswith('"Search pair · #${{ inputs.pr }} '), 'the run list is read by this start')


class TheDecisionIsPure(unittest.TestCase):
    BASE = dict(reach=True, row=None, last=None, delta=None, nothing=False, people=[3], starts=0, head=SHA)

    def test_each_verdict_in_the_order_the_design_says(self):
        d = lambda **o: mod.decide(**{**self.BASE, **o})[0]
        self.assertEqual(d(reach=False), 'none')
        self.assertEqual(d(row='counted'), 'none')
        self.assertEqual(d(row='waiting', busy=True), 'none')
        self.assertEqual(d(row='unnamed', busy=True), 'none')
        self.assertEqual(d(row='unnamed'), 'start')
        self.assertEqual(d(people=[], nothing=True), 'nothing')
        self.assertEqual(d(people=[]), 'needed')
        self.assertEqual(d(starts=4), 'capped')
        self.assertEqual(d(last={'sha': OLD, 'people': ['p3']}, delta=(True, False)), 'carry')
        self.assertEqual(d(last={'sha': OLD, 'people': ['p3']}, delta=(True, True)), 'start')


if __name__ == '__main__':
    unittest.main()
