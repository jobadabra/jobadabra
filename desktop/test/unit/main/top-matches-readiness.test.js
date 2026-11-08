// Prepare top matches on this Mac is Apply readiness on the top matches: each of the best open jobs without a kit goes through the one step (its kit, then its form check), saying its own notices.
// Why (8 Nov 2026, owner, R2: "every Apply goes through Apply readiness"; spec 2026-11-07-apply-readiness-design.md answer 2): it ran the engine's kits mode, which drafted kits and never read a form.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {keepReadiness} from '../../../lib/apply-readiness-registry.js';
import {registerJobActionsHandlers} from '../../../lib/job-actions-handlers.js';

const row = (code, fit, more = {}) => ({code, url: `https://jobs.example/${code}`, title: 'Analyst', company: 'Birch', status: 'unreviewed', fit, posted_at: '2026-11-01', ...more});

function rig(jobs) {
  const handlers = new Map(), storage = {settings: () => ({})}, asked = [];
  let finished;
  const done = new Promise(resolve => { finished = resolve; });
  keepReadiness(storage, {applyReadiness: async (job, options) => { asked.push([job.code, options]); if (asked.length === 3) finished(); return {kit: {ok: true}, check: null}; }});
  registerJobActionsHandlers({DEMO: false, allowanceBlock: async () => null, cloud: () => false, dispatchCloud: () => { throw new Error('this Mac only'); }, ipcMain: {handle: (name, fn) => handlers.set(name, fn)},
    log: () => {}, needsNotion: () => null, storage, jobsList: async () => ({jobs})});
  return {press: () => handlers.get('command')({}, 'kits'), asked, done};
}

test('the three best open jobs without a kit each go through Apply readiness, with their notices', async () => {
  const {press, asked, done} = rig([row('low', 40), row('a', 95), row('kitted', 99, {kit: true}), row('b', 90), row('gone', 97, {status: 'applied'}), row('c', 80), row('d', 70)]);
  const answer = await press();
  assert.match(answer.text, /apply readiness on your top 3 matches/i);
  await done;
  assert.deepEqual(asked.map(([code]) => code), ['a', 'b', 'c'], 'best fit first; a job with a kit, an applied one and a low fit are left out');
  assert.ok(asked.every(([, options]) => options?.say === true), 'each says its own kit notice');
});

test('no top match lacks a kit: nothing runs and the answer says so', async () => {
  const {press, asked} = rig([row('a', 95, {kit: true})]);
  assert.match((await press()).text, /nothing to prepare/);
  assert.deepEqual(asked, []);
});
