// Guard: privacy — fixer test failures remain visible without publishing credentials or personal paths from sandbox output.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../../../..');

const workflow = 'ai-fixer.yml';
test(`${workflow}: a Python failure streams redacted evidence and remains a failed step`, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixer-suite-log-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const snapshot = path.join(dir, 'fbt');
  fs.mkdirSync(path.join(snapshot, 'tools/fixer'), {recursive: true});
  fs.mkdirSync(path.join(snapshot, 'desktop/lib'), {recursive: true});
  for (const file of ['tools/fixer/suite-log.mjs', 'tools/fixer/leaks.mjs', 'desktop/lib/feedback-bundle.js']) {
    if (fs.existsSync(path.join(root, file))) fs.copyFileSync(path.join(root, file), path.join(snapshot, file));
  }
  fs.writeFileSync(path.join(snapshot, 'tools/feedback-ai-sandbox.sh'), `#!/bin/bash
if [[ "$*" == *python3* ]]; then
  printf '%s\\n' 'FAIL: test_saved_title (tests.unit.test_example.Example)' 'api_key=sk-fixture12345678901234567890' 'fixture@example.com /Users/Fixture/work/test_example.py' 'phones: +41 79 123 45 67 and 123-456-7890' 'fixtu​re@example.com' '-----BEGIN PRIVATE KEY-----' 'private-key-fixture-content' '-----END PRIVATE KEY-----' '::error::not a workflow command' 'AssertionError: 1 != 2' 'Ran 7 tests' 'FAILED (failures=1)'
  exit 1
fi
printf '%s\\n' 'OK: 1 file, 3 tests, 3 passed, 0 failed'
`);
  const source = fs.readFileSync(path.join(root, '.github/workflows', workflow), 'utf8');
  const prove = source.slice(source.indexOf('\n  prove:'), source.indexOf('\n  publish:'));
  const blocks = [...prove.matchAll(/      - name: ([^\n]+)\n        run: \|\n((?:          .*\n)+)/g)]
    .filter(([, , body]) => /npm test|unittest discover/.test(body));
  let output = '', status;
  for (const [, , body] of blocks) {
    const done = spawnSync('bash', ['-c', body.replace(/^          /gm, '')], {encoding: 'utf8', env: {...process.env, RUNNER_TEMP: dir, FBT: snapshot}});
    output += done.stdout + done.stderr; status = done.status;
    if (status) break;
  }
  assert.equal(status, 1, 'the failing suite cannot turn green through the log pipe');
  assert.match(output, /FAIL: test_saved_title/);
  assert.match(output, /AssertionError: 1 != 2/);
  const stored = fs.readFileSync(path.join(dir, 'python-suite.log'), 'utf8');
  for (const evidence of [output, stored]) {
    for (const secret of ['sk-fixture12345678901234567890', 'fixture@example.com', '/Users/Fixture', '+41 79 123 45 67', '123-456-7890', 'private-key-fixture-content']) assert.ok(!evidence.includes(secret), secret);
    assert.doesNotMatch(evidence, /^::error::not a workflow command/m);
    assert.match(evidence, /FAILED \(failures=1\)/);
  }
  assert.match(prove, /if: always\(\)/, 'evidence is kept even when the suite fails');
  assert.match(prove, /name: (?:fixer|fd-ai)-proof-logs/);
});
