// The bundle's pure parts (lib/tester-bundle.js): the ±5 minute log window, redaction, the caps and the upload's error words.
// Guard: privacy — the bundle of a twin is built from real logs and rows; secrets, e-mails and the home folder must be gone before it leaves.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {testerLogs, testerReport, testerState, uploadBundle, windowLines} from '../../../lib/tester-bundle.js';

const AT = new Date('2026-11-07T10:00:00Z');

test('only the lines within five minutes of the capture are kept, oldest first; a wrapped line with no time is dropped', () => {
  const lines = ['2026-11-07T09:54:59.000Z [x] too early', '2026-11-07T09:55:01.000Z [x] in', 'continuation', '2026-11-07T10:05:00.000Z [x] edge', '2026-11-07T10:05:01.000Z [x] too late'];
  assert.deepEqual(windowLines(lines, AT), [lines[1], lines[3]]);
  assert.deepEqual(windowLines(lines, 'not a date'), []);
});

test('the logs text is redacted, holds the window of both logs, and stays under the cap by dropping the oldest', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tester-logs-'));
  try {
    const old = Array.from({length: 400}, (_, i) => `2026-11-07T09:56:${String(i % 60).padStart(2, '0')}.000Z [ext] line ${i} ana@example.org sk-ant-api03-FAKEFAKEFAKEFAKEFAKE1234567890`);
    fs.writeFileSync(path.join(folder, 'app.log'), `2026-11-06T09:00:00.000Z [x] yesterday\n${old.join('\n')}\n`);
    fs.writeFileSync(path.join(folder, 'engine.log'), '2026-11-07T10:01:00.000Z [engine] hello\n');
    const full = testerLogs({folder, at: AT, state: {version: '1'}});
    assert.ok(!full.text.includes('yesterday'));
    assert.ok(!full.text.includes('ana@example.org') && !full.text.includes('sk-ant'));
    assert.match(full.text, /== engine\.log \(1 lines/);
    const small = testerLogs({folder, at: AT, state: {version: '1'}, max: 6000});
    assert.ok(small.bytes <= 6000, `${small.bytes} bytes`);
    assert.ok(small.lines.app < 400 && small.lines.app > 0);
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('state.json is redacted, and a record over the cap is cut to the newest session', () => {
  const text = testerState({sessions: [{id: 's1', url: 'https://x.test/job?token=abc', note: 'mail ana@example.org'}], job: {title: 'Designer'}});
  assert.ok(!text.includes('ana@example.org'));
  assert.equal(JSON.parse(text).job.title, 'Designer');   // the url's ?token=… must not break the JSON
  assert.ok(!text.includes('token=abc'));
  const named = JSON.parse(testerState({sessions: [{token: 'short', apiKey: 'abc123', password: 'hunter2', accountHost: 'x.test'}], job: null}));
  assert.deepEqual(named.sessions[0], {token: '<secret>', apiKey: '<secret>', password: '<secret>', accountHost: 'x.test'});
  const big = testerState({sessions: [{id: 'a', pad: 'x'.repeat(300)}, {id: 'b'}], job: null}, {max: 200});
  assert.ok(Buffer.byteLength(big) <= 200 || JSON.parse(big).note);
});

test('the report needs a severity, expected and seen; steps may be text; the title falls back to the seen words', () => {
  assert.match(testerReport({severity: 'x', expected: 'a', seen: 'b'}).error, /Severity/);
  assert.match(testerReport({severity: 'low', expected: '', seen: 'b'}).error, /expected/);
  const {report} = testerReport({severity: 'HIGH', expected: 'a', seen: 'saw it', steps: 'one\n\ntwo'}, AT);
  assert.deepEqual([report.severity, report.steps, report.title, report.journey, report.at], ['high', ['one', 'two'], 'saw it', 'none', AT.toISOString()]);
});

test('an upload answers its id, names skipped files, and says words for a refusal or a network failure', async () => {
  const ok = await uploadBundle({source: 'persona', key: 'k', report: {}, files: {'logs.txt': 't', 'tab.jpg': ''}}, {fetcher: async (url, init) => { assert.ok(!JSON.parse(init.body).files['tab.jpg']); return Response.json({id: 'abc', url: 'u', skipped: ['app.jpg']}); }});
  assert.deepEqual(ok, {ok: true, id: 'abc', url: 'u', skipped: ['app.jpg']});
  assert.match((await uploadBundle({source: 'persona', key: 'k', report: {}}, {fetcher: async () => new Response('no', {status: 404})})).error, /404/);
  assert.match((await uploadBundle({source: 'persona', key: 'k', report: {}}, {fetcher: async () => { throw new Error('offline'); }})).error, /offline/);
});
