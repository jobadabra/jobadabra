"""The one scorer beside the search, through the whole search (ts, 10 Nov 2026; owner asked via AskUserQuestion, "Yes, build it (Recommended)"). The harness is
tests/unit/ai/test_daily_search_phases.py's (its own tests are not run again here); its gather lands the job and waits until the scorer has it."""
import unittest
from unittest import mock

from src import time_budget
from tests.unit.ai import test_daily_search_phases as phases
from tests.unit.ai.test_daily_search_phases import JOB


class BesideTheSearch(phases.SearchCharacterization):
    def test_a_job_that_lands_while_the_search_reads_is_scored_beside_it_on_a_first_press_too(self):
        """ts (10 Nov 2026; owner asked via AskUserQuestion, "Yes, build it (Recommended)"): night 9 Nov scored a median of 3 on press 1: new jobs were scored only after the search's last
        source, at 105-163 s of 135. The one scorer takes each job as it lands, in a thread of its own, and the closing pass finds nothing left."""
        self.beside = True
        time_budget.start(180)
        with mock.patch.object(time_budget, 'record'):
            out = self.run_search(first_jobs=True)
        self.assertEqual([ids for ids in self.score_calls if ids], [{1}], 'one job, scored once, beside the search (the closing pass finds an empty batch)')
        self.assertLess(self.calls.index('score'), self.calls.index('gather goes on'), 'before the search had read its last source')
        self.assertIn('import', self.calls[self.calls.index('gather goes on'):], 'the search\'s own import comes after the scorer has the job')
        self.assertEqual(len(self.stores.matches.list()), 1)
        self.assertEqual(self.runs[0]['score']['done'], 1, 'the card counts it once')
        self.assertIn('Scored 1 of 1 job(s)', out)

    def test_a_job_scored_beside_the_search_is_not_scored_again_by_the_closing_pass(self):
        self.beside = True
        self.jobs.append({**JOB, 'id': 'two', 'url': 'https://example.test/two', 'title': 'Second SRE'})
        time_budget.start(180)
        with mock.patch.object(time_budget, 'record'):
            self.run_search()
        scored = [job_id for ids in self.score_calls for job_id in (ids or [])]
        self.assertEqual(len(scored), len(set(scored)), 'no job is paid for twice: ' + str(self.score_calls))
        self.assertEqual(len(self.stores.matches.list()), 2)



for _name in [name for name in dir(phases.SearchCharacterization) if name.startswith('test_') and name not in BesideTheSearch.__dict__]:
    setattr(BesideTheSearch, _name, None)   # unittest skips what is not callable: the harness's own tests run in their own file


if __name__ == '__main__':
    unittest.main()
