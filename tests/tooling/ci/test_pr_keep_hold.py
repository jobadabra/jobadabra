"""Guard: a held PR (draft, "DONT MERGE" in its title) keeps the words when ship.sh retitles it (11 Nov 2026, sm: a re-ship with --title= rewrote #3809's title and dropped them; owner, 10 Nov:
"you should put it as draft and a prefix \"DONT MERGE\""). Runs pr_keep_hold from tools/pr-rest-lib.sh under bash."""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def keep(current, new):
    code = f'. "{ROOT / "tools" / "pr-rest-lib.sh"}"; pr_keep_hold "$1" "$2"'
    return subprocess.run(['bash', '-c', code, 'x', current, new], capture_output=True, text=True, check=True, timeout=30).stdout


class KeepHoldTest(unittest.TestCase):
    def test_a_held_pr_keeps_its_words_right_after_the_tag(self):
        self.assertEqual(keep('[sm] DONT MERGE 2/3 Old', '[sm] 2/3 New'), '[sm] DONT MERGE 2/3 New')
        self.assertEqual(keep('[96-pane-2a] [as] DONT MERGE 1/2 Old', '[96-pane-2a] [as] 1/2 New'), '[96-pane-2a] [as] DONT MERGE 1/2 New')

    def test_a_new_title_that_already_says_it_is_left_alone(self):
        self.assertEqual(keep('[sm] DONT MERGE Old', '[sm] DONT MERGE New'), '[sm] DONT MERGE New')

    def test_a_pr_that_is_not_held_gets_the_new_title_as_given(self):
        self.assertEqual(keep('[sm] Old', '[sm] New'), '[sm] New')

    def test_a_title_without_a_tag_gets_the_words_first(self):
        self.assertEqual(keep('DONT MERGE Old', 'New'), 'DONT MERGE New')


if __name__ == '__main__':
    unittest.main()
