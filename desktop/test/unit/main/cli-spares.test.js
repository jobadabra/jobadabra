// Processes started ahead for the app's AI asks (lib/ai/cli-spares.js, ClaudeCode.coming/runCall) and calls that return at their answer line
// (cli-base.js runProcess `answered`, Claude Code and Codex): one process per question, never reused; 1 ready when quiet, more while asks wait,
// back down when the load fades; an ask with a file keeps its one plain call. Fake processes only: no real Claude Code or Codex.
// Why (as, 12 Nov 2026; owner: "if no activity at all, we hsould always have 1 session active. if we're getting more and more calls, we add
// 2 .. 3... on the fly" · "And then we downscaling when the load fades away" · "let's make sure we cover all AI calls").
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';

import {jsonLine, runProcess} from '../../../lib/ai/cli-base.js';
import {sparePool} from '../../../lib/ai/cli-spares.js';
import {ClaudeCode} from '../../../lib/ai/claude-code-cli.js';
import {Codex} from '../../../lib/ai/codex-cli.js';

// A fake child: records what it was asked; on its input it prints `lines(args)` and closes, or with `hold` stays open until release().
function fakeSpawner({lines = defaultLines, hold = false} = {}) {
  const spawned = [];
  const spawnFn = (binary, args, options = {}) => {
    const child = new EventEmitter();
    Object.assign(child, {args, cwd: options.cwd, input: null, asked: 0, exitCode: null, killed: false, stdout: new EventEmitter(), stderr: new EventEmitter()});
    const close = code => { if (child.exitCode === null) { child.exitCode = code; child.emit('exit', code); child.emit('close', code); } };
    child.kill = () => { child.killed = true; close(137); };
    child.release = (code = 0) => close(code);
    child.stdin = {on: () => {}, end: input => setImmediate(() => {
      child.asked += 1;
      child.input = input;
      const {out, err = '', code = 0} = lines(args);
      if (err) child.stderr.emit('data', err);
      child.stdout.emit('data', out);
      if (!hold || code !== 0) close(code);
    })};
    spawned.push(child);
    return child;
  };
  return {spawned, spawnFn};
}
const RESULT = {type: 'result', subtype: 'success', is_error: false, result: '', structured_output: {kind: 'form'}, usage: {input_tokens: 1, output_tokens: 1}};
function defaultLines(args) {
  return {out: args.includes('--input-format') ? `${JSON.stringify({type: 'system'})}\n${JSON.stringify(RESULT)}\n` : JSON.stringify(RESULT)};
}
const help = flags => (bin, args, opts, done) => done(null, flags, '');
const ALL = '--output-format --model --tools --allowedTools --permission-mode --json-schema --input-format --no-session-persistence';
const ask = {model: 'claude-haiku-4-5', max_tokens: 50, system: 'You classify a job page.', messages: [{role: 'user', content: 'sketch'}],
  output_config: {format: {type: 'json_schema', schema: {type: 'object', properties: {kind: {type: 'string'}}, required: ['kind']}}}};
const waiting = spawned => spawned.filter(child => !child.killed && child.exitCode === null && child.asked === 0);

test('the pool: 1 when quiet, one more per waiting ask up to max, the oldest other kind makes room, back to 1 when the load fades', () => {
  const {spawned, spawnFn} = fakeSpawner();
  let clock = 1000;
  const pool = sparePool({max: 3, idleMs: 3600000, maxAgeMs: 600, now: () => clock});
  const start = key => () => spawnFn('c', [key]);
  pool.asked('a', start('a'));
  assert.equal(pool.size(), 1, 'the first ask starts its process at once');
  pool.asked('a', start('a')); pool.asked('a', start('a'));
  assert.equal(pool.size(), 3, 'three asks waiting: three processes (owner: "we add 2 .. 3... on the fly")');
  pool.asked('a', start('a'));
  assert.equal(pool.size(), 3, 'never more than max');
  assert.equal(pool.take('a'), spawned[0]);
  assert.equal(pool.take('a'), spawned[1], 'one process per ask: the next ask gets the next one');
  spawned[0].release(); spawned[1].release();   // they answered and closed
  pool.asked('b', start('b')); pool.asked('b', start('b'));   // 2 of a still wait with their 2 processes: b's second needs room
  assert.deepEqual(spawned.slice(-2).map(child => child.args[0]), ['b', 'b']);
  assert.equal(spawned.filter(child => child.killed && child.args[0] === 'a').length, 1, 'at max, kind a made room for kind b');
  pool.gone('a'); pool.gone('a');
  for (const child of [pool.take('b'), pool.take('b')]) child.release();   // the asks were answered: nothing waits
  pool.trim();   // what the idle timer does after idleMs without an ask (owner: "downscaling when the load fades away")
  assert.deepEqual(waiting(spawned).map(child => child.args[0]), ['b'], 'one ready, for the kind asked last; none for the others');
  clock += 1000;   // older than maxAgeMs: replaced, never used
  const stale = waiting(spawned)[0];
  assert.equal(pool.take('b'), null);
  assert.equal(stale.killed, true);
  assert.equal(pool.size(), 1, 'a fresh one started in its place ("always have 1 session active")');
  pool.asked('d', () => { const child = spawnFn('c', ['d']); child.kill(); return child; });
  assert.equal(pool.take('d'), null, 'a process that died is not handed out');
  assert.equal(pool.take('never-asked'), null);
  pool.clear();
  assert.equal(waiting(spawned).length, 0, 'clear() ends every waiting process');
});

