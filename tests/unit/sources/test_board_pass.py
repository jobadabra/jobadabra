"""Fictional answer-store fixtures for the split's board-pass accounting API, with no search or model calls."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest import mock

from src import geo
from src.ai import place_triage
from src.sources import board_pass, feeds


def board():
    """Three fictional board jobs, two sharing a town."""
    return [{'title': title, 'location': town, 'url': f'https://board.example.test/job/{n}'}
            for n, (title, town) in enumerate([('Known role', 'Known town'), ('Late role 0', 'Late town'), ('Late role 1', 'Late town')])]


class BoardPassAccounting(unittest.TestCase):
    def setUp(self):
        tmp = Path(self.enterContext(TemporaryDirectory()))
        for target, name, value in ((feeds, '_SEARCH', {}), (feeds, 'PLACED', {}), (feeds, 'TRIAGED', {}), (feeds, 'READ', {}),
                                    (geo, 'STORE', tmp / 'geo.json'), (place_triage, 'STORE', tmp / 'places.json')):
            self.enterContext(mock.patch.object(target, name, value))
        self.jobs = board()
        self.track = board_pass.Track()
        self.track.plan = (self.jobs, self.jobs[1:], 100)

    def test_a_repeated_url_is_read_and_counted_once(self):
        feeds.placed().update({'known town': 'in', 'late town': 'out:vague'})
        feeds._triaged().update({'known role': True, 'late role 0': False})
        with mock.patch.object(feeds, 'place_of', wraps=feeds.place_of) as places, mock.patch.object(feeds, 'judged_title', wraps=feeds.judged_title) as titles:
            measured = board_pass.counts(self.jobs + [dict(self.jobs[0])], self.jobs[1:], {self.jobs[0]['url']})
        self.assertEqual((places.call_count, titles.call_count), (3, 3))
        self.assertEqual([measured[key] for key in ('owed', 'listed', 'refused', 'waiting', 'posting not read', 'no answer by the deadline')], [3, 1, 1, 1, 1, 0])
        self.assertEqual((measured['places'], measured['titles'], measured['got']), (1, 3, (0, 2)))
        self.assertEqual(measured['boards']['board.example.test']['titles asked'], 3)

    def test_both_reports_include_a_job_listed_before_the_handover(self):
        feeds.placed().update({'known town': 'in', 'late town': 'in'})
        feeds._triaged().update({feeds.title_key(job['title']): True for job in self.jobs})
        done = board_pass.cut(self.track)
        with mock.patch.object(board_pass, 'counts', wraps=board_pass.counts) as measure:
            settled, lines = done.report({job['url'] for job in self.jobs})
        self.assertEqual(measure.call_count, 1)
        self.assertEqual(set(settled), {job['url'] for job in self.jobs})
        self.assertIn('owed 3 · listed 3 · refused 0 · waiting 0', lines[0])
        self.assertIn('answered 1 of 1 place(s), 3 of 3 title(s) by the deadline, listed 3', lines[1])

    def test_a_vague_place_waits_for_a_posting_even_with_a_yes_title(self):
        job = self.jobs[1]
        self.track.plan = ([job], [job], 100)
        feeds.placed()['late town'] = 'out:vague'
        feeds._triaged()['late role 0'] = True
        done = board_pass.cut(self.track)
        self.assertEqual(done.got, (0, 1))
        self.assertEqual(board_pass.listable(done), [])
        self.assertEqual(board_pass.settled(done, set()), [])
        settled, lines = done.report(set())
        self.assertEqual(settled, [])
        self.assertIn('waiting 1 (posting not read 1 · no answer by the deadline 0)', lines[0])

    def test_outside_is_final_only_when_the_result_has_ended(self):
        job = self.jobs[1]
        self.track.plan = ([job], [job], 100)
        feeds.placed()['late town'] = 'out'
        cut = board_pass.cut(self.track)
        self.assertEqual(board_pass.settled(cut, set()), [])
        ended = board_pass.Done(cut.answered, 100, 1, 1, None, owed=[job], unplaced=[job])
        self.assertEqual(board_pass.settled(ended, set()), [job['url']])
        feeds.placed()['late town'] = 'out:vague'
        feeds._triaged()['late role 0'] = False
        self.assertEqual(board_pass.settled(cut, set()), [job['url']], 'title no is final even at a vague place')

    def test_no_plan_and_empty_or_linkless_input_cannot_invent_work(self):
        self.assertIsNone(board_pass.cut(board_pass.Track()))
        measured = board_pass.counts([{'title': 'Unlinked', 'location': 'Unknown'}])
        self.assertEqual([measured[key] for key in ('owed', 'listed', 'refused', 'waiting', 'places', 'titles')], [0] * 6)
        self.assertEqual(measured['answered'], [])
        self.assertEqual(board_pass.Done([], 0, 0, 0, 'no jobs').report(set()), ([], ['Board pass: not run: no jobs']))

    def test_unanswered_jobs_remain_waiting_and_a_second_read_does_not_mutate_a_snapshot(self):
        first = board_pass.counts(self.jobs, self.jobs[1:])
        self.assertEqual((first['waiting'], first['got']), (3, (0, 0)))
        feeds.placed()['late town'] = 'in'
        feeds._triaged()['late role 0'] = False
        second = board_pass.counts(self.jobs, self.jobs[1:])
        self.assertEqual((second['refused'], second['waiting']), (1, 2))
        self.assertEqual((first['waiting'], first['got']), (3, (0, 0)))

    def test_settlement_and_reports_share_the_full_plan_after_partial_answers(self):
        done = board_pass.cut(self.track)
        self.assertEqual(done.answered, [], 'the result predates every answer')
        listed = {self.jobs[0]['url'], 'https://other.example.test/unrelated'}
        self.assertEqual(board_pass.settled(done, listed), [self.jobs[0]['url']])
        self.assertEqual(board_pass.settled(done, listed), done.report(listed)[0])
        feeds._triaged()['late role 0'] = False
        self.assertEqual(board_pass.settled(done, listed), [self.jobs[0]['url'], self.jobs[1]['url']])
        self.assertEqual(board_pass.settled(done, listed), done.report(listed)[0], 'late refusals also agree')

    def test_place_counts_use_the_answer_stores_normalized_key(self):
        jobs = [{**self.jobs[0], 'location': where, 'url': f'https://board.example.test/variant/{n}'}
                for n, where in enumerate(('Known Town', 'known town', '  KNOWN   TOWN  ', '   '))]
        feeds.placed()[place_triage.norm('Known Town')] = 'in'
        measured = board_pass.counts(jobs, jobs)
        self.assertEqual((measured['places'], measured['got'][0]), (1, 1), 'one stored place answer, not three spellings or an empty key')

    def test_title_totals_use_the_same_key_as_the_title_answer_store(self):
        jobs = [{**self.jobs[0], 'title': title, 'url': f'https://board.example.test/title/{n}'}
                for n, title in enumerate(('Known Role', 'known role', '  KNOWN   ROLE  '))]
        feeds._triaged()[feeds.title_key('Known Role')] = True
        measured = board_pass.counts(jobs)
        self.assertEqual((measured['titles'], measured['got'][1]), (1, 1), 'one title answer covers all three spellings')
