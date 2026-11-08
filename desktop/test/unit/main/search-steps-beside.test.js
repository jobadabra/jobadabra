// A Find jobs press after the first is one engine process: the job boards are read inside the search, beside the employer sites (plan docs/superpowers/plans/2026-11-07-the-press.md, E).
import test from 'node:test';
import assert from 'node:assert/strict';
import {searchSteps} from '../../../lib/search-steps.js';

const storage = (settings = {}) => ({settings: () => ({aiEngine: 'cli', ...settings}), saveSettings: patch => Object.assign(settings, patch), secret: () => ''});

test('a later press starts the search at once and discovers employers from the job boards inside it', async () => {
  // Why (8 Nov 2026, owner: "One process, discovery inside (Recommended)"): a separate boards step held the engine's run lock (src/paths.py) to ~60 s
  // and the employer read stops 67.5 s after the press, so employer sites got ~4 s (run 42411469318, p7). A step beside it waits for the lock all the same.
  let clock = Date.parse('2026-11-08T10:00:00Z');
  const steps = [];
  const exec = async (_storage, args, _onLine, env) => {
    steps.push({step: args[1], args, at: (clock - Number(env.JOBADABRA_SEARCH_AT) * 1000) / 1000});
    clock += 60000;
    return {code: 0, result: {}};
  };
  const lines = [];
  await searchSteps(storage({lastScoutAt: new Date().toISOString()}), line => lines.push(line), 'run', 'you', exec, {now: () => clock});
  assert.deepEqual(steps.map(s => s.step), ['daily'], 'one engine process: nothing holds the run lock in front of the search');
  assert.equal(steps[0].at, 0, 'the search starts at the press, so it scores the waiting jobs first (src/daily_search_scoring.py)');
  assert.ok(steps[0].args.includes('--discover-beside'), 'the job boards\' employers are discovered inside the search (src/sources/boards_beside.py)');
  assert.deepEqual(lines.slice(0, 2), ['Searching job boards…', 'Checking employer career pages, then reading and scoring new jobs…'], 'the live log and its chips read the same lines');
});

test('the first press keeps its order: the slice, then the job boards, then their jobs scored', async () => {
  const steps = [];
  await searchSteps(storage({}), () => {}, 'run', 'first', async (_storage, args) => { steps.push(args.slice(1).filter(a => ['daily', 'discover', 'scout', '--first-jobs', '--discover-beside'].includes(a)).join(' ')); return {code: 0, result: {}}; });
  assert.deepEqual(steps, ['daily --first-jobs', 'discover', 'daily', 'scout']);
});