test('the idle timer trims by itself', async () => {
  const {spawned, spawnFn} = fakeSpawner();
  const pool = sparePool({max: 3, idleMs: 10});
  for (const key of ['a', 'b', 'b']) pool.asked(key, () => spawnFn('c', [key]));
  pool.gone('b'); pool.gone('b'); pool.gone('a');
  for (let i = 0; i < 200 && waiting(spawned).length > 1; i += 1) await new Promise(resolve => setTimeout(resolve, 10));   // hang guard only
  assert.deepEqual(waiting(spawned).map(child => child.args[0]), ['b']);
  pool.clear();
});

test('every ask that reads no file, page or not, is answered by a process started ahead; the next ask finds one waiting', async () => {
  for (const lane of ['page', undefined]) {
    const {spawned, spawnFn} = fakeSpawner();
    class Asks extends ClaudeCode { static spares = sparePool({idleMs: 3600000}); }
    const make = () => new Asks({binary: `/fake/claude-${lane}`, spawnFn, run: help(ALL), lane, log: () => {}});
    const first = await make().messages.create(ask);
    assert.equal(JSON.parse(first.content[0].text).kind, 'form');
    assert.equal(spawned.length, 2, `${lane}: the first ask's process and one ready for the next`);
    assert.ok(spawned[0].args.includes('--input-format'));
    assert.deepEqual(JSON.parse(spawned[0].input), {type: 'user', message: {role: 'user', content: 'sketch'}});
    assert.equal(spawned[1].input, null, 'the next one waits for its question');
    await make().messages.create(ask);
    assert.notEqual(spawned[1].input, null, 'the second ask was answered by the process started ahead');
    await Promise.all([make().messages.create(ask), make().messages.create(ask), make().messages.create(ask)]);
    assert.ok(spawned.every(child => child.asked <= 1), 'every process got at most ONE question (none sees an earlier one)');
    assert.equal(spawned.filter(child => child.asked === 1).length, 5);
    assert.ok(spawned.every(child => child.cwd.includes('jobadabra-claude-')), 'each in a folder of its own');
    Asks.spares.clear();
  }
});

test('an ask with a file, and a Claude Code without stream input, keep the one plain call, no process started ahead', async () => {
  const withFile = {...ask, messages: [{role: 'user', content: [{type: 'image', source: {type: 'base64', media_type: 'image/png', data: 'cG5n'}}, {type: 'text', text: 'sketch'}]}]};
  for (const [name, flags, params] of [['file', ALL, withFile], ['no stream input', ALL.replace(' --input-format', ''), ask]]) {
    const {spawned, spawnFn} = fakeSpawner();
    class Plain extends ClaudeCode { static spares = sparePool(); }
    const answer = await new Plain({binary: `/fake/claude-plain-${name.length}`, spawnFn, run: help(flags), log: () => {}}).messages.create(params);
    assert.equal(JSON.parse(answer.content[0].text).kind, 'form');
    assert.equal(spawned.length, 1, `${name}: one process`);
    assert.equal(spawned[0].args.includes('--input-format'), false);
    assert.equal(Plain.spares.size(), 0);
  }
});

