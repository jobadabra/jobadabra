"""One Jobs row per posting when the same job is listed under several links (src/desktop_job_copies.py, owner's pick 5 Nov 2026: "Yes + marks every copy")."""
import sqlite3
import unittest
from unittest import mock

from src import desktop
from src.desktop_job_copies import merge_copies


def row(url, fit=70, **kw):
    return {'url': url, 'title': kw.pop('title', 'Senior Infrastructure Engineer'), 'company': kw.pop('company', 'Glacier Labs'), 'location': kw.pop('location', 'Lausanne'),
            'status': kw.pop('status', 'unreviewed'), 'fit': fit, 'rank': fit, 'origin': kw.pop('origin', 'outbound'), 'stage': kw.pop('stage', None), **kw}


class MergeCopiesTests(unittest.TestCase):
    def test_the_same_posting_on_two_boards_is_one_row_that_names_the_other_board(self):
        merged = merge_copies([row('https://www.jobs.ch/a', 72), row('https://www.jobup.ch/b', 74)])
        self.assertEqual(len(merged), 1)
        self.assertEqual((merged[0]['url'], merged[0]['fit'], merged[0]['also_on']), ('https://www.jobup.ch/b', 74, ['jobs.ch']))   # the best fit's own link stays the row's link
        self.assertEqual(merged[0]['copies'], ['https://www.jobup.ch/b', 'https://www.jobs.ch/a'])

    def test_look_alikes_on_one_site_stay_separate_postings(self):
        # Four "Vendeur, Lausanne" openings at one retailer are four jobs; only the posting text could tell a repost from a second opening.
        self.assertEqual(len(merge_copies([row('https://www.jobup.ch/1'), row('https://www.jobup.ch/2')])), 2)
        self.assertEqual(len(merge_copies([row('https://www.jobup.ch/1'), row('https://www.jobup.ch/2'), row('https://www.jobs.ch/1')])), 3)

    def test_two_applications_are_never_merged(self):
        rows = [row('https://a.example/1', status='applied', stage='Applied'), row('https://b.example/1', status='applied', stage='Applied')]
        self.assertEqual(len(merge_copies(rows)), 2)
        self.assertEqual(len(merge_copies([rows[0], row('https://b.example/2')])), 1)   # one application and an unread copy of it: one row, the application

    def test_spelling_noise_does_not_hide_a_copy(self):
        merged = merge_copies([row('https://a.example/1', company='Glacier  Labs SA', title='Senior Infrastructure Engineer (m/f/d)'),
                               row('https://b.example/1', company='glacier labs sa', title='senior infrastructure engineer (M/F/D)')])
        self.assertEqual(len(merged), 1)

    def test_another_place_or_no_place_is_never_a_copy(self):
        self.assertEqual(len(merge_copies([row('https://a.example/1', location='Lausanne'), row('https://b.example/1', location='Zurich')])), 2)
        self.assertEqual(len(merge_copies([row('https://a.example/1', location=''), row('https://b.example/1', location='')])), 2)
        self.assertEqual(len(merge_copies([row('https://a.example/1', company=''), row('https://b.example/1', company='')])), 2)

    def test_a_decision_on_one_copy_wins_over_a_better_fit(self):
        merged = merge_copies([row('https://a.example/1', 90), row('https://b.example/1', 50, status='applied', stage='Applied')])
        self.assertEqual((merged[0]['status'], merged[0]['url'], merged[0]['also_on']), ('applied', 'https://b.example/1', ['a.example']))

    def test_a_job_that_found_you_is_never_merged(self):
        self.assertEqual(len(merge_copies([row('https://a.example/1', origin='inbound'), row('https://b.example/1', origin='inbound')])), 2)

    def test_the_order_of_the_other_rows_is_kept(self):
        merged = merge_copies([row('https://a.example/1', title='A'), row('https://x.example/1', title='X'), row('https://b.example/1', title='A')])
        self.assertEqual([r['title'] for r in merged], ['A', 'X'])


class ListTests(unittest.TestCase):
    def test_the_jobs_list_counts_a_merged_posting_once(self):
        def item(url, fit):
            return {'url': url, 'title': 'SRE', 'company': 'Acme', 'location': 'Zurich', 'work_mode': '', 'fit': fit, 'reason': '', 'match_status': 'Open', 'first_seen': '2026-11-01'}
        with mock.patch.object(desktop.digest, 'eligible_jobs', return_value=([], [])), mock.patch.object(desktop.score, 'load', return_value={}):
            result = desktop.jobs(sqlite3.connect(':memory:'), notion_jobs=[item('https://www.jobs.ch/1', 70), item('https://www.jobup.ch/1', 72)])
        self.assertEqual((result['total'], len(result['jobs']), result['jobs'][0]['also_on']), (1, 1, ['jobs.ch']))


if __name__ == '__main__':
    unittest.main()
