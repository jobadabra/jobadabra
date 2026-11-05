// Guard: privacy — the AI fixer's run record is a public artifact (this repository is public) read by the admin tab; without these checks a record could carry a person's text from the item (an e-mail, a copied passage), or a field the tab cannot read.
// The record is built from a scripted loop result and a stand-in item through the real rules (tools/fixer/record.mjs) and read back by the real reader (tools/harness-stats.mjs recordOf). Nothing here calls the AI, GitHub or the owner's data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {STOPS} from '../../../../tools/fixer/driver.mjs';
import {SONNET_ENGINES} from '../../../../tools/fixer/engine.mjs';
import {runLoop} from '../../../../tools/fixer/loop.mjs';
import {BLOCKED, MODELS, VERDICTS, blockedBy, buildRecord, partOf} from '../../../../tools/fixer/record.mjs';
import {recordOf} from '../../../../tools/harness-stats.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const NOW = Date.parse('2026-11-05T10:30:00Z'), STARTED = '2026-11-05T10:00:00Z';
const BRIEF = {text: 'When I press Save the settings page shows a blank panel and my contact is ana.private@example.com after the update', files: {log: 'TypeError: cannot read properties of undefined while the settings panel was drawn for the person'}};
const LOOP = {verdict: 'needs-human', body: 'The panel breaks inside the main process, which a fix may not touch.', stopped: '', engine: 'claude', turns: 3, calls: 3, tokens_in: 1200, tokens_out: 340, steps: [{action: 'read', ms: 2400, ok: true, path: 'desktop/renderer/settings.js', tout: 40}, {action: 'search', ms: 1100, ok: false, path: '', tout: 60}, {action: 'edit', ms: 900, ok: true, path: 'ana.private@example.com', tout: 240}, {action: 'read', ms: 500, ok: true, path: '../../etc/passwd', tout: 10}]};
const FACTS = {source: 'feedback', ref: '0123456789abcdef', round: 0, started: STARTED, now: NOW, pr: '', stop: '', results: {fix: 'success', prove: 'skipped', publish: 'skipped'}};
const EXISTS = file => file === 'desktop/renderer/settings.js';   // a stand-in for "a file of the base commit"
const RUN = {id: 77, html_url: 'https://github.com/jobadabra/jobadabra/actions/runs/77'};

test('the record is what the admin tab reads: every field survives its reader, in the agreed words', () => {
  const record = buildRecord(partOf({loop: LOOP, brief: BRIEF, exists: EXISTS}), FACTS);
  assert.deepEqual(Object.keys(record).sort(), ['blocked_by', 'calls', 'changed_files', 'engine', 'errors', 'minutes', 'model', 'pr', 'reason', 'ref', 'round', 'source', 'started', 'steps', 'stop', 'tokens_in', 'tokens_out', 'turns', 'v', 'verdict', 'workflow']);
  const read = recordOf(JSON.parse(JSON.stringify(record)), RUN);
  // The reader keeps every field as written; it adds GitHub's own run id and url and reads a null stop as ''.
  assert.deepEqual({...read, run_id: undefined, url: undefined}, {...record, stop: record.stop ?? '', run_id: undefined, url: undefined});
  assert.deepEqual([read.run_id, read.url], [77, RUN.html_url]);
  assert.deepEqual([record.v, record.workflow, record.minutes, record.model, record.verdict, record.stop, record.pr], [1, 'ai-fixer', 30, 'claude-sonnet-5-5', 'needs-human', null, null]);
  // The model follows the engine that answered (the broker may answer from Codex); an engine we do not know names no model.
  assert.deepEqual(Object.keys(MODELS).sort(), [...SONNET_ENGINES].sort(), 'every engine the loop accepts has a model name');
  assert.deepEqual(['codex', 'claude', 'qwen', ''].map(engine => partOf({loop: {...LOOP, engine}, brief: BRIEF}).model), ['gpt-6.1-sol', 'claude-sonnet-5-5', '', '']);
  assert.deepEqual(record.steps, [{n: 1, action: 'read', s: 2.4, ok: true, path: 'desktop/renderer/settings.js', tout: 40}, {n: 2, action: 'search', s: 1.1, ok: false, path: '', tout: 60}, {n: 3, action: 'edit', s: 0.9, ok: true, path: '', tout: 240}, {n: 4, action: 'read', s: 0.5, ok: true, path: '', tout: 10}], 'where the time went: seconds, refused or not, the plain repo path, tokens written per step; an address or a ../ path is dropped');
  assert.ok(JSON.stringify(record).length < 4000, 'a few KB at most');
  // The words: the loop's verdicts and the driver's stop words; anything else is dropped, never passed on.
  assert.deepEqual(VERDICTS, ['fix', 'fixed-already', 'not-reproducible', 'needs-human', 'false-positive', 'answer']);
  for (const word of ['ready', 'time', 'rounds', 'same-failure', 'refused', 'conflict', 'round-failed', 'no-change', 'wall', 'dispatch', 'bad-deadline']) assert.equal(buildRecord(null, {...FACTS, stop: word}).stop, word, word);
  assert.equal(Object.keys(STOPS).every(word => buildRecord(null, {...FACTS, stop: word}).stop === word), true, 'every stop word of the driver is written as it is');
  assert.equal(buildRecord(null, {...FACTS, stop: 'toString'}).stop, null, 'an inherited name is no stop word');
  assert.equal(partOf({loop: {...LOOP, verdict: 'whatever'}, brief: BRIEF}).verdict, '');
  // A path is the model's own text and the model reads the item: only an accepted step's path that is an existing file of the repo and passes the leak scan is kept.
  const pathOf = (path, over = {}) => partOf({loop: {...LOOP, steps: [{action: 'read', ms: 1, ok: true, path, ...over}]}, brief: BRIEF, exists: () => true}).steps[0].path;
  assert.deepEqual([pathOf('desktop/renderer/settings.js'), pathOf('desktop/renderer/settings.js', {ok: false}), pathOf('ana.private@example.com'), pathOf('a/../b.js'), pathOf('x'.repeat(61)), pathOf(7)], ['desktop/renderer/settings.js', '', '', '', '', '']);
  assert.equal(partOf({loop: {...LOOP, steps: [{action: 'read', ms: 1, ok: true, path: 'users/ana-private/settings.json'}]}, brief: BRIEF, exists: EXISTS}).steps[0].path, '', 'a name that is no file of the repo is dropped');
});

