"""Every daily mode the app can start is listed where it runs: the engine, the public workflow and the Always-on template.

A mode missing from the workflow's `options:` is refused by GitHub at dispatch time, so Always on breaks for that one button
only (Prepare top matches, 5 Oct 2026, was the case this guards)."""
import re
import unittest

from src import daily
from src.notion import cron_runs
from src.paths import ROOT as REPO

# Run on the Mac only (the app waits for the answer: "Applied elsewhere" → Add a job), never dispatched to GitHub.
LOCAL_ONLY = {'import'}
# Offered by the workflows but never run by `daily`: the Test button's checks have their own job (src/connection_test.py).
WORKFLOW_ONLY = {'test'}


def options(path):
    text = (REPO / path).read_text()
    return set(re.search(r'options: \[([^\]]*)\]', text).group(1).replace(' ', '').split(','))


class ModeContract(unittest.TestCase):
    def test_workflow_and_template_offer_the_same_modes_as_the_engine(self):
        engine = set(daily.MODES) - LOCAL_ONLY
        for path in ('.github/workflows/daily.yml', 'templates/github-actions/daily.yml'):
            with self.subTest(path):
                offered = options(path)
                self.assertEqual(engine - offered, set(), f'{path} cannot dispatch these modes')
                self.assertEqual(offered - engine - WORKFLOW_ONLY, set(), f'{path} offers modes the engine rejects')
                self.assertTrue(WORKFLOW_ONLY <= offered, f'{path} cannot dispatch the Test button')

    def test_every_mode_that_writes_a_run_row_is_a_known_notion_option(self):
        import json
        schema = json.loads((REPO / 'config' / 'notion_schema.json').read_text())
        text = json.dumps(schema)
        for mode in daily.MODES:
            if mode in cron_runs.LOGGED_MODES:
                self.assertIn(f'"name": "{mode}"', text, f'Mode "{mode}" is not a select option of ⏱️ Search runs')

    def test_the_workflow_gives_every_scoring_mode_its_score_limit(self):
        """A mode that scores has no AI in the workflow without --score-max: Re-score on GitHub printed "Re-score needs an AI" (Gitar, #3089)."""
        text = (REPO / '.github' / 'workflows' / 'daily.yml').read_text()
        line = next(line for line in text.splitlines() if 'ai="$ai --score-max' in line or '--score-max 60' in line)
        condition = text.splitlines()[text.splitlines().index(line) - 1]
        for mode in ('scheduled', 'run', 'today', 'rescore'):
            self.assertIn(f'[ "$MODE" = {mode} ]', condition)

    def test_a_test_run_never_reaches_the_search_job(self):
        """The Test button's run only checks: the search job skips mode test, and the test job is the only one that runs for it (Always on, 4 Nov 2026)."""
        text = (REPO / '.github' / 'workflows' / 'daily.yml').read_text()
        jobs = re.split(r'\n(?=  [a-z][a-z0-9_-]*:\n)', text[text.index('\njobs:\n'):])
        run = next(job for job in jobs if job.startswith('  run:') or job.startswith('\njobs:\n  run:'))
        test = next(job for job in jobs if job.startswith('  test:'))
        self.assertIn("if: inputs.mode != 'test'", run)
        self.assertIn("if: inputs.mode == 'test'", test)
        self.assertEqual(set(re.findall(r'python -m src (\w+)', test)), {'selftest'}, 'the test job may only run the selftest checks')


if __name__ == '__main__':
    unittest.main()
