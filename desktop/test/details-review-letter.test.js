// Letter text is never a profile item (owner via the coordinator, 3 Nov 2026, a Windows tester on 0.9.2: To check → Review listed a cover letter's lines ("Madame, Monsieur,",
// "Langues", "Languages", "Professional Development" twice) and the log said "answers checked: judged 82, unclear 81"). A letter pasted on the Profile is running text, not facts:
// the judge (lib/profile-move.js) names it "prose", and prose is never asked, never counted unclear, never moved into a Your details section. Each test plays that Profile through
// lib/details-review.js judgeNew() and pending() on the real store (SQLite). The AI is a fake that follows the prompt it is given (no spend); the letter's employer is invented.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import * as review from '../lib/details-review.js';
import * as sections from '../lib/profile-sections.js';
import {homeOf} from '../lib/answer-home.js';
import {RUBRIC, record, sigOf, verdictOf} from '../lib/answer-clarity.js';
import {wordingReply} from './fake-wording.js';

const LETTER = ['Madame, Monsieur,', 'Dear Hiring Team at Zorblax GmbH: I am excited to apply for the Site Reliability role in Zurich.', 'Langues', 'Languages',
  'Professional Development', 'Professional Development', 'I speak English, French and German fluently, which suits the Zorblax team.'];
const PROFILE = ['## Preferences', 'Relocation: open to moving within the EU', ...LETTER, '## Experience', 'Role: Site Reliability Engineer'];
const plainCrypto = {encrypt: v => v, decrypt: v => v};
const markdown = lines => lines.map(line => (line.startsWith('## ') ? line : `- ${line}`)).join('\n') + '\n';
const copy = async () => ({dir: ''});   // the move's backup goes nowhere in a test
const isLetter = line => /Zorblax|Madame|^Langues|^Languages$|^Professional Development$|speak English/.test(line);

// The judge as the real one reads its own prompt: a word its schema and instructions offer is a word it can answer. calls: each call's lines.
function fakeJudge({vague = /^$/} = {}) {
  const calls = [];
  const client = {messages: {create: async request => {
    if (!/Each item is one line|Organize saved applicant lines/.test(request.system)) return wordingReply(request) || {content: [{type: 'text', text: '{}'}]};
    const parsed = JSON.parse(request.messages[0].content), items = Array.isArray(parsed) ? parsed : parsed.items;
    const offered = request.output_config.format.schema.properties.items.items.properties.clarity.enum;
    const proseOffered = offered.includes('prose') && /prose/.test(request.system);
    calls.push(items.map(each => each.line));
    return {content: [{type: 'text', text: JSON.stringify({items: items.map(({id, line}) => ({id, home: /speak English/.test(line) ? 'languages' : 'stay', topic: 'a fact',
      clarity: isLetter(line) ? (proseOffered ? 'prose' : 'off_topic') : vague.test(line) ? 'vague' : 'clear'}))})}]};
  }}};
  return {ai: {client}, calls};
}
const env = async (settings = {}) => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-letter-')), plainCrypto);
  storage.saveSettings({store: 'sqlite', telemetry: false, profileMovedAt: '2026-10-18T00:00:00.000Z', ...settings});
  await store.openStore(storage).page('profile').write(markdown(PROFILE));
  return storage;
};
const showsLetter = items => items.filter(each => isLetter(`${each.question} ${each.details.fact || ''} ${each.details.line || ''} ${each.value || ''}`));

test('a letter on the Profile is judged as prose: not unclear, not asked, in either drawer', async () => {
  const storage = await env(), {ai} = fakeJudge();
  const judged = await review.judgeNew(storage, {ai, copy});
  assert.ok(judged.judged >= LETTER.length, 'the lines were judged');
  assert.equal(judged.unclear, 0, 'a letter is not "unclear": judged 82, unclear 81 was the tester\'s log');
  assert.deepEqual(showsLetter(await review.pending(storage, {ai})), [], 'To check → Review lists none of the letter');
});

