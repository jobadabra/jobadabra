// A running task keeps every line the window was shown, not only its own output (7 Oct 2026: Find jobs using your browser' filter step reached the window through the
// app's log feed but not the task's log, so a reset Technical log came back with 4 lines of many).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as pipeline from '../../../lib/pipeline.js';

test("lines fed to the window during a task are kept in its log, the task's own lines once", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-keep-'));
  const files = {};
  const storage = {settings: () => ({}), secret: () => '', saveSettings: () => {}, path: (...parts) => path.join(dir, ...parts),
    readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; }};
  const windowFeed = line => pipeline.keep(line);   // what main.js log() does for every line it sends to the window
  let seen = null;
  await pipeline.work(storage, 'tailor', windowFeed, async tee => {
    tee('Reading 3 sites in your browser, 2 at a time');
    windowFeed('Visit filters: location Genève, keywords vendeur');   // a sub-step's line, sent to the window only
    tee('Reading LinkedIn in your browser…');
    seen = [...pipeline.running().log];
    return true;
  });
  assert.deepEqual(seen, ['Reading 3 sites in your browser, 2 at a time', 'Visit filters: location Genève, keywords vendeur', 'Reading LinkedIn in your browser…']);
  pipeline.keep('after the task: kept nowhere');
  assert.ok(!pipeline.runs(storage)[0].log.includes('after the task: kept nowhere'));
});

// #3639: Tailor CVs with nothing to tailor ended "Completed" + "See the CVs in Jobs". The row records how many things the run made (`made`), so the banner can tell.
test('an app task that returns {ok, made} keeps made on its row; a plain true records none', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-made-'));
  const files = {};
  const storage = {settings: () => ({}), secret: () => '', saveSettings: () => {}, path: (...parts) => path.join(dir, ...parts),
    readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; }};
  await pipeline.work(storage, 'tailor', () => {}, async () => ({ok: true, made: 0}));
  assert.equal(pipeline.runs(storage)[0].made, 0);
  assert.equal(pipeline.runs(storage)[0].ok, true, 'nothing to do is not a failure');
  await pipeline.work(storage, 'tailor', () => {}, async () => ({ok: true, made: 3}));
  assert.equal(pipeline.runs(storage)[0].made, 3);
  await pipeline.work(storage, 'visits', () => {}, async () => true);
  assert.ok(!('made' in pipeline.runs(storage)[0]));
});
