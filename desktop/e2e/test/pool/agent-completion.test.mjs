// Guard: data — partial persona runs must preserve the tested-since checkpoint and the work they never verified.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {memoryCommitFiles, nightWorked} from '../../lib/agent-nightly.mjs';
import {pushMemory} from '../../lib/agent-memory.mjs';
import {planSession} from '../../lib/agent-plan.mjs';
import {runSession} from '../../lib/agent-run.mjs';

const BLANK = {control: -1, text: '', key: '', view: '', title: '', kind: '', severity: '', what: '', check_type: '', check_text: '', check_control: '', summary: '', type: '', expected: '', observed: '', why: '', verdict: ''};

test('a partially funded night publishes pending work without moving the completed-night checkpoint', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jt-persona-memory-'));
  try {
    const remote = path.join(root, 'remote.git'), work = path.join(root, 'work'), out = path.join(root, 'out');
    const git = (args, cwd = work) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
    git(['init', '--bare', '--quiet', '--initial-branch=main', remote], root);
    git(['clone', '--quiet', remote, work], root);
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, 'pending.json'), '[]');
    pushMemory({dir: work, files: memoryCommitFiles(out, {sha: 'verified', today: '2026-11-06'}), git, message: 'completed'});
    const partial = {stopped: 'goals', unfunded: [5, 6, 7, 8]};
    assert.equal(nightWorked(partial), false, 'the actual run exported goals despite its unfunded list');
    for (const stopped of ['budget', 'steps', 'calls 1', 'minutes 20']) assert.equal(nightWorked({stopped}), false);
    fs.writeFileSync(path.join(out, 'pending.json'), '[{"group":"Settings","label":"Your data"}]');
    pushMemory({dir: work, files: memoryCommitFiles(out, {sha: 'partial', today: '2026-11-07', complete: false}), git, message: 'partial'});
    assert.equal(JSON.parse(git(['show', 'agent-memory:last.json'], remote)).sha, 'verified');
    assert.equal(JSON.parse(git(['show', 'agent-memory:pending.json'], remote))[0].label, 'Your data');
    fs.writeFileSync(path.join(out, 'pending.json'), '[]');
    pushMemory({dir: work, files: memoryCommitFiles(out, {sha: 'finished', today: '2026-11-08', complete: true}), git, message: 'finished'});
    assert.equal(JSON.parse(git(['show', 'agent-memory:last.json'], remote)).sha, 'finished');
    assert.deepEqual(JSON.parse(git(['show', 'agent-memory:pending.json'], remote)), []);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('pending goals lead the next fresh plan, without duplicates, stale controls, or losing changed areas', () => {
  const moves = ['Settings', 'Jobs', 'Strategy', 'Profile'].flatMap(group => Array.from({length: 3}, (_, i) => ({group, label: `${group} ${i}`})));
  const pending = [moves[4], moves[1], moves[4], {group: 'Removed', label: 'Old control'}];
  const plan = planSession({seed: 7, moves, pending, changed: ['Strategy'], count: 6});
  assert.deepEqual(plan.goals.slice(0, 2).map(({group, label}) => ({group, label})), [moves[4], moves[1]]);
  assert.equal(plan.goals.length, 6);
  assert.equal(new Set(plan.goals.map(goal => `${goal.group}: ${goal.label}`)).size, 6);
  assert.ok(plan.goals.some(goal => goal.group === 'Strategy'));
  assert.ok(!plan.goals.some(goal => goal.group === 'Removed'));
});

test('changed-area coverage chooses its pending move before drawing a different move from that same area', () => {
  const changed = Array.from({length: 6}, (_, i) => `G${i}`);
  const moves = changed.flatMap(group => [{group, label: 'first'}, {group, label: 'other'}]);
  const plan = planSession({seed: 7, moves, changed, pending: [moves[0]], count: 6});
  assert.equal(plan.goals[0].group, 'G0');
  assert.equal(plan.goals[0].label, 'first', 'a full set of changed areas must not evict unfinished work');
  assert.deepEqual(new Set(plan.goals.map(goal => goal.group)), new Set(changed));
});

test('a pending goal in another area is funded before fresh changed-area work, retaining changed coverage within the ten-goal ceiling', () => {
  const moves = Array.from({length: 7}, (_, i) => ({group: `G${i}`, label: 'only'}));
  const plan = planSession({seed: 7, moves, changed: moves.slice(0, 6).map(goal => goal.group), pending: [moves[6]], count: 6});
  assert.equal(plan.goals[0].group, 'G6');
  assert.deepEqual(new Set(plan.goals.map(goal => goal.group)), new Set(moves.map(goal => goal.group)));
  assert.ok(plan.goals.length <= 10, 'adding pending coverage never creates an unbounded plan or another run');
});

