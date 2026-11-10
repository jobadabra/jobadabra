// Guard: privacy — persona evidence uses tester IPC, replays receive no publisher credential, and bundle links survive Finder normalization.
import test from 'node:test';
import assert from 'node:assert/strict';
import {personaTesterEnv, captureNote, publishNotes} from '../../lib/agent-bundles.mjs';
import {appLaunchEnv} from '../../lib/app-env.mjs';
import {toFinding} from '../../lib/agent-notes.mjs';
import {normalize} from '../../lib/triage-findings.mjs';
import {issueBody, labelsFor} from '../../lib/triage-issues.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {triage} from '../../triage.mjs';

test('only a filing persona gets the publisher key and the test-app boundary permits no other alias', () => {
  const base = {AGENT_KIND: 'night', JOBADABRA_TESTER_KEY: 'publisher-fixture-key'};
  assert.deepEqual(personaTesterEnv({...base, AGENT_KIND: 'replay'}), {});
  const env = personaTesterEnv(base);
  assert.equal(appLaunchEnv(base, {...env, JOBADABRA_E2E: '1'}).JOBADABRA_TESTER_KEY, base.JOBADABRA_TESTER_KEY);
  assert.throws(() => appLaunchEnv(base, {...env, JOBADABRA_E2E: '1', JOBADABRA_OTHER: base.JOBADABRA_TESTER_KEY}), /credential override refused/);
  assert.throws(() => personaTesterEnv({AGENT_KIND: 'night'}), /publisher key/);
});

test('capture now, upload only selected notes, keep bundle link and source label in the issue', async () => {
  const calls = [];
  const page = {evaluate: async (fn, value) => {
    calls.push(value);
    return calls.length === 1 ? {captureId: 'capture-a', tester: 'persona'} : {ok: true, id: '0123456789abcdef', url: 'https://www.jobadabra.top/admin/bug-bundle/0123456789abcdef'};
  }};
  const note = {view: 'jobs', title: 'Wrong status', severity: 'high', kind: 'wrong-result', expected: 'jobs-3 Saved stage stays applied', observed: 'The applied job shows Not checked.', why: 'The stage is misleading.', trail: ['Open jobs'], judge: 'agrees'};
  note.captureId = await captureNote(page, note.view);
  note.shotFile = 'shot-1.png';
  await publishNotes(page, [note]);
  assert.equal(calls[1].captureId, 'capture-a');
  const finding = normalize({ui: [toFinding(note, {session: {run: '42563152361'}})]})[0];
  assert.equal(finding.file, 'shot-1.png', 'the Finder uses the actual note-time picture');
  const body = issueBody(finding, 'https://github.com/example/run');
  assert.match(body, /admin\/bug-bundle\/0123456789abcdef/);
  assert.match(body, /twin -- --replay 0123456789abcdef/);
  assert.ok(labelsFor(finding).includes('source:persona'));
  assert.ok(!JSON.stringify(note).includes('publisher-fixture-key'));
});

test('a failed upload or missing capture stays explicit and never calls real feedback', async () => {
  const note = {captureId: 'a', title: 'Broken', trail: []};
  await publishNotes({evaluate: async () => ({ok: false, error: 'store refused'})}, [note], () => {});
  assert.match(note.bundleError, /store refused/);
  assert.equal(note.bundle, undefined);
  const missing = {title: 'No capture'};
  await publishNotes({evaluate: async () => { throw new Error('must not send'); }}, [missing], () => {});
  assert.match(missing.bundleError, /capture/);
});

test('a repeat sighting adds this bundle link to the existing issue through the actual Finder branch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-bundle-finder-'));
  const oldKey = process.env.SELFHEAL_PUBLISH_KEY;
  delete process.env.SELFHEAL_PUBLISH_KEY;
  try {
    const note = {view: 'jobs', title: 'Wrong status', kind: 'wrong-result', severity: 'high', type: 'data', expected: 'jobs-3 Saved stage stays applied', observed: 'The applied job shows Not checked.', why: 'The stage is misleading.', judge: 'agrees', bundle: {id: '0123456789abcdef', url: 'https://www.jobadabra.top/admin/bug-bundle/0123456789abcdef'}};
    const raw = toFinding(note), finding = normalize({ui: [raw]})[0];
    fs.writeFileSync(path.join(dir, 'ui-findings.json'), JSON.stringify([raw]));
    const issue = {number: 42, state: 'OPEN', title: '[AI persona] jobs: Wrong status', labels: labelsFor(finding), body: issueBody(finding, 'https://example.test/runs/old'), comments: []};
    const writes = [];
    const gh = args => {
      if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(args.includes('300') ? [issue] : []);
      writes.push(args);
      return '[]';
    };
    const result = triage({artifacts: dir, runUrl: 'https://example.test/runs/new', gh, publish: () => ({}), repo: ''});
    assert.equal(result.again.length, 1);
    const comment = writes.find(args => args[0] === 'issue' && args[1] === 'comment' && args[2] === '42');
    assert.ok(comment);
    assert.match(comment.at(-1), /admin\/bug-bundle\/0123456789abcdef/);
  } finally {
    if (oldKey === undefined) delete process.env.SELFHEAL_PUBLISH_KEY; else process.env.SELFHEAL_PUBLISH_KEY = oldKey;
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
