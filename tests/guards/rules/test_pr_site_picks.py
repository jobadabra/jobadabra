"""Guard: release — a web PR's Site tests run only what tools/affected-tests.py picks, so a site test it misses goes red on main instead of on the PR.
Why (4 Nov 2026, owner: "We run "site tests" (which are all tests) no matter what's the PR change"): the cases below are the ways a site test reaches code without an import line. Replay: spec 2026-11-04-pr-time-design."""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TREE = {
    '.github/workflows/tests-desktop.yml': "on:\n  pull_request:\n    paths:\n      - 'desktop/**'\n\npermissions:\n",
    'admin/page.js': "export const page = 1;\n",
    'admin/page.css': "body {}\n",
    'shared/deep.js': "export const deep = 1;\n",
    'shared/top.js': "import {deep} from './deep.js';\nexport const top = deep;\n",
    'db/migrations/0001_a.sql': "select 1;\n",
    'web/public/index.html': "<html></html>\n",
    'tools/phone-width.mjs': "import path from 'node:path';\nconst web = path.resolve(path.join(repo, 'web/public'));\n",
    'test/web/phone.test.js': "const tool = new URL('../../tools/phone-width.mjs', import.meta.url).pathname;\n",
    'workers/www/index.js': "import '../../admin/page.js';\n",
    'tools/worker-server.mjs': "import fs from 'node:fs';\nimport path from 'node:path';\nfs.readdirSync(path.join(root, 'db/migrations'));\nawait import(path.join(root, 'workers/www/index.js'));\n",
    'tools/walk-pages.mjs': "import './worker-server.mjs';\n",
    'test/admin/walker.test.js': "import {spawnSync} from 'node:child_process';\nconst tool = new URL('../../tools/walk-pages.mjs', import.meta.url).pathname;\nspawnSync(process.execPath, [tool]);\n",
    'test/admin/seeded.test.js': "import {readdirSync} from 'node:fs';\nreaddirSync(new URL('../../db/migrations/', import.meta.url));\n",
    'test/admin/deep.test.js': "import {top} from '../../shared/top.js';\n",
    'test/admin/by-value.test.js': "import {readFileSync} from 'node:fs';\nreadFileSync(`admin/${name}.js`);\n",
    'test/admin/whole-tree.test.js': "import {execFileSync} from 'node:child_process';\nexecFileSync('git', ['ls-files']);\n",
    'test/admin/alone.test.js': "export const nothing = 1;\n",
}


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class PrSitePicks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.check = load('check_py_site', 'tools/check.py')
        cls.picker = load('affected_tests_site', 'tools/affected-tests.py')
        folder = tempfile.TemporaryDirectory()
        cls.addClassCleanup(folder.cleanup)
        cls.picker.ROOT = Path(folder.name).resolve()
        for name, text in TREE.items():
            file = cls.picker.ROOT / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(text)
        cls.picker.data_readers = lambda changed: {}

    def site(self, *changed):
        return self.picker.select(list(changed))['site']

    def test_a_page_walker_reaches_the_worker_through_its_tool(self):
        self.assertIn('test/admin/walker.test.js', self.site('admin/page.js'))

    def test_a_page_file_that_is_not_code_runs_what_reaches_the_worker(self):
        self.assertIn('test/admin/walker.test.js', self.site('admin/page.css'))

    def test_a_tool_that_serves_a_folder_runs_for_a_file_in_it(self):
        self.assertIn('test/web/phone.test.js', self.site('web/public/index.html'))

    def test_a_test_that_seeds_from_a_folder_runs_only_for_that_folder(self):
        self.assertIn('test/admin/seeded.test.js', self.site('db/migrations/0001_a.sql'))
        self.assertNotIn('test/admin/seeded.test.js', self.site('admin/page.js'))

    def test_shared_is_followed_past_its_first_file(self):
        self.assertIn('test/admin/deep.test.js', self.site('shared/deep.js'))

    def test_a_file_named_by_a_value_counts_its_folder(self):
        self.assertIn('test/admin/by-value.test.js', self.site('admin/page.js'))

    def test_a_test_of_the_whole_tree_runs_for_any_change(self):
        self.assertIn('test/admin/whole-tree.test.js', self.site('.github/workflows/other.yml'))

    def test_an_unrelated_test_is_left_out(self):
        self.assertNotIn('test/admin/alone.test.js', self.site('admin/page.js'))

    def test_what_runs_the_tests_runs_everything(self):
        for runner in ('tools/layout-map.txt', '.github/workflows/tests.yml', 'tools/check.py'):
            self.assertEqual(self.site(runner), 'all', runner)

    def test_the_worker_dependencies_run_everything(self):
        self.assertEqual(self.site('workers/www/package.json'), 'all')

    def test_an_unknown_path_runs_everything(self):
        self.assertEqual(self.site('somewhere/new.js'), 'all')

    def test_an_empty_pick_runs_no_test(self):
        self.assertEqual(self.check.commands('site', False, 'node', 'npm', []), [])


if __name__ == '__main__':
    unittest.main()
