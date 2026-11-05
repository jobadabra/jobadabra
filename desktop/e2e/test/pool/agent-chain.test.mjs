// A chain hands a run's data and summary to the next run: the snapshot restores byte for byte, a foreign folder is refused, the state says when and why a chain ends (SC 2/2).
// Guard: money — without the end rules a chain keeps starting 250k-token runs that make no progress, and a snapshot that does not restore makes every later link a false run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {linkEnd, linksAsked, MARKER, packSnapshot, pointerLine, restoreSnapshot, resumePlan, startChain} from '../../lib/agent-chain.mjs';
import {chainFor, pointerOf, previousLink, restoreLink} from '../../lib/agent-chain-run.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chain-test-'));
const goals = [1, 2, 3].map(n => ({n, group: 'Jobs', label: `goal ${n}`, pair: 'p'}));
const plan = {seed: 7, persona: {name: 'P'}, goals};
const start = (extra = {}) => startChain({runId: 100, plan, tier: 'large', commit: 'abc1234', maxLinks: 3, ...extra});
const end = (n, stopped, steps = []) => ({n, stopped, steps});
const sessionOf = (ends, extra = {}) => ({ends, notes: [], trace: [{view: 'jobs'}], stopped: 'goals', ...extra});
const snap = {file: 'agent-chain-100-1.tar', sha256: 'a'.repeat(64), bytes: 10};

test('a snapshot restores the data folder byte for byte, leaves the caches out, and its hash is the one saved', () => {
  const profile = tmp(), out = tmp(), target = tmp();
  fs.writeFileSync(path.join(profile, 'store.db'), 'rows');
  fs.mkdirSync(path.join(profile, 'Cache')); fs.writeFileSync(path.join(profile, 'Cache', 'big'), 'cache');
  const saved = packSnapshot({profile, dir: out, chain: '100', link: 1});
  fs.writeFileSync(path.join(target, 'stale.txt'), 'left over');
  const restored = restoreSnapshot({dir: out, snapshot: saved, profile: target});
  assert.equal(restored, saved.sha256, 'the restored hash is the saved hash');
  assert.equal(fs.readFileSync(path.join(target, 'store.db'), 'utf8'), 'rows');
  assert.equal(fs.existsSync(path.join(target, 'Cache')), false, 'caches are not carried');
  assert.equal(fs.existsSync(path.join(target, 'stale.txt')), false, 'the profile is emptied first');
  assert.ok(fs.existsSync(path.join(target, MARKER)));
});

test('a snapshot with another hash, or without the suite marker, is refused before the profile is touched', () => {
  const out = tmp(), target = tmp(), foreign = tmp();
  fs.writeFileSync(path.join(foreign, 'x.txt'), 'x');
  fs.writeFileSync(path.join(target, 'keep.txt'), 'mine');
  const tar = path.join(out, 'agent-chain-1-1.tar');
  fs.writeFileSync(path.join(out, 'agent-chain-9-1.tar'), 'not a tar');
  assert.throws(() => restoreSnapshot({dir: out, snapshot: {file: 'agent-chain-9-1.tar', sha256: 'b'.repeat(64)}, profile: target}), /is not the one the chain saved/);
  require_tar(foreign, tar);
  const hash = packLikeHash(tar);
  assert.throws(() => restoreSnapshot({dir: out, snapshot: {file: path.basename(tar), sha256: hash}, profile: target}), /has no agent-chain-marker\.json/);
  assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'mine');
});

import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
function require_tar(dir, file) { execFileSync('tar', ['-cf', file, '-C', dir, '.']); }
function packLikeHash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

test('the number of links asked is 1 to 4: nothing readable means no chain', () => {
  assert.deepEqual(['', 'x', '1', '3', '4', '9', '0'].map(linksAsked), [1, 1, 1, 3, 4, 4, 1]);
});

test('a link whose only goals ended on done, with goals left, starts the next one without throwing (Gitar, #3254)', () => {
  const state = linkEnd({prev: start(), session: sessionOf([end(1, 'done', ['Open jobs'])], {stopped: 'stopped at the 250k token cap'}), runId: 100, snapshot: snap});
  assert.deepEqual(state.done, [1]);
  assert.deepEqual(state.next, {n: 2, stepsTotal: 0, steps: [], stopped: 'it was not reached'});
  assert.equal(state.ended, '');
});

test('a goal that ended on done is finished; the one that ran out is continued next link, with the steps it already did', () => {
  const state = linkEnd({prev: start(), session: sessionOf([end(1, 'done', ['Open jobs']), end(2, 'api: cap', ['Press "Add"', 'Press "Save"'])], {stopped: 'stopped at the 250k token cap'}), runId: 100, snapshot: snap});
  assert.deepEqual(state.done, [1]);
  assert.equal(state.link, 1);
  assert.equal(state.ended, '');
  assert.deepEqual(state.next, {n: 2, stepsTotal: 2, steps: ['Press "Add"', 'Press "Save"'], stopped: 'stopped at the 250k token cap'});
  const next = resumePlan(state);
  assert.deepEqual(next.goals.map(goal => goal.n), [2, 3], 'finished goals are not run again');
  assert.match(next.goals[0].label, /^goal 2\n\nContinue: this is goal 2 of 3\. Earlier runs already did 2 steps on it and the last stopped on stopped at the 250k token cap\./);
  assert.match(next.goals[0].label, /1\. Press "Add"\n2\. Press "Save"/);
  assert.equal(next.goals[1].label, 'goal 3');
});

