// Always on on our servers: "Apply readiness on the top matches" reads the forms in the cloud browser (cloud browser runner 3/4, lib/cloud-read.js) and hands each read to the one step.
// Owner, 9 Nov 2026 (asked via AskUserQuestion): "Ship it (Recommended)" for the name, the result line "3 jobs checked: 2 simple, 1 needs you" and the button; reads are within the person's AI credit and the site's cap.
// Each test plays what the person sees: the press, the run in Activity, the line, the refusal in the site's own words.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {keepReadiness} from '../../../lib/apply-readiness-registry.js';
import {cloudReadOf} from '../../../lib/apply-readiness-registry.js';
import {registerJobActionsHandlers} from '../../../lib/job-actions-handlers.js';
import * as pipeline from '../../../lib/pipeline.js';

const row = (code, fit) => ({code, url: `https://jobs.example/${code}`, title: 'Analyst', company: 'Birch', status: 'unreviewed', fit, posted_at: '2026-11-01'});
const SIMPLE = {eligible: true, simple: true, captcha: false, login: false, accountCreation: false, questions: [], match: {missing: [], unnamed: 0, unjudged: 0}}, NEEDS = {eligible: true, simple: false, why: 'questions', captcha: false, login: false, accountCreation: false};
function memory() {
  const files = new Map(), settings = {hostedSearch: {on: true}};
  return {settings: () => settings, saveSettings: patch => Object.assign(settings, patch), readText: name => { if (!files.has(name)) throw new Error('none'); return files.get(name); }, writeText: (name, text) => { files.set(name, text); }, files, secret: () => ''};
}
function rig({site, reads = {}} = {}) {
  const handlers = new Map(), storage = memory(), asked = [];
  let finished; const done = new Promise(resolve => { finished = resolve; });
  keepReadiness(storage, {cancel: () => {}, applyReadiness: async job => { asked.push(job.code); const check = await cloudReadOf(storage).readForm(job); if (asked.length === 3) finished(); return {kit: {ok: true}, check}; }});
  registerJobActionsHandlers({DEMO: false, allowanceBlock: async () => null, cloud: () => false, dispatchCloud: () => { throw new Error('not the engine'); }, ipcMain: {handle: (name, fn) => handlers.set(name, fn)},
    log: () => {}, needsNotion: () => null, storage, jobsList: async () => ({jobs: [row('a', 95), row('b', 90), row('c', 80)]}), cloudSite: site});
  return {press: () => handlers.get('command')({}, 'kits'), asked, done, storage};
}
const site = (script = {}) => {
  const calls = [];
  return {calls, readSend: async (_, jobs, options) => { calls.push(['send', jobs.map(job => job.id), options.ai]); return script.send || {ok: true}; }, readStart: async () => { calls.push(['start']); return script.start || {ok: true}; },
    readTake: async () => { calls.push(['take']); return {ok: true, pending: 0, reads: [{job: 'a', state: 'read', read: SIMPLE}, {job: 'b', state: 'read', read: SIMPLE}, {job: 'c', state: 'read', read: NEEDS}]}; }, readStop: async () => { calls.push(['stop']); return {ok: true}; }};
};

test('a hosted Always on press posts the top matches once, runs each form through the step with its cloud read, and records "3 jobs checked: 2 simple, 1 needs you"', async () => {
  const fake = site(), {press, asked, done, storage} = rig({site: fake});
  const answer = await press();
  assert.match(answer.text, /cloud browser/);
  await done;
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(asked, ['a', 'b', 'c']);
  assert.deepEqual(fake.calls.filter(([name]) => name !== 'take'), [['send', ['a', 'b', 'c'], ''], ['start']], 'one batch, one start');
  const record = pipeline.runs(storage)[0];
  assert.equal(record.kind, 'kits');
  assert.equal(record.summary, '3 jobs checked: 2 simple, 1 needs you');
  assert.equal(cloudReadOf(storage), null, 'the run is over: the next read goes back to Chrome');
});

test("the site's refusal is said in its own words and nothing runs: credit used up (402) and today's cap (429)", async () => {
  for (const error of ['Your AI credit is used up. Add credit, or use your own Claude or ChatGPT key in Settings → Connections → AI (your own key is unlimited).', "Today's cloud checks are used up (30 of 30 forms). They start again tomorrow (00:00 UTC)."]) {
    const fake = site({send: {ok: false, status: 402, error}}), {press, asked} = rig({site: fake});
    assert.equal((await press()).text, `⚠️ ${error}`);
    assert.deepEqual(asked, []);
    assert.equal(fake.calls.some(([name]) => name === 'start'), false, 'nothing was started on the site');
    assert.equal((await press()).text, `⚠️ ${error}`, 'and the press is not left "already running"');
  }
});

test('without a hosted schedule the cloud read is not used: the press keeps its own path', async () => {
  const fake = site(), {press, storage} = rig({site: fake});
  storage.saveSettings({hostedSearch: {on: false}});
  await press().catch(() => {});
  assert.equal(fake.calls.length, 0, 'nothing posted to the site');
});
