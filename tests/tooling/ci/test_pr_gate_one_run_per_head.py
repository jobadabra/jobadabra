"""Guard: release — two gate runs on ONE commit never share a concurrency group, so none is cancelled, and a cancelled check never sits red beside its green twin on a PR head.
Why (10 Nov 2026, fr; #3643 and 78 other PRs since 25 Oct, 73 of the 75 read cancelled by "higher priority waiting request for pr-gate-N-text"): tools/ship-pr.sh edited an open PR with two PATCHes
(description, then title) = two `edited` events seconds apart, both in the gate's 'text' group; the group keeps one waiting run and cancels the rest, and GitHub's rollup counts a cancelled run as red.
Two things hold now: (1) pr-gate.yml gives an edit or a reopen a group of its own (as the site's tests.yml has since jobadabra-web #462: 15 of 53 PRs before, 0 of 47 after); (2) ship sends title and
description in ONE request (tools/pr-rest-lib.sh pr_set_text). Runs the real library against the fake gh of tests/fake_gh.py."""
import json
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
GATE = (ROOT / '.github' / 'workflows' / 'pr-gate.yml').read_text()


def group_of(action):
    """The gate's concurrency group for a pull_request event of this action, read from the workflow's own expression (only the shapes it uses: `a || b` of `x == 'y'`, `&&`, format())."""
    expr = re.search(r'^  group: (.+)$', GATE, re.M).group(1)
    inner = re.findall(r'\$\{\{(.+?)\}\}', expr)
    parts = []
    for piece in inner:
        piece = piece.strip()
        if 'pull_request.number' in piece:
            parts.append('7')
            continue
        m = re.match(r"\((.+?)\) && format\('([^']+)', github\.run_id\) \|\| '([^']+)'$", piece)
        assert m, f'the group expression changed shape: {piece}'
        wanted = re.findall(r"github\.event\.action == '(\w+)'", m.group(1))
        parts.append(m.group(2).format('RUN-%s' % action) if action in wanted else m.group(3))
    return 'pr-gate-' + '-'.join(parts)


class GateGroupTest(unittest.TestCase):
    def test_an_edit_and_a_reopen_each_get_a_group_of_their_own_and_a_push_shares_one(self):
        self.assertEqual(group_of('synchronize'), group_of('opened'), 'a push or an open replaces an older run: they share a group')
        for action in ('edited', 'reopened'):
            self.assertIn('RUN-', group_of(action), f'{action} runs on the same commit as the run before it: its own group, so nothing cancels it')
            self.assertNotEqual(group_of(action), group_of('synchronize'))

    def test_the_old_shape_is_gone(self):
        group = re.search(r'^  group: (.+)$', GATE, re.M).group(1)
        self.assertNotIn("'text'", group, "the shared 'text' group made two edits cancel each other (the 79 PRs)")


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class OneEditTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / 'bin').mkdir()
        gh = self.tmp / 'bin' / 'gh'
        gh.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{ROOT / "tests" / "fake_gh.py"}" "$@"\n')
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        self.state = self.tmp / 'state.json'
        self.state.write_text('{}')

    def edit(self, title, body):
        env = {'PATH': f'{self.tmp / "bin"}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin', 'FAKE_GH_STATE': str(self.state), 'HOME': str(self.tmp)}
        subprocess.run(['bash', '-c', f'. "{ROOT / "tools" / "pr-rest-lib.sh"}"; pr_set_text o/r 1 "$1" "$2"', 'x', title, body], env=env, check=True, timeout=30)
        return [call for call in json.loads(self.state.read_text()).get('calls', []) if call.startswith('pr edit 1')]

    def test_title_and_description_go_in_one_request(self):
        calls = self.edit('[fr] A title', 'A body')
        self.assertEqual(calls, ['pr edit 1 --title [fr] A title --body A body'], 'one PATCH = one `edited` event = one gate run')

    def test_only_what_is_given_is_sent_and_nothing_given_sends_nothing(self):
        self.assertEqual(self.edit('', 'Only a body'), ['pr edit 1 --body Only a body'])
        self.assertEqual(self.edit('', ''), ['pr edit 1 --body Only a body'], 'an empty call adds no request')

    def test_ship_edits_an_open_pr_only_through_the_one_request(self):
        ship = (ROOT / 'tools' / 'ship-pr.sh').read_text()
        self.assertNotRegex(ship, r'\bpr_set "', 'a one-field pr_set is a second `edited` event')
        self.assertEqual(len(re.findall(r'\bpr_set_text "', ship)), 1)


if __name__ == '__main__':
    unittest.main()