test('the steps of a goal add up across links', () => {
  const first = linkEnd({prev: start(), session: sessionOf([end(1, 'api: cap', ['a', 'b'])], {stopped: 'cap'}), runId: 100, snapshot: snap});
  const second = linkEnd({prev: first, session: sessionOf([end(1, 'api: cap', ['c', 'd', 'e'])], {stopped: 'cap'}), runId: 101, snapshot: snap});
  assert.equal(second.next.stepsTotal, 5);
  assert.deepEqual(second.links.map(link => [link.link, link.run, link.steps]), [[1, '100', 2], [2, '101', 3]]);
});

test('a chain ends, and says why: every goal done, link limit, broker failure, no progress', () => {
  const after = (ends, extra, prev = start()) => linkEnd({prev, session: sessionOf(ends, extra), runId: 100, snapshot: snap}).ended;
  assert.equal(after(goals.map(goal => end(goal.n, 'done', ['x']))), 'every goal is done');
  assert.match(after([end(1, 'api: cap', ['x'])], {}, {...start(), link: 2}), /^link 3 \(the last\) is done$/);
  assert.match(after([end(1, 'api: 502 broker down', ['x'])], {stopped: 'api: 502 broker down'}), /^a broker failure: api: 502 broker down/);
  assert.match(after([end(1, 'steps', [])]), /^this link made no progress \(no step, no note\)$/);
  assert.match(after([end(1, 'repeat: "Press x" 5 times', ['x'])], {stopped: 'repeat: "Press x" 5 times'}), /^this link made no progress \(it repeated itself\)$/);
  assert.equal(after([end(1, 'steps', ['x'])]), '', 'a link that moved on goes on');
});

test('a finding names the snapshot to restore and the artifact it is in', () => {
  assert.match(pointerLine({chain: '100', link: 1, snapshot: '', run: ''}), /^Chain 100, link 1: starts from the seeded app/);
  assert.equal(pointerLine({chain: '100', link: 3, snapshot: 'agent-chain-100-2.tar', run: '101'}), 'Chain 100, link 3: restore agent-chain-100-2.tar (artifact agent-replay-101), then do the steps above.');
});

test('a link of another app commit ends the chain before it runs; an ended chain is refused; no folder means no chain', () => {
  const dir = tmp(), state = {...start(), link: 1, snapshot: snap};
  fs.writeFileSync(path.join(dir, 'agent-chain.json'), JSON.stringify(state));
  assert.deepEqual(previousLink('', 'abc1234'), {prev: null, ended: ''});
  assert.equal(previousLink(dir, 'abc1234').ended, '');
  assert.match(previousLink(dir, 'def5678').ended, /^the app commit changed \(abc1234 → def5678\): a snapshot of another build is not restored$/);
  fs.writeFileSync(path.join(dir, 'agent-chain.json'), JSON.stringify({...state, ended: 'link 3 (the last) is done'}));
  assert.throws(() => previousLink(dir, 'abc1234'), /had already ended \(link 3 \(the last\) is done\)/);
});

test('a chain starts only when 2 or more links are asked, and a later link works the goals left with the pointer to the snapshot before', () => {
  const fresh = {seed: 7, persona: {name: 'P'}, newShare: 0.4, changedAreas: ['Jobs'], goals};
  assert.equal(chainFor({prev: null, links: '', fresh, tier: 'large', commitNow: 'abc1234', runId: 100}).state, null);
  const first = chainFor({prev: null, links: '3', fresh, tier: 'large', commitNow: 'abc1234', runId: 100});
  assert.deepEqual([first.state.maxLinks, first.state.plan.newShare, first.state.plan.changedAreas], [3, 0.4, ['Jobs']], 'the whole plan is kept for later links');
  assert.deepEqual(pointerOf(first.state), {chain: '100', link: 1, snapshot: '', run: ''});
  const after = linkEnd({prev: first.state, session: sessionOf([end(1, 'done', ['x']), end(2, 'api: cap', ['y'])], {stopped: 'stopped at the 250k token cap'}), runId: 100, snapshot: snap});
  const second = chainFor({prev: after, links: '', fresh, tier: 'large', commitNow: 'abc1234', runId: 101});
  assert.deepEqual(second.plan.goals.map(goal => goal.n), [2, 3]);
  assert.deepEqual(pointerOf(after), {chain: '100', link: 2, snapshot: 'agent-chain-100-1.tar', run: '100'});
});

test('the steps of a stopped goal are kept across a link that does little, and no Continue line is told about a goal with no steps', () => {
  const first = linkEnd({prev: start(), session: sessionOf([end(1, 'api: cap', ['a', 'b'])], {stopped: 'cap'}), runId: 100, snapshot: snap});
  const second = linkEnd({prev: first, session: sessionOf([end(1, 'api: cap', ['c'])], {stopped: 'cap'}), runId: 101, snapshot: snap});
  assert.deepEqual(second.next.steps, ['a', 'b', 'c']);
  const nothing = {...start(), next: {n: 1, stepsTotal: 0, steps: [], stopped: 'it was not reached'}};
  assert.equal(resumePlan(nothing).goals[0].label, 'goal 1', 'no steps done: the goal is told as it was');
});

test('after a restore the suite gets the new window: the relaunch closes the old one', async () => {
  const profile = tmp(), out = tmp(), target = tmp();
  fs.writeFileSync(path.join(profile, 'store.db'), 'rows');
  const saved = packSnapshot({profile, dir: out, chain: '100', link: 1});
  const oldPage = {closed: true}, newPage = {closed: false};
  const ctx = {page: oldPage, relaunch: async (_extra, between) => { await between(target); ctx.page = newPage; }};
  const result = await restoreLink(ctx, out, {chain: '100', link: 1, snapshot: saved});
  assert.equal(result.page, newPage);
  assert.equal(result.restored, saved.sha256);
});
