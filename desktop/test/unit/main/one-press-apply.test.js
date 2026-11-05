// One press to apply (owner, 5 Nov 2026: "Preparing the kit separately by the user, without applying brings no value"): a kit is made only by Apply, on this computer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {draftMissing} from '../../../lib/apply.js';
import {registerKitHandlers} from '../../../lib/kit-handlers.js';
import {dailyArgs} from '../../../lib/pipeline-args.js';
import * as pipeline from '../../../lib/pipeline.js';

const read = path => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const storageWith = schedule => ({settings: () => ({schedule}), secret: name => (name === 'ANTHROPIC_API_KEY' ? 'sk-fake' : ''), path: name => `/fake/${name}`});

test('a search never drafts kits by itself, even for someone who had turned the setting on', () => {
  const args = dailyArgs(storageWith({kits: 3}), {mode: 'run'});
  assert.ok(!args.includes('--auto-kit-max'), args.join(' '));
});

test('Settings has no Draft applications row and no Application preparation line', () => {
  const html = read('renderer/index.html');
  assert.doesNotMatch(html, /data-schedule="kits"|Draft applications|id="ov-kits"|Application preparation/);
});

// The real handler with the app's services faked; the demo switch keeps the engine from running, and its scripted run is cut short.
process.env.JOBADABRA_DEMO_SEARCH_SECONDS = '0.01';
function prepareKit({settings = {}, aiReady = () => true, syncJobs = async () => false} = {}) {
  const handlers = new Map(), notes = [];
  const storage = {settings: () => settings, secret: () => '', path: name => `/fake/${name}`};
  registerKitHandlers({DEMO: true, aiReady, allowanceBlock: async () => null, app: {on: () => {}}, cloud: () => true, ipcMain: {handle: (name, run) => handlers.set(name, run)}, log: () => {}, needsNotion: () => null,
    notify: title => notes.push(title), powerMonitor: {on: () => {}}, shell: {}, storage, syncJobs, track: () => {},
    dispatchCloud: () => { throw new Error('a kit never goes to GitHub'); }});
  return {press: () => handlers.get('prepareKit')({}, 'ab12cd34', 'Analyst · Birch'), notes};
}

test('with Always on, Apply prepares here: nothing sends a kit to GitHub', async () => {
  pipeline.setDemo(true);
  const {press, notes} = prepareKit({settings: {cloud: {repo: 'someone/search'}}});
  await press();
  assert.equal(notes.length, 1, 'the run ended here and said so');
  assert.doesNotMatch(read('renderer/pages/jobs-render.js'), /Preparing on GitHub|result\.cloud/);
});

test('with Always on, the job database is brought up to date before the kit is written, so the posting text is there', async () => {
  pipeline.setDemo(true);
  const order = [];
  const {press, notes} = prepareKit({settings: {cloud: {repo: 'someone/search'}}, syncJobs: async () => { order.push(`sync, ${notes.length} notes`); }});
  await press();
  assert.deepEqual(order, ['sync, 0 notes']);
  assert.equal(notes.length, 1);
});

test('a job database that cannot be read from GitHub never stops the kit', async () => {
  pipeline.setDemo(true);
  const {press, notes} = prepareKit({settings: {cloud: {repo: 'someone/search'}}, syncJobs: async () => { throw new Error('offline'); }});
  await press();
  assert.equal(notes.length, 1);
});

test('without Always on nothing is read from GitHub', async () => {
  pipeline.setDemo(true);
  let synced = 0;
  await prepareKit({syncJobs: async () => { synced++; }}).press();
  assert.equal(synced, 0);
});

test('no AI on this computer: Apply says so in words, and no run starts', async () => {
  pipeline.setDemo(true);
  const {press, notes} = prepareKit({aiReady: () => false});
  assert.deepEqual(await press(), {ok: false, error: 'Choose your AI in Settings → Connections → AI first.'});
  assert.equal(notes.length, 0);
});

test('a batch that could prepare nothing gives the reason it was told, not the general words', async () => {
  const jobs = [{code: 'ab12cd34', url: 'https://jobs.example/1', title: 'Analyst', company: 'Birch', status: 'saved', stage: 'Saved'}];
  const refused = async () => ({ok: false, error: 'Choose your AI in Settings → Connections → AI first.'});
  assert.equal((await draftMissing(jobs, 1, refused)).why, 'Choose your AI in Settings → Connections → AI first.');
  assert.equal((await draftMissing(jobs, 1, async () => ({ok: false}))).why, '');
});
