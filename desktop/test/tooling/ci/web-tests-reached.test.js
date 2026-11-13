// Guard: release — a jobadabra PR that changes a file jobadabra-web's tests read runs just those web tests (tools/web-tests-reached.mjs, step "Web tests that read this PR's files" of pr-gate.yml).
// Without the map a jobadabra PR merges green and turns every web PR red (10 Nov 2026 #3684, 12 Nov 2026 #3939: web test/unit/admin/search/search-night-prs.test.js reads press-yardstick.yml).
// The web test is a byte copy of the one at web f9a9a177 (before it was removed), so the proof does not depend on what web keeps.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {readsOf, testsReaching, webTests} from '../../../../tools/web-tests-reached.mjs';

const FIXTURE = fileURLToPath(new URL('../../fixtures/web-tests-reached/search-night-prs.test.js.txt', import.meta.url));
const NIGHT = 'test/unit/admin/search/search-night-prs.test.js';

// A web checkout with the real test, a helper another test imports, a Python guard, and an unrelated test; a joined tree with the jobadabra files they import.
function trees() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-reached-'));
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true}); fs.writeFileSync(path.join(root, file), text); };
  put(`web/${NIGHT}`, fs.readFileSync(FIXTURE, 'utf8'));
  put('web/test/unit/shared/uses-helper.test.js', "import {x} from './kit.js';\nimport {test} from 'node:test';\ntest('a', () => x);\n");
  put('web/test/unit/shared/kit.js', "import {y} from '../../../extension/ladder/shapes.js';\nexport const x = readFileSync('desktop/e2e/smoke-sites.json');\n");
  put('web/test/unit/unrelated.test.js', "import {test} from 'node:test';\ntest('b', () => 1);\n");
  put('web/test/python/test_site_pipefail.py', "import pathlib\nROOT = pathlib.Path('.')\nfor f in (ROOT / '.github' / 'workflows').glob('*.yml'): pass\nopen('tools/gh_retry.py')\n");
  put('web/test/layout.test.js', "const dir = path.join(root, 'desktop', 'renderer');\nimport {test} from 'node:test';\n");
  put('tree/extension/ladder/shapes.js', "import {z} from './deep.js';\nexport const y = z;\n");
  put('tree/extension/ladder/deep.js', 'export const z = 1;\n');
  return {web: path.join(root, 'web'), tree: path.join(root, 'tree')};
}

test('the yardstick workflow selects the web test that reads it, even when the PR deletes the file or its list', () => {
  const {web, tree} = trees();
  // #3684 changed the file, #3939 took its paths list out; either way the file is in the PR's list, and the test reads it by name (a deleted file is only a name here, never opened)
  assert.ok(testsReaching(['.github/workflows/press-yardstick.yml'], {web, tree}).includes(NIGHT));
  assert.ok(readsOf(path.join(web, NIGHT), {web, tree}).has('.github/workflows/press-yardstick.yml'), 'positive control: the read is found in the test text');
});

test('a file the PR changes that no web test reads selects nothing: the step ends in seconds', () => {
  const {web, tree} = trees();
  assert.deepEqual(testsReaching(['desktop/lib/browser-session.js', 'docs/x.md'], {web, tree}), []);
  assert.deepEqual(testsReaching([], {web, tree}), []);
});

test('a file read through a web helper or a jobadabra import chain selects the test that uses it', () => {
  const {web, tree} = trees();
  assert.deepEqual(testsReaching(['desktop/e2e/smoke-sites.json'], {web, tree}), ['test/unit/shared/uses-helper.test.js']);   // a literal in the helper
  assert.deepEqual(testsReaching(['extension/ladder/deep.js'], {web, tree}), ['test/unit/shared/uses-helper.test.js']);   // helper -> shapes.js -> deep.js
});

test('a folder a test names is read as a folder, and a Python guard counts like a node one (joined path: tests/)', () => {
  const {web, tree} = trees();
  assert.deepEqual(testsReaching(['desktop/renderer/app.js'], {web, tree}), ['test/layout.test.js']);   // path.join(root, 'desktop', 'renderer')
  assert.deepEqual(testsReaching(['.github/workflows/daily.yml'], {web, tree}), ['test/python/test_site_pipefail.py']);   // ROOT / '.github' / 'workflows'
  assert.deepEqual(webTests(web).sort(), ['test/layout.test.js', 'test/python/test_site_pipefail.py', NIGHT, 'test/unit/shared/uses-helper.test.js', 'test/unit/unrelated.test.js']);
});