test('Claude Code and Codex calls return at their answer line while the process still closes down; a failed answer waits for its exit', async () => {
  const {spawned, spawnFn} = fakeSpawner({hold: true});
  class Asks extends ClaudeCode { static spares = sparePool({idleMs: 3600000}); }
  const answer = await new Asks({binary: '/fake/claude-line', spawnFn, run: help(ALL), log: () => {}}).messages.create(ask);
  assert.equal(JSON.parse(answer.content[0].text).kind, 'form');
  assert.equal(spawned[0].exitCode, null, 'positive control: Claude Code had not closed when the call returned');
  Asks.spares.clear();

  const turn = [{type: 'thread.started'}, {type: 'item.completed', item: {type: 'agent_message', text: 'yes'}}, {type: 'turn.completed', usage: {input_tokens: 9}}];
  const codex = fakeSpawner({hold: true, lines: () => ({out: `${turn.map(event => JSON.stringify(event)).join('\n')}\n`})});
  const features = (bin, args, opts, done) => done(null, '', '');
  const said = await new Codex({binary: '/fake/codex', run: features, env: {}, spawnFn: codex.spawnFn, log: () => {}})
    .messages.create({model: 'claude-haiku-5-5', max_tokens: 10, messages: [{role: 'user', content: 'SRE?'}]});
  assert.equal(said.content[0].text, 'yes');
  assert.equal(codex.spawned[0].exitCode, null, 'positive control: Codex had not closed when the call returned');
  assert.ok(codex.spawned[0].cwd.includes('jobadabra-codex-run-'), 'Codex runs in a folder of its own');

  const failed = fakeSpawner({hold: true, lines: () => ({out: `${JSON.stringify({type: 'turn.failed', error: {message: 'You have hit your usage limit'}})}\n`, err: 'usage limit', code: 1})});
  await assert.rejects(new Codex({binary: '/fake/codex-limit', run: features, env: {}, spawnFn: failed.spawnFn, log: () => {}})
    .messages.create({model: 'claude-haiku-5-5', max_tokens: 10, messages: [{role: 'user', content: 'SRE?'}]}), error => error.kind === 'limit');
  for (const child of [...spawned, ...codex.spawned]) child.release();
});

test('after its answer line, a failed exit or late stderr is logged, never dropped; the stderr written before the answer stays on the result', async () => {
  // Gitar on #3937: the answer-line return used to say stderr '' and drop whatever the process did after its answer. The answer stands (the
  // CLI said its turn completed); what follows is the process closing down, now said as a warning with its exit code and stderr.
  const turn = [{type: 'item.completed', item: {type: 'agent_message', text: 'yes'}}, {type: 'turn.completed', usage: {input_tokens: 9}}];
  const out = `${turn.map(event => JSON.stringify(event)).join('\n')}\n`;
  const {spawned, spawnFn} = fakeSpawner({hold: true, lines: () => ({out, err: 'reading config\n'})});
  const notes = [];
  const result = await runProcess('/fake/codex', [], 'q', {spawnFn, tool: 'Codex', late: text => notes.push(text), answered: line => jsonLine(line).type === 'turn.completed'});
  assert.deepEqual([result.code, result.stderr, result.stdout], [0, 'reading config\n', out]);
  assert.deepEqual(notes, [], 'positive control: nothing said before it closed');
  spawned[0].stderr.emit('data', 'telemetry upload failed');
  spawned[0].release(1);
  assert.deepEqual(notes, ['Codex closed with exit code 1 after its answer: telemetry upload failed']);

  const clean = fakeSpawner({hold: true, lines: () => ({out, err: 'reading config\n'})});
  await runProcess('/fake/codex', [], 'q', {spawnFn: clean.spawnFn, tool: 'Codex', late: text => notes.push(text), answered: line => jsonLine(line).type === 'turn.completed'});
  clean.spawned[0].release(0);
  assert.equal(notes.length, 1, 'a clean close after the answer says nothing');

  const logged = [];
  const codex = fakeSpawner({hold: true, lines: () => ({out})});
  const said = await new Codex({binary: '/fake/codex-late', run: (bin, args, opts, done) => done(null, '', ''), env: {}, spawnFn: codex.spawnFn, log: text => logged.push(text)})
    .messages.create({model: 'claude-haiku-5-5', max_tokens: 10, messages: [{role: 'user', content: 'SRE?'}]});
  assert.equal(said.content[0].text, 'yes', 'the answer stands');
  codex.spawned[0].release(2);
  assert.ok(logged.some(text => text.startsWith('Warning: Codex closed with exit code 2 after its answer')), 'the app log says it');
});
