// A question always names what it asks about, and a heading is never an answer (owner, 2-3 Nov 2026, a Windows tester's screens: "Workload" as a question; "Summary" with
// "Saved: Summary"; a French CV's headings kept with "Keep as is"; "Languages: make it exact" with one level grid and no language). Each test plays one of those screens
// through lib/details-review.js pending() and answer(), on the real store (SQLite). The AI is a fake (no spend). Guarded together with test/unit/renderer/question-sense.test.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../../../lib/storage.js';
import * as store from '../../../lib/store/index.js';
import * as review from '../../../lib/details-review.js';
import * as sections from '../../../lib/profile-sections.js';
import * as learnings from '../../../lib/learnings.js';
import * as learned from '../../../lib/learned.js';
import {needsCheck} from '../../../renderer/question-values.js';
import {wordingReply} from '../../fake-wording.js';

const plainCrypto = {encrypt: v => v, decrypt: v => v};
const markdown = lines => lines.map(line => (line.startsWith('## ') ? line : `- ${line}`)).join('\n') + '\n';
// What the tester's Profile held: a ❓ line, CV headings saved as lines (no label / label = value), a French heading, and a language line with one inexact part.
const PROFILE = ['## Preferences', 'Workload: ❓ 100% only, or a range', 'Summary', 'Key Skills: Key Skills', 'Formation & qualifications professionnelles', 'Ideal team size: depends',
  '## 🗣️ Languages', 'Languages: Romanian: Native; English: Fluent; French: B1 [language]'];
const CLARITY = {'\nsummary': 'off_topic', 'key skills\nkey skills': 'off_topic', '\nformation & qualifications professionnelles': 'off_topic', 'ideal team size\ndepends': 'vague'};
const ai = (reply = wordingReply) => ({client: {messages: {create: async request => reply(request) || {content: [{type: 'text', text: '{}'}]}}}});
const env = async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-sense-')), plainCrypto);
  storage.saveSettings({store: 'sqlite', telemetry: false, profileMovedAt: '2026-10-18T00:00:00.000Z', answerClarity: CLARITY});
  await store.openStore(storage).page('profile').write(markdown(PROFILE));
  return storage;
};

test('a ❓ line is asked as a real question, never as its bare label ("Workload")', async () => {
  const storage = await env();
  const asked = (await review.pending(storage, {ai: ai()})).filter(each => ['open', 'unclear'].includes(each.details.kind));
  const workload = asked.find(each => each.details.fact === 'Workload');
  assert.ok(workload, 'Workload is asked');
  assert.notEqual(workload.question, 'Workload');
  assert.match(workload.question, /\?$/);
  assert.equal(workload.hint, '100% only, or a range', 'the hint the line carried stays');
  for (const each of asked) assert.notEqual(each.question, each.details.fact, `${each.details.fact} is asked in words`);
});

test('a question that cannot be worded is not shown: no AI, a failed call, or the AI left the label out', async () => {
  const none = await review.pending(await env(), {});
  assert.ok(!none.some(each => each.details.fact === 'Workload'), 'no AI: not shown as its label');
  const broken = {client: {messages: {create: async () => { throw new Error('offline'); }}}};
  assert.ok(!(await review.pending(await env(), {ai: broken})).some(each => each.details.fact === 'Workload'));
  const echoes = {client: {messages: {create: async request => {
    const lines = String(request.messages[0].content).split('\n').filter(line => /^f\d+: /.test(line));
    return {content: [{type: 'text', text: JSON.stringify({asks: lines.map(line => ({field: line.split(':')[0], question: 'Workload', hint: ''}))})}]};
  }}}};
  assert.ok(!(await review.pending(await env(), {ai: echoes})).some(each => each.details.fact === 'Workload'), 'the AI answered the label again: still not a question');
});

test('a label is worded once: the next list opens without another call', async () => {
  const storage = await env();
  let calls = 0;
  const counting = ai(request => { if (/is "id: label"/.test(request.system)) calls++; return wordingReply(request); });
  await review.pending(storage, {ai: counting});
  const first = calls;
  await review.pending(storage, {ai: counting});
  assert.ok(first >= 1 && calls === first, `${first} call(s), then none`);
});

test('a heading saved as a line is no question: "Summary", "Key Skills: Key Skills", a French CV heading', async () => {
  const storage = await env();
  const items = await review.pending(storage, {ai: ai()});
  const facts = items.map(each => `${each.details.fact} ${each.question} ${each.details.line || ''}`).join('\n');
  for (const heading of ['Summary', 'Key Skills', 'Formation & qualifications professionnelles']) assert.doesNotMatch(facts, new RegExp(heading), `${heading} is not asked`);
  assert.ok(items.some(each => each.details.fact === 'Ideal team size'), 'a real unclear answer is still asked');
});

