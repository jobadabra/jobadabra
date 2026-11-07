// Guard: privacy — the GitHub issue of a desktop tester's bug carries the tester's (already scrubbed) sentences and the bundle's link only: no picture, no log, no state; a low bug is not filed; a repeat is a comment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {bodyOf, fileAll, fileFinding} from '../../lib/tester-issue.mjs';

const FILE = {version: 1, source: 'desktop-tester', bundleId: '0123456789abcdef', bundleUrl: 'https://www.jobadabra.top/admin/bug-bundle/0123456789abcdef', at: '2026-11-07T10:00:00.000Z',
  report: {title: 'Phone label is shown twice', journey: 'J12', severity: 'high', expected: 'one phone label', seen: 'the label shows twice', steps: ['Open Profile', 'Press Save']}};
const fake = (open = []) => { const calls = []; return {calls, gh: args => { calls.push(args); if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(open); if (args[0] === 'issue' && args[1] === 'create') return 'https://github.com/jobadabra/jobadabra/issues/77'; return ''; }}; };

test('the issue is the Finder\'s layout with the bundle line: sentences and link only, labelled source:desktop-tester', async () => {
  const body = bodyOf(FILE);
  assert.match(body, /found by Claude Desktop testing the live-test twin/);
  assert.match(body, /### What it expected\none phone label/);
  assert.match(body, /### Evidence bundle\n`0123456789abcdef` \(private, Admin only\)/);
  assert.match(body, /npm run twin -- --replay 0123456789abcdef/);
  assert.ok(!/!\[|<details>|\.jpg|\.png/.test(body), 'no picture, no collapsed log');
  const {calls, gh} = fake();
  const result = await fileFinding(FILE, {gh, repo: 'o/r'});
  assert.deepEqual([result.action, result.issue], ['filed', 77]);
  const create = calls.find(args => args[0] === 'issue' && args[1] === 'create');
  const labels = create[create.indexOf('--label') + 1].split(',');
  assert.ok(labels.includes('source:desktop-tester') && labels.includes('severity:high') && labels.includes('journey:J12') && labels.includes('auto-ui'));
  assert.ok(labels.some(label => label.startsWith('fp:')));
});

test('a repeat of an open bug is a comment with the new bundle, a low bug and a bad id are not filed', async () => {
  const {calls, gh} = fake([{number: 12}]);
  assert.deepEqual(await fileFinding(FILE, {gh, repo: 'o/r'}), {action: 'seen-again', issue: 12});
  assert.ok(calls.some(args => args[1] === 'comment' && args[2] === '12') && !calls.some(args => args[0] === 'issue' && args[1] === 'create'));
  const none = fake();
  assert.equal((await fileFinding({...FILE, report: {...FILE.report, severity: 'low'}}, {gh: none.gh})).action, 'skipped');
  assert.equal((await fileFinding({...FILE, bundleId: '../x'}, {gh: none.gh})).action, 'skipped');
  assert.equal(none.calls.length, 0);
});

test('fileAll moves a filed finding to done/ and a failing one to failed/ with its error, so a restart never files twice', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tester-issue-'));
  try {
    const dir = path.join(home, 'tester-findings');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '0123456789abcdef.json'), JSON.stringify(FILE));
    fs.writeFileSync(path.join(dir, 'fedcba9876543210.json'), JSON.stringify({...FILE, bundleId: 'fedcba9876543210'}));
    const ok = fake();
    let first = true;
    const gh = args => { if (args[0] === 'issue' && args[1] === 'create' && first) { first = false; throw new Error('gh: not logged in'); } return ok.gh(args); };
    const said = [];
    const results = await fileAll(home, {gh, repo: 'o/r', say: line => said.push(line)});
    assert.deepEqual(results.map(result => result.action).sort(), ['failed', 'filed']);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['done', 'failed']);
    assert.match(fs.readFileSync(path.join(dir, 'failed', fs.readdirSync(path.join(dir, 'failed')).find(name => name.endsWith('.txt'))), 'utf8'), /not logged in/);
    assert.equal(said.length, 2);
    assert.deepEqual(await fileAll(home, {gh: ok.gh}), [], 'nothing left to file');
  } finally { fs.rmSync(home, {recursive: true, force: true}); }
});

test('a file that cannot be moved aside after filing is reported, never thrown: one bad file cannot stop the launcher', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tester-issue-'));
  try {
    const dir = path.join(home, 'tester-findings');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '0123456789abcdef.json'), JSON.stringify(FILE));
    fs.writeFileSync(path.join(dir, 'done'), 'a file where the done folder should be');
    const said = [];
    const results = await fileAll(home, {gh: fake().gh, repo: 'o/r', say: line => said.push(line)});
    assert.equal(results[0].action, 'filed');
    assert.match(results[0].why, /could not move the file aside/);
    assert.match(said[0], /could not move/);
  } finally { fs.rmSync(home, {recursive: true, force: true}); }
});

test('a journey that is not one word does not become a label that would break the issue', async () => {
  const {calls, gh} = fake();
  await fileFinding({...FILE, report: {...FILE.report, journey: 'J3, J4'}}, {gh, repo: 'o/r'});
  const create = calls.find(args => args[0] === 'issue' && args[1] === 'create');
  assert.ok(!create[create.indexOf('--label') + 1].includes('journey:'));
});
