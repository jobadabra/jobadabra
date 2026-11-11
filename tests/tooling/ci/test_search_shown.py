"""Guard: release — the night Search check's "shown" count (tools/persona-search/shown.py) is what the app's Jobs list shows once the search has ended:
a job not scored yet waits, a scored one is shown (src/desktop_jobs.py jobs, hide_unscored). Without it the count could silently read every open job again, or
nothing, and the scoreboard would measure a list no person sees (owner, 11 Nov 2026, asked via AskUserQuestion by sa: "Count what the list shows, then 4/5")."""
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('shown', ROOT / 'tools/persona-search/shown.py')
shown = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shown)

# Two open jobs in the person's store, one scored: seeded in its own process, as the engine reads its folders at import.
SEED = textwrap.dedent('''
    from src import digest, store
    from src.ai import score
    from src.paths import JOBS_DB
    with store.connect(JOBS_DB) as db:
        store.import_watch_report(db, {'jobs': [{'company': f'Example {i}', 'id': str(i), 'title': 'Carpenter', 'location': 'Brussels, Belgium',
                                                  'url': f'https://jobs.test/{i}', 'description': 'Carpentry on site.'} for i in (1, 2)]})
        job = next(j for j in digest.eligible_jobs(db)[0] if j['url'] == 'https://jobs.test/1')
        score.save(db, job, 'm', {'score': 80, 'reason': 'fits'}, 'cv')
''')


class ShownCount(unittest.TestCase):
    def test_a_scored_job_is_shown_and_one_not_scored_yet_waits(self):
        with tempfile.TemporaryDirectory() as tmp:
            data, config = Path(tmp) / 'data', Path(tmp) / 'config'
            data.mkdir()
            shutil.copytree(ROOT / 'config', config)   # the repository's own default settings (config/ is tracked), as a fresh install's
            env = {**{k: v for k, v in os.environ.items() if not k.startswith('NOTION_')}, **shown.ENV,
                   'JOBADABRA_DATA_DIR': str(data), 'JOBADABRA_CONFIG_DIR': str(config)}
            seeded = subprocess.run([sys.executable, '-c', SEED], cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(seeded.returncode, 0, seeded.stderr[-800:])
            self.assertEqual(shown.keys(data / 'jobs.sqlite'), {'https://jobs.test/1'})

    def test_counts_read_only_the_shown_rows_and_say_unknown_without_them(self):
        rows = [{'shown': True, 'role': 'yes', 'place': 'yes'}, {'shown': True, 'role': 'no', 'place': 'yes'}, {'shown': False, 'role': 'yes', 'place': 'yes'}]
        self.assertEqual(shown.counts(rows), {'shown_found': 2, 'shown_local': 1, 'shown_wrong_role': 1})
        self.assertEqual(shown.counts([{'role': 'yes', 'place': 'yes'}]), {'shown_found': None, 'shown_local': None, 'shown_wrong_role': None})


if __name__ == '__main__':
    unittest.main()