test('"Keep as is" on a heading is refused, a new value still replaces it', async () => {
  const storage = await env();
  const ref = {page: 'profile', label: 'Key Skills', value: 'Key Skills'};
  const key = `${review.PREFIX}unclear:${JSON.stringify(ref)}`;
  const kept = await review.answer(storage, key, review.KEEP_AS_IS);
  assert.equal(kept.ok, false, 'a label-as-value is not keepable');
  assert.equal(storage.settings().answerClarity['key skills\nkey skills'], 'off_topic', 'and no "kept" mark was written');
  const replaced = await review.answer(storage, key, 'Kubernetes, Terraform');
  assert.equal(replaced.ok, true, replaced.error);
  assert.match(await store.openStore(storage).page('profile').text(), /Key Skills: Kubernetes, Terraform/);
});

test('a form fill never learns a field\'s label (or another field\'s label) as its answer', async () => {
  const plan = learned.plan([{label: 'Summary', value: 'Summary'}, {label: 'Education', value: 'Key Skills'}, {label: 'Key Skills', value: 'Terraform'}, {label: 'Willing to travel', value: 'Yes'}]);
  assert.deepEqual(plan.answers.map(each => each.label), ['Key Skills', 'Willing to travel'], 'Summary: Summary and Education: Key Skills (another label) are dropped');
  const storage = await env();
  let judged = [];
  const client = {messages: {create: async request => {
    judged = [...String(request.messages[0].content).matchAll(/"label":"([^"]+)"/g)].map(each => each[1]);
    return {content: [{type: 'text', text: JSON.stringify({verdicts: []})}], stop_reason: 'end_turn', usage: {}};
  }}};
  await learnings.learn(storage, {answers: [{label: 'Summary', value: 'Summary'}, {label: 'Willing to travel', value: 'Yes'}], client});
  assert.deepEqual(judged, ['Willing to travel'], 'the AI is never asked about a heading');
});

test('a language line is asked one language at a time, naming it, the exact parts shown as done', async () => {
  const storage = await env();
  const checks = (await review.pending(storage, {ai: ai()})).filter(each => each.details.kind === 'check');
  assert.equal(checks.length, 1, 'only English: Fluent is inexact');
  const [english] = checks;
  assert.match(english.question, /^English: .*Fluent.*Which level\?$/);
  assert.equal(english.details.line, 'Already exact: Romanian: Native · French: B1');
  assert.equal(english.format.kind, 'language');
  assert.equal((await review.answer(storage, english.key, 'C1')).ok, true);
  const line = (await sections.read(storage)).languages.find(each => each.label === 'Languages');
  assert.equal(line.value, 'Romanian: Native; English: C1; French: B1', 'the other parts stay as written');
  assert.equal(needsCheck('language', line.value), false, 'the line is exact now');
  assert.ok(!(await review.pending(storage, {ai: ai()})).some(each => each.details.kind === 'check'), 'and no longer asked');
});

test('a language part is not taken as a word that is not a level', async () => {
  const storage = await env();
  const [english] = (await review.pending(storage, {ai: ai()})).filter(each => each.details.kind === 'check');
  assert.equal((await review.answer(storage, english.key, 'Fluent')).ok, false);
});

test('an older fill\'s "Summary: Summary" on the answers page is never asked', async () => {
  const storage = await env();
  await store.openStore(storage).page('answers').write(markdown(['## Learned from forms', 'Summary: Summary (new)', 'Willing to travel: Yes (new)']));
  const asked = (await review.pending(storage, {ai: ai()})).filter(each => each.details.kind === 'taught');
  assert.deepEqual(asked.map(each => each.details.fact), ['Willing to travel']);
  assert.match(asked[0].question, /\?$/, 'a learning is asked in words too, never as its bare label');
});

test('a label that already asks is shown with no AI at all, and costs no call', async () => {
  const storage = await env();
  await store.openStore(storage).page('profile').write(markdown(['## Preferences', 'Need visa sponsorship?: ❓']));
  assert.ok((await review.pending(storage, {})).some(each => each.question === 'Need visa sponsorship?'));
});

test('a language line of several languages with no levels is asked per language, never as one grid that rewrites the line', async () => {
  const storage = await env();
  await store.openStore(storage).page('profile').write(markdown(['## 🗣️ Languages', 'Languages: English, French [language]']));
  const checks = (await review.pending(storage, {ai: ai()})).filter(each => each.details.kind === 'check');
  assert.deepEqual(checks.map(each => each.question), ['English: which level?', 'French: which level?']);
  assert.equal((await review.answer(storage, checks[0].key, 'B2')).ok, true);
  assert.equal((await sections.read(storage)).languages.find(each => each.label === 'Languages').value, 'English: B2; French', 'the language names stay');
});
