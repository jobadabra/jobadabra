"""Guard: release — a search pair reads the boards that refuse plain reading on both sides or on neither, and its comment shows when each side got each board's jobs.
Without it a pair whose PR side came second to a refusing page skipped it (owner, 14 Nov 2026: "No wait, skip") and read as a loss the PR never caused, or a gain from one side's
extra board (sa for the owner's pairs, 14 Nov 2026: `--beside` only when "both sides of one pair get the same cards"). The log lines are the ones desktop/lib/headless-boards.js writes."""
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import pair  # noqa: E402

MAIN_LOG = """[3s] Job boards: round 'driver' on 4 boards
[41s] Job boards: TRANS.BG: 12 jobs read in Jobadabra's browser
[44s] Job boards: OLX.bg: turned CI's browser away before: not opened
[52s] Job boards: JOBS.BG: no jobs on the page in Jobadabra's browser
"""
PR_LOG = """[47s] Job boards: TRANS.BG: 12 job(s) from the read another CI search made today (pair#1), nothing sent
[55s] Job boards: JOBS.BG: no job from the read another CI search made today, nothing sent
"""


class RefusingBoards(unittest.TestCase):
    def test_a_read_and_a_reuse_are_listed_with_their_second_and_a_skip_is_not(self):
        self.assertEqual(pair.refusing_boards(MAIN_LOG), [{'board': 'TRANS.BG', 's': 41, 'how': 'read'}, {'board': 'JOBS.BG', 's': 52, 'how': 'read'}])
        self.assertEqual(pair.refusing_boards(PR_LOG), [{'board': 'TRANS.BG', 's': 47, 'how': 'reused'}, {'board': 'JOBS.BG', 's': 55, 'how': 'reused'}])
        self.assertEqual(pair.refusing_boards("[9s] Job boards: Jobadabra's browser could not start; the boards wait for the next Find jobs\n"), [])

    def test_the_comment_shows_each_sides_boards_and_seconds(self):
        with tempfile.TemporaryDirectory() as folder:
            for name, log in (('b01--main-1', MAIN_LOG), ('b01--pr-1', PR_LOG)):
                Path(folder, name, 'draw').mkdir(parents=True)
                Path(folder, name, 'draw', 'run-1.log').write_text(log)
                with redirect_stdout(io.StringIO()):
                    pair.side(Path(folder, name), name.split('--')[1].split('-')[0])
            text = pair.table(folder, '7', 'b' * 40, 'a' * 40, spread=lambda person: 2)
        self.assertIn("Refusing boards' jobs, second they came (main · PR)", text)
        self.assertIn('| TRANS.BG 41 s read, JOBS.BG 52 s read · TRANS.BG 47 s reused, JOBS.BG 55 s reused |', text)
        header, rule = [line for line in text.splitlines() if line.startswith('| Person') or line.startswith('|---')]
        self.assertEqual(header.count('|'), rule.count('|'), 'one rule cell per column')

    def test_the_pair_reads_refusing_boards_only_when_both_sides_wait_for_their_own_pairs_read(self):
        step = (ROOT / '.github' / 'workflows' / 'search-pair.yml').read_text().split('for k in $(seq 1 "$RUNS"); do', 1)
        self.assertIn('''grep -q 'OWN_STEP_MS' "side-$side/tools/persona-search/board-mark.mjs"''', step[0])
        self.assertIn('''grep -q -- '--beside' "side-$side/tools/persona-search/run.mjs"''', step[0], 'Gitar on #4355: the side must also take the flag')
        self.assertIn('"${beside[@]}"', step[1].split('codex.mjs --', 1)[1].split('\n', 1)[0], 'both sides get the same flag in their one draw line')
        self.assertIn('OWN_STEP_MS', (ROOT / 'tools' / 'persona-search' / 'board-mark.mjs').read_text(), 'the name the workflow looks for')


if __name__ == '__main__':
    unittest.main()