test('the agent\'s reason is public text: one that carries the item\'s words is withheld, and the record says so without repeating it', () => {
  const clean = partOf({loop: LOOP, brief: BRIEF});
  assert.equal(clean.reason, LOOP.body);
  const email = partOf({loop: {...LOOP, body: 'Write to ana.private@example.com about the panel.'}, brief: BRIEF});
  const copied = partOf({loop: {...LOOP, body: 'It is clear that when I press Save the settings page shows a blank panel and nothing else.'}, brief: BRIEF});
  for (const held of [email, copied]) {
    assert.equal(held.reason, '');
    assert.equal(held.errors.length, 1);
    assert.match(held.errors[0], /^the reason was withheld: it held /);
    assert.doesNotMatch(JSON.stringify(held), /ana\.private|blank panel/, 'neither the address nor the passage is in the record');
  }
  // A fix's reason is its (already scanned) pull request title, and the files are the patch's; the reason is cut to 400 characters on one line.
  const fix = partOf({loop: {...LOOP, verdict: 'fix', body: 'the long pull request body is not the reason'}, brief: BRIEF, title: 'Draw the settings panel when the update has no contact', files: ['desktop/renderer/settings.js', 'desktop/test/settings.test.js']});
  assert.deepEqual([fix.reason, fix.changed_files.length], ['Draw the settings panel when the update has no contact', 2]);
  assert.equal(partOf({loop: {...LOOP, body: `a\n\n${'word '.repeat(200)}`}, brief: BRIEF}).reason.length <= 400, true);
  assert.deepEqual(partOf({loop: LOOP, brief: BRIEF, files: ['src/a.py']}).changed_files, [], 'a run without a fix lists no changed file');
});

test('a run that never reached the loop still has a record that says what failed, and a stopped loop says why in words', () => {
  const none = buildRecord(null, {...FACTS, results: {fix: 'failure', prove: 'skipped', publish: 'skipped'}});
  assert.deepEqual([none.verdict, none.engine, none.steps, none.errors], ['', '', [], ['the fix job failure']]);
  const capped = partOf({loop: {verdict: '', body: '', stopped: 'api: broker said token sk-abc123 is out of budget', engine: '', steps: []}, brief: BRIEF});
  assert.deepEqual(capped.errors, ['the loop stopped: the broker refused or no Sonnet-level engine answered'], 'only the word before the colon, mapped; the broker\'s text is not copied');
  const round = buildRecord(capped, {...FACTS, round: 2, pr: '3199', stop: 'no-change'});
  assert.deepEqual([round.round, round.pr, round.stop], [2, 3199, 'no-change']);
  assert.equal(buildRecord(capped, {...FACTS, started: 'not a date'}).minutes, 0);
  assert.ok(buildRecord(partOf({loop: LOOP, brief: BRIEF}), {...FACTS, results: {fix: 'failure', prove: 'failure', publish: 'cancelled'}}).errors.length <= 5);
});

