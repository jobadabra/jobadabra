"""A match's scoring facts on this Mac's store are what a Notion user reads in 🎯 Job Matches: src/stores/matches_sync.py facts(),
written through the Notion store's columns (src/stores/notion_matches.py COLUMNS), equals src/notion/matches.py properties()."""
import unittest

from src.notion import matches as job_matches
from src.stores import matches_sync, notion_matches
from src.stores import notion_rows as rows
from tests.store_contract import AI, scored

FACTS = ('tier', 'confidence', 'code', 'scored', 'scoring_method', 'seniority', 'languages', 'salary', 'recruiter', 'technologies',
         'role_family', 'workload', 'on_call', 'visa', 'remote_scope', 'contract', 'deadline', 'posted', 'responsibilities', 'places', 'apply_route')


class MatchFactsTests(unittest.TestCase):
    def assertSameColumns(self, job):
        facts = matches_sync.facts(job)
        columns = [c for c in notion_matches.COLUMNS if c[0] in FACTS and c[0] in facts]
        written = rows.to_properties({field: facts[field] for field, *_ in columns}, columns)
        notion = job_matches.properties(job, 'Open')
        for _, column, _ in columns:
            self.assertEqual(rows.read(written[column], dict((c[1], c[2]) for c in columns)[column]),
                             rows.read(notion.get(column), dict((c[1], c[2]) for c in columns)[column]), column)
        self.assertEqual({c[0] for c in notion_matches.COLUMNS if c[0] in FACTS}, set(FACTS), 'every fact has its column')

    def test_an_easy_apply_job_has_its_apply_route_column_on_both_stores(self):
        """Owner, 14 Nov 2026 (asked via AskUserQuestion: "LinkedIn Easy Apply", "Yes, add the column"): LinkedIn's own job page said Easy Apply (#4173), so the
        Job Matches "Apply route" column says it, from this Mac's store and from Notion alike; an unknown route writes nothing, so a known one is never cleared."""
        for route, words in (('linkedin', 'LinkedIn Easy Apply'), ('employer', 'Employer site')):
            job = {**scored(f'https://jobs.example/{route}', 70), 'apply_route': route}
            self.assertEqual(matches_sync.facts(job)['apply_route'], words)
            self.assertEqual(job_matches.properties(job, 'Open')['Apply route'], {'select': {'name': words}})
            self.assertSameColumns({**job, 'ai': AI})
            self.assertEqual(matches_sync.route_key(words), route, 'the list reads the key back')
        for unknown in ('', None, 'somewhere'):
            job = {**scored('https://jobs.example/u', 70), 'apply_route': unknown}
            self.assertNotIn('apply_route', matches_sync.facts(job))
            self.assertNotIn('Apply route', job_matches.properties(job, 'Open'))
        self.assertEqual(matches_sync.route_key(''), '')

    def test_a_job_read_by_ai_has_every_fact_as_its_column(self):
        self.assertSameColumns({**scored('https://jobs.example/a', 80), 'ai': AI})

    def test_a_job_the_extractor_never_read_still_has_its_posted_date_from_the_store(self):
        # Why (4 Nov 2026, a tester on 0.9.6): Overview said Posted "Not stated" while the Description tab, reading the store, said "2 Nov".
        job = {**scored('https://jobs.example/g', 70), 'posted_at': '2026-11-02T09:30:00+00:00'}
        self.assertEqual(matches_sync.facts(job)['posted'], '2026-11-02')
        self.assertEqual(job_matches.properties(job, 'Open')['Posted'], {'date': {'start': '2026-11-02'}}, 'the Notion writer says the same (the reporter\'s store)')
        self.assertEqual(matches_sync.facts({**job, 'ai': AI})['posted'], '2026-11-02', 'the store date wins over the extraction text')
        self.assertNotIn('posted', matches_sync.facts({**scored('https://jobs.example/h', 70), 'posted_at': ''}), 'no date, no column')
        self.assertNotIn('posted', matches_sync.facts({**scored('https://jobs.example/i', 70), 'posted_at': 'Posted 3 days ago'}), 'only a real day')

    def test_the_posting_facts_are_read_and_a_job_from_an_older_extractor_leaves_the_new_ones_empty(self):
        facts = matches_sync.facts({**scored('https://jobs.example/d', 80), 'ai': AI})
        self.assertEqual({k: facts[k] for k in ('workload', 'on_call', 'visa', 'remote_scope', 'contract', 'deadline', 'posted', 'responsibilities')},
                         {'workload': '80-100%', 'on_call': 'No', 'visa': 'Not offered', 'remote_scope': 'Switzerland',
                          'contract': 'Permanent', 'deadline': '2026-11-01', 'posted': '2026-10-03',
                          'responsibilities': 'Keep production reliable\nRun on-call and incidents'})
        old = {k: v for k, v in AI.items() if k not in ('contract', 'deadline', 'posted')}
        self.assertEqual(matches_sync.facts({**scored('https://jobs.example/e', 80), 'ai': old, 'posted_at': '2026-10-05T08:00'})['posted'],
                         '2026-10-05')   # the fetcher's own date wins when the extractor has none
        self.assertSameColumns({**scored('https://jobs.example/f', 80), 'ai': old})

    def test_a_job_not_read_by_ai_yet_has_the_score_facts_only(self):
        job = scored('https://jobs.example/b', 60)
        self.assertSameColumns(job)
        self.assertNotIn('languages', matches_sync.facts(job))

    def test_a_salary_not_stated_and_a_previous_scoring_read_as_notion_writes_them(self):
        job = {**scored('https://jobs.example/c', 70), 'ai': {**AI, 'salary': {'stated': False, 'text': 'maybe'}}}
        job['fit'] = {**job['fit'], 'method': 'Previous'}
        self.assertSameColumns(job)
        self.assertEqual((matches_sync.facts(job)['salary'], matches_sync.facts(job)['scoring_method']), ('', 'Previous'))

    def test_a_date_that_is_not_a_day_is_left_empty_so_notion_does_not_refuse_the_row(self):
        # Issue #345: 'rolling', '2026-10' or '3 days ago' went to Notion as a date (400) and the whole row write failed.
        for text in ('rolling', '2026-10', '3 days ago', '2026-13-45', 'ASAP, by 2026-10-31'):
            job = {**scored('https://jobs.example/e', 70), 'ai': {**AI, 'deadline': text, 'posted': text}, 'posted_at': ''}
            facts = matches_sync.posting_facts(job)
            self.assertEqual((facts['deadline'], facts['posted']), ('', ''), text)
            self.assertNotIn('Deadline', job_matches.properties(job, 'Open'))
            self.assertNotIn('Posted', job_matches.properties(job, 'Open'))
        job = {**scored('https://jobs.example/f', 70), 'ai': {**AI, 'deadline': '2026-10-31T00:00'}, 'posted_at': '2026-10-01'}
        self.assertEqual(matches_sync.posting_facts(job)['deadline'], '2026-10-31')
        self.assertEqual(job_matches.properties(job, 'Open')['Posted'], {'date': {'start': '2026-10-01'}})


if __name__ == '__main__':
    unittest.main()