test('interrupted work comes first, unvisited work next, and declared blockers cannot starve either', async () => {
  const {pendingGoals} = await import('../../lib/agent-plan.mjs');
  assert.equal(typeof pendingGoals, 'function');
  const goal = (n, verdict) => ({n, group: 'Settings', label: `goal ${n}`, verdict});
  const session = {summary: {goals: [goal(1, 'could-not-finish'), goal(2, 'worked'), goal(3, 'could-not-finish'), goal(4, 'not-started')]}, completed: [1, 2]};
  const previous = [{group: 'Jobs', label: 'deferred'}, {group: 'Settings', label: 'goal 2'}];
  assert.deepEqual(pendingGoals(session, previous).map(goal => goal.label), ['goal 3', 'goal 4', 'deferred', 'goal 1']);
});

test('the last funded turn verifies the saved page and cannot mutate it or exceed its call allowance', async () => {
  for (const attemptsMutation of [false, true]) {
    let value = 'old', calls = 0, clicks = 0, finalArgs;
    const act = {observe: async () => ({view: 'profile', text: `Saved value: ${value}`, overlays: [], controls: [{i: 0, kind: 'button', label: 'Save', disabled: false}]}), click: async () => { clicks++; value = 'new'; }};
    const ask = async args => {
      calls++;
      if (calls < 6) return {text: JSON.stringify({...BLANK, action: 'click', control: 0}), usage: {input_tokens: 10, output_tokens: 1}};
      finalArgs = structuredClone(args);
      return {text: JSON.stringify({...BLANK, ...(attemptsMutation ? {action: 'click', control: 0} : {action: 'done', verdict: 'worked', summary: 'The saved value is new'})}), usage: {input_tokens: 10, output_tokens: 1}};
    };
    const result = await runSession({act, ask, views: ['profile'], plan: {goals: [{n: 1, group: 'Profile', label: 'Save value'}], persona: {name: 'Fictional'}}, caps: {maxSteps: 6, maxCalls: 6}, judgeAsk: async () => { throw new Error('no notes'); }});
    assert.deepEqual(finalArgs.schema.properties.action.enum, ['done'], 'the reserved final turn only gives a verdict');
    assert.match(finalArgs.messages.at(-1).content, /Saved value: new/);
    assert.equal(calls, 6, 'verification fits inside the funded allowance');
    assert.equal(clicks, 5, 'even an actor ignoring the final restriction cannot make a sixth mutation');
    assert.equal(result.summary.goals[0].verdict, attemptsMutation ? 'could-not-finish' : 'worked');
    assert.deepEqual(result.completed, attemptsMutation ? [] : [1]);
  }
});

test('a final verdict receives the previous failed action in its resumed conversation delta', async () => {
  let calls = 0, clicks = 0, observations = 0, finalArgs;
  const act = {observe: async () => ({view: 'profile', text: `Profile verification ${observations++}`, overlays: [], controls: [{i: 0, kind: 'button', label: 'Save', disabled: false}]}), click: async () => { if (++clicks === 5) throw new Error('save rejected'); }};
  const ask = async args => {
    calls++;
    if (calls < 6) return {text: JSON.stringify({...BLANK, action: 'click', control: 0}), usage: {input_tokens: 10, output_tokens: 1}};
    finalArgs = structuredClone(args);
    return {text: JSON.stringify({...BLANK, action: 'done', verdict: args.delta.includes('save rejected') ? 'could-not-finish' : 'worked', summary: 'The save result was inspected'}), usage: {input_tokens: 10, output_tokens: 1}};
  };
  const result = await runSession({act, ask, views: ['profile'], plan: {goals: [{n: 1, group: 'Profile', label: 'Save value'}], persona: {name: 'Fictional'}}, caps: {maxSteps: 6, maxCalls: 6}, judgeAsk: async () => { throw new Error('no notes'); }});
  assert.match(finalArgs.delta, /That failed: save rejected/);
  assert.equal(finalArgs.messages.filter(message => message.role === 'user').length, 6, 'one user turn per result; no duplicate page-view turn');
  assert.equal((finalArgs.delta.match(/Profile verification/g) || []).length, 1);
  assert.equal(result.summary.goals[0].verdict, 'could-not-finish');
});
