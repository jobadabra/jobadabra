// Job: report health
// Guard: privacy — a run's record never carries a screenshot's bytes, and nothing leaves the Mac without CI's key (a local run sends nothing); the record goes last so the Admin tab never lists a run missing its files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runRecord, shotFiles, MAX_SHOTS} from '../../lib/agent-run-record.mjs';
import {runFiles, uploadAgentRun} from '../../lib/agent-run-upload.mjs';

const PNG = Buffer.from('not-really-a-png').toString('base64');
const note = (over = {}) => ({goal: 1, title: 'A', type: 'bug', kind: 'visual', severity: 'medium', view: 'jobs', expected: 'e', observed: 'o', why: 'w', judge: 'confirmed', judgeReason: 'r', videoSec: 12, control: {x: 1, y: 2, w: 3, h: 4, window: {w: 1440, h: 900}}, trail: ['clicked A'], image: PNG, ...over});
const session = notes => ({stopped: 'goals', notes, trace: [{goal: 1, n: 1, action: 'click', did: 'clicked A', view: 'jobs', failed: false}],
  summary: {persona: 'Ana', seed: 20261103, goals: [{n: 1, group: 'jobs', label: 'Open a job', verdict: 'bug', summary: 's', steps: 3}], filed: [notes[0]], cost: {calls: 4, tokensIn: 1000, tokensOut: 500, ms: 120000}}});
const meta = {run: '41870000000', at: '2026-11-04T04:40:00Z', kind: 'night', commit: 'abcdef1', plan: ''};

test('the record names each note’s picture and carries no image bytes', () => {
  const record = runRecord(session([note(), note({title: 'B', image: ''})]), meta, {secs: 90, bytes: 1000});
  assert.deepEqual(record.notes.map(each => each.shot), [1, 0]);
  assert.equal(record.notes[0].filed, true);
  assert.equal(record.notes[1].filed, false);
  assert.equal(record.cost.tokens, 1500);
  assert.equal(JSON.stringify(record).includes(PNG), false);
  assert.equal(JSON.stringify(record).includes('"image"'), false);
});

test('pictures are numbered in the record’s order and a note past the store’s cap keeps no picture', () => {
  const many = Array.from({length: MAX_SHOTS + 2}, (_, i) => note({title: `n${i}`}));
  const record = runRecord(session(many), meta);
  assert.equal(record.notes.at(-1).shot, 0);
  const files = shotFiles(many);
  assert.equal(files.length, MAX_SHOTS);
  assert.equal(files[0].name, 'shot-1.png');
  assert.equal(files[0].data.toString(), 'not-really-a-png');
});

const folder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-run-'));
  fs.writeFileSync(path.join(dir, 'agent-run.json'), '{}');
  fs.writeFileSync(path.join(dir, 'agent-video.webm'), 'v');
  for (const name of ['shot-2.png', 'shot-10.png', 'shot-1.png']) fs.writeFileSync(path.join(dir, name), 'p');
  return dir;
};

test('the files go pictures first, the video next and the record last', () => {
  assert.deepEqual(runFiles(folder()).map(file => file.name), ['shot-1.png', 'shot-2.png', 'shot-10.png', 'video.webm', 'run.json']);
});

test('a local run, a run without the key, or a missing run id sends nothing', async () => {
  const calls = [];
  const fetcher = async (...args) => { calls.push(args); return {ok: true}; };
  const dir = folder();
  assert.match(await uploadAgentRun(dir, '41870000000', {env: {REPLAYS_PUBLISH_KEY: 'k'}, fetcher}), /local run/);
  assert.match(await uploadAgentRun(dir, '41870000000', {env: {CI: 'true'}, fetcher}), /no REPLAYS_PUBLISH_KEY/);
  assert.match(await uploadAgentRun(dir, 'local', {env: {CI: 'true', REPLAYS_PUBLISH_KEY: 'k'}, fetcher}), /no run id/);
  assert.match(await uploadAgentRun(dir, '41870000000', {env: {CI: 'true', REPLAYS_PUBLISH_KEY: 'k', JP_CI_ROWS_DRY: '1'}, fetcher}), /dry run/);
  assert.equal(calls.length, 0);
});

test('in CI with the key every file is sent with the key, and a refused file is named without failing', async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push({url, init}); return {ok: !url.endsWith('video.webm'), status: 413}; };
  const line = await uploadAgentRun(folder(), '41870000000', {env: {CI: 'true', REPLAYS_PUBLISH_KEY: 'k'}, fetcher});
  assert.equal(calls.length, 5);
  assert.match(calls.at(-1).url, /run=41870000000&file=run\.json$/);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
  assert.match(line, /sent 4 of 5/);
  assert.match(line, /video\.webm \(413\)/);
  const down = await uploadAgentRun(folder(), '41870000000', {env: {CI: 'true', REPLAYS_PUBLISH_KEY: 'k'}, fetcher: async () => { throw new Error('offline'); }});
  assert.match(down, /sent 0 of 5.*offline/);
});
