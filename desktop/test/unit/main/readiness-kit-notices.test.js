// Which kit notices show when Apply readiness drafts a kit, by who asked: a batch says a job that could not be prepared (as its old direct draft did), a press on one job says all, the Jobs check none.
// Why (8 Nov 2026, code review of R2): the batch's "could not be prepared" notice was lost when every caller went through the step silently.
import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {registerApplyHandlers} from '../../../lib/apply-handlers.js';

const here = path.resolve(import.meta.dirname, '../../..');
const JOB = {url: 'https://jobs.example.test/a', code: 'a1', title: 'Analyst', company: 'Birch', posted_at: '2026-11-01'};

function rig() {
  const handles = new Map(), drafts = [];
  // A draft that answers a refusal ends the step before any store or browser call: only the options passed to the kit draft are under test.
  const prepareKitFor = async (code, name, options) => { drafts.push([code, name, options]); return {ok: false, error: 'not drafted'}; };
  registerApplyHandlers({DEMO: false, extensionGate: () => null, allowanceBlock: () => null, needsNotion: () => null, claudeConsent: async () => true, staleNote: () => '',
    background: {enqueue: async () => ({ok: true}), handle: () => ({}), cancelTriage: async () => {}, canQueue: () => ({ok: true})},
    applyRunner: {start: async (_storage, _options, _open, _list, _launch, _next, prepare) => { await prepare(JOB); return {ok: true}; }, applyOne: async () => ({ok: true}), openOne: () => ({ok: true})},
    ipcMain: {handle: (name, fn) => handles.set(name, fn)}, log: () => {}, here, toWindow: () => {}, track: () => {}, prepareKitFor, startClaude: () => ({}),
    getRecipeReporter: () => null, cloud: {}, storage: {settings: () => ({apply: {mode: 'check', chosenAt: 'c1'}})}});
  return {handles, drafts};
}

test('a batch says a kit that could not be prepared, naming role and employer; a press says all; the Jobs check says nothing', async () => {
  const {handles, drafts} = rig();
  await handles.get('apply')({}, {n: 1, mode: 'settings'});
  await handles.get('applyReadiness')({}, JOB, {say: true});
  await handles.get('applyReadiness')({}, JOB);
  assert.deepEqual(drafts, [['a1', 'Analyst · Birch', {quiet: true}], ['a1', 'Analyst', {}], ['a1', 'Analyst', {quiet: true, silent: true}]]);
});
