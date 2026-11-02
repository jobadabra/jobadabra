"""No CI job writes a GitHub step summary (owner, 26 Oct 2026: "let's remove all the summaries"; a run page was a wall of "apply-1of2 summary" boxes).
One card is allowed (owner, 1 Nov 2026, on beta 11's run page: "I see nowhere the version just published" … "let's display it nicely here. Also the commit released (with hyperlink)"):
the beta's last job writes the version, its release and the commit with links, once per run. Exactly that write, in desktop.yml's prune job.
A second card (owner, 2 Nov 2026: "Allow a 2nd card"): the promote run links its two store runs, from tools/release-stable.sh (STORE_CARD below).

What a person needs from a run lives in the job log, ::error/::warning annotations and the PR status "All checks passed" (tools/pr-verdict.py).
This scans every tracked file but Markdown (docs may tell the history) for a write to $GITHUB_STEP_SUMMARY or @actions/core's summary.
"""
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WRITES = re.compile(r'GITHUB_STEP_SUMMARY|\bcore\.summary\b')
CARD = '.github/workflows/desktop.yml'
# Why (2 Nov 2026, owner on the promote run 41484802919: "BUt where the publishing to Chrome web store, to microsoft store... is happening?", then "Allow a 2nd card"):
# the promote run's page links its two store runs, written once by tools/release-stable.sh's summary(). Its test points the variable at a temp file, so the suite
# never writes the page of the CI job that runs it.
STORE_CARD = 'tools/release-stable.sh'
STORE_CARD_TEST = 'tests/test_release_stable_guard.py'
SELF = Path(__file__).resolve().relative_to(ROOT).as_posix()


def tracked():
    out = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, capture_output=True, check=True).stdout.decode('utf-8', 'replace')
    return [name for name in out.split('\0') if name and name not in (SELF, CARD, STORE_CARD, STORE_CARD_TEST) and not name.endswith('.md') and '/node_modules/' not in f'/{name}']


class NoStepSummaries(unittest.TestCase):
    def test_the_scan_reads_the_places_ci_runs(self):
        names = tracked()
        for place in ('.github/workflows/', 'desktop/e2e/', 'tools/'):
            self.assertTrue(any(name.startswith(place) for name in names), f'nothing tracked under {place}: the scan reads nothing there')

    def test_no_workflow_or_script_writes_a_step_summary(self):
        bad = []
        for name in tracked():
            path = ROOT / name
            if not path.is_file():
                continue
            try:
                text = path.read_text(encoding='utf-8')
            except (UnicodeDecodeError, OSError):
                continue
            bad += [f'{name}:{number}: {line.strip()[:100]}' for number, line in enumerate(text.splitlines(), 1) if WRITES.search(line)]
        self.assertEqual(bad, [], 'print it to the log (echo, console.log, print) or as an ::error/::warning annotation; no step summaries')

    def test_the_beta_card_is_the_one_write_and_it_is_in_the_last_job(self):
        text = (ROOT / CARD).read_text(encoding='utf-8')
        self.assertEqual(len(WRITES.findall(text)), 1, 'one card per run, no other summary')
        prune = text.split('\n  prune:\n')[1]
        self.assertEqual(len(WRITES.findall(prune)), 1, 'the card is written by the last job, which knows both lanes')
        for link in ('/releases/tag/desktop-v$VERSION', '/commit/$GITHUB_SHA'):
            self.assertIn(link, prune, 'the card links the release and the commit')

    def test_the_store_card_is_one_helper_in_the_promote_script(self):
        lines = [line for line in (ROOT / STORE_CARD).read_text(encoding='utf-8').splitlines() if WRITES.search(line)]
        self.assertEqual(len(lines), 1, f'one summary() helper writes the store card: {lines}')
        self.assertTrue(lines[0].startswith('summary() {'), lines[0])
        test = (ROOT / STORE_CARD_TEST).read_text(encoding='utf-8')
        self.assertEqual([line.strip()[:80] for line in test.splitlines() if WRITES.search(line) and "'GITHUB_STEP_SUMMARY': str(Path(folder)" not in line], [],
                         'the test only points the variable at its own temp file')



if __name__ == '__main__':
    unittest.main()
