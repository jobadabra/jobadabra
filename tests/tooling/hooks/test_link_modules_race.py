"""Guard: data — a second linker that wins the race writes a self-link into the owner's main checkout (#3423: desktop/node_modules/node_modules -> itself, 7 Nov 2026).
tools/link-modules.sh checks `! -e` and then links; when another linker (the post-checkout hook, worktree.sh, a session's own loop) links in between, a plain `ln -s` follows the
existing link and puts node_modules INSIDE the shared folder, which npm then dies on. The fake `ln` below is that other linker: it links first, then runs the real call."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / 'tools' / 'link-modules.sh'


@unittest.skipUnless(shutil.which('git') and shutil.which('sh'), 'needs git and sh')
class LinkModulesRaceTest(unittest.TestCase):
    def setUp(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        self.main = tmp / 'main'
        self.main.mkdir()
        env = {**os.environ, 'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@t', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@t'}
        subprocess.run(['git', 'init', '-q'], cwd=self.main, check=True, env=env)
        subprocess.run(['git', 'commit', '-q', '--allow-empty', '-m', 'i'], cwd=self.main, check=True, env=env)
        (self.main / 'desktop' / 'node_modules' / 'ajv').mkdir(parents=True)
        self.tree = tmp / 'tree'
        subprocess.run(['git', 'worktree', 'add', '-q', '--detach', str(self.tree), 'HEAD'], cwd=self.main, check=True, env=env)
        (self.tree / 'desktop').mkdir(exist_ok=True)
        (self.tree / 'desktop' / 'node_modules').unlink(missing_ok=True)   # a hook that ran on worktree add may have linked it already
        real_ln = shutil.which('ln')
        self.bin = tmp / 'bin'
        self.bin.mkdir()
        fake = self.bin / 'ln'
        fake.write_text(f'#!/bin/sh\n[ -e "$FIRST_LINKER_DONE" ] || {{ : > "$FIRST_LINKER_DONE"; {real_ln} -s "$MAIN_MODULES" "$TREE_LINK"; }}\nexec {real_ln} "$@"\n')
        fake.chmod(0o755)
        self.env = {**os.environ, 'PATH': f'{self.bin}{os.pathsep}{os.environ["PATH"]}', 'FIRST_LINKER_DONE': str(tmp / 'done'),
                    'MAIN_MODULES': str(self.main / 'desktop' / 'node_modules'), 'TREE_LINK': str(self.tree / 'desktop' / 'node_modules')}

    def test_a_linker_that_loses_the_race_leaves_the_main_checkout_alone(self):
        subprocess.run(['sh', str(SCRIPT), str(self.tree)], env=self.env, capture_output=True, text=True)
        shared = self.main / 'desktop' / 'node_modules'
        self.assertTrue(Path(self.env['FIRST_LINKER_DONE']).exists(), 'the other linker must have run (positive control)')
        self.assertTrue((self.tree / 'desktop' / 'node_modules').is_symlink(), 'the tree stays linked by the first linker')
        self.assertEqual(sorted(p.name for p in shared.iterdir()), ['ajv'], 'main/desktop/node_modules holds no link of its own')


if __name__ == '__main__':
    unittest.main()