test('the workflow writes the record from a job that holds no token and no branch of the run', () => {
  const fixer = fs.readFileSync(path.join(ROOT, '.github/workflows/ai-fixer.yml'), 'utf8');
  const job = fixer.slice(fixer.indexOf('\n  record:'), fixer.indexOf('\n  # One alert when the broker refused'));
  assert.ok(job.length > 200, 'a record job exists');
  assert.match(job, /if: always\(\) && !cancelled\(\)/, 'a failed or empty run still has a record');
  assert.match(job, /name: ai-fixer-record/);
  assert.match(job, /record\/record\.json/);
  assert.doesNotMatch(job, /GH_TOKEN|github\.token|secrets\.|id-token|CI_APP|ref: /, 'no token, no secret, no other ref');
  assert.doesNotMatch(job, /\$\{\{\s*inputs\.[^}]*\}\}[^\n]*\n\s+run:/, 'an input reaches a script only through env:');
  const fix = fixer.slice(fixer.indexOf('\n  fix:'), fixer.indexOf('\n  prove:'));
  assert.match(fix, /record\.mjs" part/, 'the reason is scanned in the fix job, where the item is');
  assert.match(fix, /name: fixer-record-part/);
});

test('why a run did not succeed is ONE fixed word: a failed job first, then the stop, the loop, the verdict; a wall refusal is counted by the loop', async () => {
  const ok = {fix: 'success', prove: 'success', publish: 'success'}, part = over => partOf({loop: {...LOOP, ...over}, brief: BRIEF});
  assert.equal(blockedBy(part({verdict: 'needs-human', walls: 3}), {results: ok}), 'walls');
  assert.equal(blockedBy(part({verdict: 'needs-human', walls: 0}), {results: ok}), 'needs-human');
  assert.equal(blockedBy(part({verdict: 'not-reproducible'}), {results: ok}), 'no-repro');
  assert.equal(blockedBy(part({verdict: 'fix'}), {results: ok}), 'none');
  assert.equal(blockedBy(part({verdict: '', stopped: 'steps'}), {results: ok}), 'steps');
  assert.equal(blockedBy(part({verdict: '', stopped: 'api: no'}), {results: ok}), 'broker');
  assert.equal(blockedBy(part({verdict: 'fix'}), {results: {...ok, prove: 'failure'}}), 'tests-failed', 'a failed proof beats the verdict');
  assert.equal(blockedBy(null, {results: {...ok, fix: 'failure'}}), 'run-failed');
  assert.equal(blockedBy(part({verdict: 'fix'}), {results: ok, stop: 'same-failure'}), 'same-failure');
  assert.equal(blockedBy(null, {results: ok, stop: 'toString'}), 'none', 'an inherited name is no stop word');
  // One list: every answer blockedBy can give is on BLOCKED, and every word on BLOCKED can be given (over every verdict, stop word, loop stop, job result and wall count).
  const given = new Set();
  for (const verdict of [...VERDICTS, '']) for (const stop of [...Object.keys(STOPS), '']) for (const stopped of ['', 'steps', 'time', 'api: x']) for (const walls of [0, 1]) for (const results of [ok, {...ok, fix: 'failure'}, {...ok, prove: 'failure'}, {...ok, publish: 'failure'}]) given.add(blockedBy(part({verdict, stopped, walls}), {results, stop}));
  assert.deepEqual([...given].sort(), [...BLOCKED].sort());
  assert.equal(buildRecord(part({verdict: 'needs-human', walls: 2}), FACTS).blocked_by, 'walls');
  assert.equal(recordOf(buildRecord(part({verdict: 'needs-human', walls: 2}), FACTS), RUN).blocked_by, 'walls', 'the admin reader keeps it');
  // The loop counts a refusal by a wall (the action says so), not any refusal.
  const blank = {action: '', path: '', range: '', pattern: '', folder: '', old: '', new: '', files: [], verdict: '', title: '', body: ''};
  const ask = actions => { let i = 0; return async () => ({text: JSON.stringify({...blank, ...actions[Math.min(i++, actions.length - 1)]}), engine: 'claude', usage: {input_tokens: 1, output_tokens: 1}}); };
  const result = await runLoop({ask: ask([{action: 'edit', path: 'tools/x.mjs', old: 'a', new: 'b'}, {action: 'edit', path: 'src/y.py', old: 'a', new: 'b'}, {action: 'finish', verdict: 'needs-human', body: 'it lives in tools'}]), act: async action => (action.path.startsWith('tools/') ? {text: 'Refused: outside the folders', wall: true} : {text: 'Refused: no such file.'}), system: 's', first: 'f', now: () => 0});
  assert.deepEqual([result.walls, result.timeline.map(step => step.ok)], [1, [false, false, true]]);
});
