// One press to apply (owner, 5 Nov 2026: "Preparing the kit separately by the user, without applying brings no value"): a kit is made only by Apply, on this computer.
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {draftMissing} from '../../../lib/apply.js';
import {registerKitHandlers, stoppedWith} from '../../../lib/kit-handlers.js';
import {dailyArgs} from '../../../lib/pipeline-args.js';
import * as pipeline from '../../../lib/pipeline.js';

const read = path => readScreenSource(new URL(`../../../${path}`, import.meta.url), 'utf8');
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
function prepareKit({settings = {}, aiReady = () => true, syncJobs = async () => false, engineRun} = {}) {
  const handlers = new Map(), notes = [];
  const storage = {settings: () => settings, secret: () => '', path: name => `/fake/${name}`};
  const handed = registerKitHandlers({DEMO: true, aiReady, allowanceBlock: async () => null, app: {on: () => {}}, cloud: () => true, ipcMain: {handle: (name, run) => handlers.set(name, run)}, log: () => {}, needsNotion: () => null,
    notify: title => notes.push(title), powerMonitor: {on: () => {}}, shell: {}, storage, syncJobs, track: () => {}, ...(engineRun ? {engineRun} : {}),
    dispatchCloud: () => { throw new Error('a kit never goes to GitHub'); }});
  return {press: () => handed.prepareKitFor('ab12cd34', 'Analyst · Birch'), notes, handed};
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

const POSTING_UNREAD = "This job's posting could not be read, so no application was written.";
const stoppedRun = async (_storage, _args, onLine) => { onLine('Reading the form'); onLine(`⚠️ ${POSTING_UNREAD}`); return {code: pipeline.JOB_STOPPED}; };

test('a job the engine stopped says why at the press, once, naming the job', async () => {
  const {press, notes} = prepareKit({engineRun: stoppedRun});
  assert.deepEqual(await press(), {ok: false, stopped: true, error: `Analyst · Birch: ${POSTING_UNREAD}`});
  assert.equal(notes.length, 0, 'the press shows it; a notification would say it twice');
});

test('in a batch the stopped job is also notified, so a batch that started others still says it', async () => {
  const {handed, notes} = prepareKit({engineRun: stoppedRun});
  assert.equal((await handed.prepareKitFor('ab12cd34', 'Analyst · Birch', {quiet: true})).error, `Analyst · Birch: ${POSTING_UNREAD}`);
  assert.deepEqual(notes, ['Application could not be prepared']);
});

test('quiet kit preparation preserves the engine eligibility reason for an Apply batch summary', async () => {
  const engineRun = async (_storage, _args, onLine) => { onLine('Not eligible'); onLine('required credential missing.'); return {code: 0}; };
  const {handed} = prepareKit({engineRun});
  assert.deepEqual(await handed.prepareKitFor('ab12cd34', 'Analyst · Birch', {quiet: true}), {ok: true, ineligible: 'Not eligible: required credential missing.'});
});

test('quiet kit preparation preserves the last technical error for an Apply batch summary', async () => {
  const engineRun = async (_storage, _args, onLine) => { onLine('The application kit could not be saved.'); return {code: 1}; };
  const {handed} = prepareKit({engineRun});
  assert.deepEqual(await handed.prepareKitFor('ab12cd34', 'Analyst · Birch', {quiet: true}), {ok: false, ineligible: '', error: 'The application kit could not be saved.'});
});

test('the app and the engine agree on the stop code', () => {
  assert.match(readScreenSource(new URL('../../../../src/ai/kit.py', import.meta.url), 'utf8'), new RegExp(`^JOB_STOPPED = ${pipeline.JOB_STOPPED}\\b`, 'm'));
});

test('only the engine\'s own stop code is a reason in words: a crash or a run that worked never is', () => {
  assert.equal(stoppedWith(pipeline.JOB_STOPPED, ['⚠️ It stopped.']), 'It stopped.');
  assert.equal(stoppedWith(pipeline.JOB_STOPPED, ['⚠️ It stopped.', 'AI: waiting for an answer']), 'It stopped.', 'a line printed at exit does not hide it');
  assert.equal(stoppedWith(1, ['⚠️ An early warning', 'Traceback (most recent call last):', 'TypeError: x']), '');
  assert.equal(stoppedWith(0, ['⚠️ A warning on a run that worked']), '');
});

const openJobs = codes => codes.map((code, index) => ({code, url: `https://jobs.example/${code}`, title: 'Analyst', company: 'Birch', status: 'saved', stage: 'Saved', fit: 90 - index}));

test('a stopped job does not hold a batch: the next best job is tried in its place', async () => {
  const asked = [], lines = [];
  const prepare = async ({code}) => { asked.push(code); return code === 'a' ? {ok: false, stopped: true, error: 'a: unread'} : {ok: true}; };
  const result = await draftMissing(openJobs(['a', 'b', 'c']), 1, prepare, line => lines.push(line));
  assert.deepEqual(asked, ['a', 'b']);
  assert.deepEqual(result, {done: 1, why: 'a: unread', codes: ['a', 'b'], outcomes: [
    {url: 'https://jobs.example/a', title: 'Analyst', company: 'Birch', status: 'failed', reason: 'a: unread'},
    {url: 'https://jobs.example/b', title: 'Analyst', company: 'Birch', status: 'prepared', reason: ''},
  ]});
  assert.ok(lines.every(line => line.startsWith('Preparing application 1 of 1')), lines.join(' | '));
});

test('a batch of stopped jobs ends after three spare tries, and a job that failed uses its try', async () => {
  const asked = [];
  const stopping = async ({code}) => { asked.push(code); return {ok: false, stopped: true, error: `${code}: unread`}; };
  assert.equal((await draftMissing(openJobs(['a', 'b', 'c', 'd', 'e', 'f']), 1, stopping)).done, 0);
  assert.deepEqual(asked, ['a', 'b', 'c', 'd']);
  asked.length = 0;
  await draftMissing(openJobs(['a', 'b']), 1, async ({code}) => { asked.push(code); return {ok: false}; });
  assert.deepEqual(asked, ['a']);
});

test('a rejected kit preparation keeps its technical reason on that job outcome', async () => {
  const reason = 'The application record could not be written.';
  const result = await draftMissing(openJobs(['rejected']), 1, async () => { throw new Error(reason); });
  assert.deepEqual(result.outcomes, [{url: 'https://jobs.example/rejected', title: 'Analyst', company: 'Birch', status: 'failed', reason}]);
});
