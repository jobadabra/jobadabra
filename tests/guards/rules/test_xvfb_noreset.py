"""Guard: release — an xvfb-run without -noreset brings back app (Linux) launches refused with "Missing X server or $DISPLAY" (red on unchanged code).

7-8 Nov 2026 (xv): Xvfb resets when its last client leaves and a connect that lands during the reset is refused; plain Xvfb refused 50 of 7200 overlapping
connects by default and 0 of 12000 with -noreset. 15 workflow lines carry the flag; the next copied `--server-args='-screen 0 1440x900x24'` line would quietly restore the reset window.
"""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parents[3] / '.github' / 'workflows'


def xvfb_lines_without_noreset(text):
    """The `xvfb-run` command lines of a workflow (comments skipped) that do not start Xvfb with -noreset."""
    return [line.strip() for line in text.splitlines() if re.search(r'\bxvfb-run\b', line) and not line.lstrip().startswith('#') and '-noreset' not in line]


class XvfbNoReset(unittest.TestCase):
    def test_the_check_flags_the_line_that_was_on_main(self):
        old = "          if [ \"$RUNNER_OS\" = Linux ]; then xvfb-run -a --server-args='-screen 0 1440x900x24' bash -c \"$TESTS\"; fi"
        self.assertEqual(len(xvfb_lines_without_noreset(old)), 1)
        self.assertEqual(xvfb_lines_without_noreset(old.replace('1440x900x24', '1440x900x24 -noreset')), [])

    def test_every_xvfb_run_in_ci_starts_the_server_with_noreset(self):
        bad = {file.name: lines for file in sorted(WORKFLOWS.glob('*.yml')) if (lines := xvfb_lines_without_noreset(file.read_text()))}
        self.assertEqual(bad, {}, 'add -noreset to the --server-args of these xvfb-run lines (a resetting Xvfb refuses a launch that connects during the reset)')


if __name__ == '__main__':
    unittest.main()
