// Guard: privacy — the AI fixer's run record is a public artifact (this repository is public) read by the admin tab; without these checks a record could carry a person's text from the item (an e-mail, a copied passage), or a field the tab cannot read.
// The record is built from a scripted loop result and a stand-in item through the real rules (tools/fixer/record.mjs) and read back by the real reader (tools/harness-stats.mjs recordOf). Nothing here calls the AI, GitHub or the owner's data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {STOPS} from '../../../../tools/fixer/driver.mjs';
import {MODEL, VERDICTS, buildRecord, partOf} from '../../../../tools/fixer/record.mjs';
import {recordOf} from '../../../../tools/harness-stats.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const NOW = Date.parse('2026-11-05T10:30:00Z'), STARTED = '2026-11-05T10:00:00Z';
const BRIEF = {text: 'When I press Save the settings page shows a blank panel and my contact is ana.private@example.com after the update', files: {log: 'TypeError: cannot read properties of undefined while the settings panel was drawn for the person'}};
const LOOP = {verdict: 'needs-human', body: 'The panel breaks inside the main process, which a fix may not touch.', stopped: '', engine: 'claude', turns: 3, calls: 3, tokens_in: 1200, tokens_out: 340, actions: ['read', 'search', 'finish']};
const FACTS = {source: 'feedback', ref: '0123456789abcdef', round: 0, started: STARTED, now: NOW, pr: '', stop: '', results: {fix: 'success', prove: 'skipped', publish: 'skipped'}};
const RUN = {id: 77, html_url: 'https://github.com/jobadabra/jobadabra/actions/runs/77'};

test('the record is what the admin tab reads: every field survives its reader, in the agreed words', () => {
  const record = buildRecord(partOf({loop: LOOP, brief: BRIEF}), FACTS);
  assert.deepEqual(Object.keys(record).sort(), ['calls', 'changed_files', 'engine', 'errors', 'minutes', 'model', 'pr', 'reason', 'ref', 'round', 'source', 'started', 'steps', 'stop', 'tokens_in', 'tokens_out', 'turns', 'v', 'verdict', 'workflow']);
  const read = recordOf(JSON.parse(JSON.stringify(record)), RUN);
  // The reader keeps every field as written; it adds GitHub's own run id and url and reads a null stop as ''.
  assert.deepEqual({...read, run_id: undefined, url: undefined}, {...record, stop: record.stop ?? '', run_id: undefined, url: undefined});
  assert.deepEqual([read.run_id, read.url], [77, RUN.html_url]);
  assert.deepEqual([record.v, record.workflow, record.minutes, record.model, record.verdict, record.stop, record.pr], [1, 'ai-fixer', 30, MODEL, 'needs-human', null, null]);
  assert.deepEqual(record.steps, [{n: 1, action: 'read'}, {n: 2, action: 'search'}, {n: 3, action: 'finish'}]);
  assert.ok(JSON.stringify(record).length < 4000, 'a few KB at most');
  // The words: the loop's verdicts and the driver's stop words; anything else is dropped, never passed on.
  assert.deepEqual(VERDICTS, ['fix', 'fixed-already', 'not-reproducible', 'needs-human', 'false-positive', 'answer']);
  for (const word of ['ready', 'time', 'rounds', 'same-failure', 'refused', 'conflict', 'round-failed', 'no-change', 'wall', 'dispatch', 'bad-deadline']) assert.equal(buildRecord(null, {...FACTS, stop: word}).stop, word, word);
  assert.equal(Object.keys(STOPS).every(word => buildRecord(null, {...FACTS, stop: word}).stop === word), true, 'every stop word of the driver is written as it is');
  assert.equal(buildRecord(null, {...FACTS, stop: 'toString'}).stop, null, 'an inherited name is no stop word');
  assert.equal(partOf({loop: {...LOOP, verdict: 'whatever'}, brief: BRIEF}).verdict, '');
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
  const capped = partOf({loop: {verdict: '', body: '', stopped: 'api: broker said token sk-abc123 is out of budget', engine: '', actions: []}, brief: BRIEF});
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