test('prose is never moved into Your details, whatever home the AI named for it', async () => {
  const storage = await env(), {ai} = fakeJudge();
  await review.judgeNew(storage, {ai, copy});
  const text = await store.openStore(storage).page('profile').text();
  assert.match(text, /I speak English, French and German fluently/, 'the line is still on the page');
  assert.deepEqual((await sections.read(storage)).languages, [], 'and not in Languages');
});

test('what a 0.9.2 install recorded as off_topic for the letter is judged again once, then left alone', async () => {
  const stale = Object.fromEntries([{label: 'Dear Hiring Team at Zorblax GmbH', value: 'I am excited to apply for the Site Reliability role in Zurich.'}, {label: '', value: 'I speak English, French and German fluently, which suits the Zorblax team.'}]
    .map(line => [sigOf(line), 'off_topic']));
  const storage = await env({answerClarity: stale});
  const {ai, calls} = fakeJudge();
  await review.judgeNew(storage, {ai, copy});
  assert.ok(calls.flat().some(line => /Zorblax/.test(line)), 'the old verdicts were asked again');
  assert.deepEqual(showsLetter(await review.pending(storage, {ai})), []);
  const first = calls.length;
  await review.judgeNew(storage, {ai, copy});
  assert.equal(calls.length, first, 'judged once under the new rules, no call the second time');
});

test('a real unclear answer beside the letter is still asked', async () => {
  const storage = await env(), {ai} = fakeJudge({vague: /depends/});
  await store.openStore(storage).page('profile').write(markdown(PROFILE.flatMap(line => (line === '## Experience' ? ['Ideal team size: depends', line] : [line]))));   // under Preferences, not under Experience (its own screen)
  await review.judgeNew(storage, {ai, copy});
  assert.ok((await review.pending(storage, {ai})).some(each => each.details.fact === 'Ideal team size'), 'the vague answer is asked');
});

test('a pass that did not re-judge the old unclear lines never stamps the rubric (Your details\' move records its own lines first)', async () => {
  const storage = await env({answerClarity: {[sigOf({label: 'Ideal team size', value: 'depends'})]: 'vague'}});
  record(storage, [{id: 'x', label: 'Relocation', value: 'open to moving within the EU'}], new Map([['x', {clarity: 'clear'}]]));
  assert.notEqual(storage.settings().answerClarityRubric, RUBRIC, 'only the pass that judges every unclear line stamps');
});

test('a judge that answers nothing keeps the old unclear verdicts and asks again next time', async () => {
  const stale = {[sigOf({label: 'Ideal team size', value: 'depends'})]: 'vague'};
  const storage = await env({answerClarity: stale});
  await store.openStore(storage).page('profile').write(markdown(PROFILE.flatMap(line => (line === '## Experience' ? ['Ideal team size: depends', line] : [line]))));
  const silent = {client: {messages: {create: async () => ({content: [{type: 'text', text: '{"items":[]}'}]})}}};
  await review.judgeNew(storage, {ai: silent, copy});
  assert.equal(verdictOf(storage, {label: 'Ideal team size', value: 'depends'}), 'vague', 'the old verdict stays: the queue is not emptied by a failed call');
  assert.notEqual(storage.settings().answerClarityRubric, RUBRIC, 'and the rubric is not stamped');
  const {ai, calls} = fakeJudge({vague: /depends/});
  await review.judgeNew(storage, {ai, copy});
  assert.ok(calls.flat().some(line => /depends/.test(line)), 'the next pass asked again');
  assert.equal(storage.settings().answerClarityRubric, RUBRIC);
});

test('an answer the judge calls prose is not moved into Your details, even with a home named', async () => {
  const client = {messages: {create: async request => {
    const parsed = JSON.parse(request.messages[0].content), items = Array.isArray(parsed) ? parsed : parsed.items;
    return {content: [{type: 'text', text: JSON.stringify({items: items.map(({id}) => ({id, home: 'languages', topic: 'a fact', clarity: 'prose'}))})}]};
  }}};
  assert.equal(await homeOf('Anything to add?', 'I speak English, French and German fluently.', {client}), '');
});
