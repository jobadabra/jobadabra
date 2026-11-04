// The AI user agent's video (lib/agent-video.mjs): off unless AGENT_VIDEO=1, one file and one json with the start time, and a note's clock time maps to a second in the video.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startAgentVideo, seekSeconds, VIDEO_FILE, VIDEO_META} from '../../lib/agent-video.mjs';

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-agent-video-'));

test('without AGENT_VIDEO=1 nothing is recorded and no file is written', async () => {
  const dir = folder();
  let started = false;
  const video = await startAgentVideo({}, {dir, minutes: 10, env: {}, start: async () => { started = true; return null; }});
  assert.equal(await video.finish(), null);
  assert.equal(started, false);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('with AGENT_VIDEO=1 the recorder gets the session cap plus a minute, and the video and its start time are kept', async () => {
  const dir = folder(), raw = path.join(dir, 'raw.webm'), seen = {};
  fs.writeFileSync(raw, 'webm');
  const video = await startAgentVideo({}, {dir, minutes: 20, env: {AGENT_VIDEO: '1'}, now: () => 1_000_000, start: async (_page, options) => { Object.assign(seen, options); return {stop: async () => ({path: raw, bytes: 4, secs: 90})}; }});
  const meta = await video.finish();
  assert.equal(seen.maxSeconds, 1260);
  assert.equal(seen.hardMaxSeconds, 1260);
  assert.deepEqual(meta, {file: VIDEO_FILE, startedAt: 1_000_000, secs: 90, bytes: 4});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, VIDEO_META), 'utf8')), meta);
  assert.equal(fs.readFileSync(path.join(dir, VIDEO_FILE), 'utf8'), 'webm');
});

test('no frame, no ffmpeg or a recorder that throws: no video, and the night goes on', async () => {
  const dir = folder();
  const none = await startAgentVideo({}, {dir, minutes: 5, env: {AGENT_VIDEO: '1'}, start: async () => ({stop: async () => null})});
  assert.equal(await none.finish(), null);
  const broken = await startAgentVideo({}, {dir, minutes: 5, env: {AGENT_VIDEO: '1'}, start: async () => { throw new Error('no ffmpeg'); }});
  assert.equal(await broken.finish(), null);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a note made at a clock time is found that many seconds into the video, never before its start', () => {
  assert.equal(seekSeconds({startedAt: 10_000}, 75_400), 65);
  assert.equal(seekSeconds({startedAt: 10_000}, 5_000), 0);
});
