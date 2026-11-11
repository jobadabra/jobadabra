"""What a Find jobs run reports and delivers at its end: an empty or failed search, a cut gather, nothing new, the More preview, a visits-only run,
warned errors and the digest. The harness is tests/unit/ai/test_daily_search_phases.py's (its own tests are not run again here); moved out of that
file as is (#3798: it passed 500 lines)."""
import unittest
from unittest import mock

from src import daily_search, time_budget
from tests.unit.ai import test_daily_search_phases as phases
from tests.unit.ai.test_daily_search_phases import JOB


class SearchOutcomes(phases.SearchCharacterization):
    def test_no_sources_still_reports_and_saves_empty_search(self):
        self.sources = []
        out = self.run_search()
        self.assertEqual(self.report, {'jobs': [], 'sources': []})
        self.assertEqual(self.stores.matches.list(), [])
        self.assertNotIn('Added ', out)
        self.assertEqual(self.runs[0]['new'], 0)
        self.assert_order('gather', 'score', 'matches', 'digest', 'save')

    def test_failed_source_is_counted_without_blocking_report(self):
        self.failed = True
        out = self.run_search()
        self.assertFalse(self.report['sources'][0]['ok'])
        self.assertEqual(len(self.runs[0]['failing_feeds']), 1)
        self.assertEqual(self.stores.matches.list(), [])
        self.assertIn('Scored 0', out)

    def test_deadline_hit_during_gather_keeps_partial_jobs_and_clock(self):
        self.jobs.append({**JOB, 'id': 'two', 'url': 'https://example.test/two', 'title': 'Second SRE'})
        self.expire = True
        # Why (29 Oct 2026): now=0 sets deadline 180; a fresh Linux runner's monotonic clock can still be below it.
        with mock.patch.object(time_budget.time, 'monotonic', return_value=181):
            out = self.run_search()
        self.assertEqual(len(self.report['jobs']), 1)
        self.assertEqual(time_budget.DEADLINE, 180)
        self.assertEqual(self.stores.matches.list(), [])
        self.assertIn('Scored 0', out)
        self.assert_order('gather', 'descriptions', 'score', 'enrich', 'digest', 'save')

    def test_nothing_new_does_not_send_or_mark_shown(self):
        self.jobs = []
        out = self.run_search(mode='scheduled', send=True)
        self.assertIn('No new jobs since the last run; nothing sent.', out)
        self.assertNotIn('send', self.calls)
        self.assertNotIn('shown', self.calls)
        self.assertEqual(self.runs[0]['telegram'], 'nothing new; not sent')
        self.assert_order('matches', 'ledger', 'gone', 'interviews', 'digest', 'save', 'log')

    def test_more_preview_never_imports_syncs_or_saves(self):
        self.import_report(self.db, {'jobs': [JOB]})
        out = self.run_search(mode='more')
        self.assertEqual(self.report, {'jobs': [], 'sources': []})
        for name in ('gather', 'import', 'matches', 'save', 'log', 'shown'):
            self.assertNotIn(name, self.calls)
        self.assertIn('Scored 1', out)
        self.assertEqual(self.stores.matches.list(), [])
        self.assert_order('descriptions', 'enrich', 'score', 'digest', 'app')

    def test_only_visits_does_not_start_web_or_close_jobs(self):
        self.sources.append({'company': 'Browser', 'ats': 'visit', 'slug': 'browser'})
        out = self.run_search(mode='today', only_visits=True)
        self.assertIn('Reading only the 1 page(s) read in Chrome on this Mac', out)
        for name in ('web', 'boards first', 'boards beside', 'apis', 'stale', 'dropped', 'places'):
            self.assertNotIn(name, self.calls)
        self.assertEqual([s['company'] for s in self.report['sources']], ['Browser'])

    def test_enrichment_and_scoring_errors_are_warned_and_reported(self):
        self.enrich_error = ValueError('facts fixture')
        self.score_error = ValueError('score fixture')
        out = self.run_search()
        self.assertIn('Warning: enrichment skipped: ValueError: facts fixture', out)
        self.assertIn('Warning: scoring skipped: ValueError: score fixture', out)
        self.assertIn('enrichment skipped: ValueError', self.runs[0]['warnings'])
        self.assertIn('scoring skipped: ValueError', self.runs[0]['warnings'])
        self.assert_order('enrich', 'score', 'matches', 'digest', 'save')

    def test_sent_digest_marks_shown_before_save(self):
        out = self.run_search(send=True)
        self.assertIn('Sent 1 Telegram message(s); imported 1 jobs.', out)
        self.assertEqual(self.runs[0]['telegram'], 'sent 1 message(s), 1 new')
        self.assert_order('digest', 'send', 'shown', 'save', 'log')

    def test_refused_delivery_leaves_jobs_unshown(self):
        with mock.patch.object(daily_search.telegram, 'send', side_effect=ValueError('refused')), \
                mock.patch.object(daily_search.telegram, 'failure_words', return_value='Delivery refused'):
            out = self.run_search(send=True)
        self.assertIn('Warning: Delivery refused', out)
        self.assertNotIn('shown', self.calls)
        self.assertEqual(self.runs[0]['telegram'], 'not sent: Telegram refused it')
        self.assertEqual(len(self.stores.matches.list()), 1)


for _name in [name for name in dir(phases.SearchCharacterization) if name.startswith('test_') and name not in SearchOutcomes.__dict__]:
    setattr(SearchOutcomes, _name, None)   # unittest skips what is not callable: the harness's own tests run in their own file


if __name__ == '__main__':
    unittest.main()
