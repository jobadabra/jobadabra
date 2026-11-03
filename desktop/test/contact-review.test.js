// The contact questions of the review queue are generated from what Your details lacks, never typed (lib/contact-review.js; owner, 27 Oct 2026: "This should not be
// hard-coded. There should be a pool of questions being dynamically generated out of the missing details"; "if the user does have already these details, how are we asking him again?").
// The AI is a fake that words, rates and drops held fields (no spend).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as contactDetails from '../lib/contact.js';
import * as review from '../lib/details-review.js';
import {BLOCKED, MUST} from '../renderer/question-filter.js';
install();   // question-nav.js draws with the window's components
const {stateOf} = await import('../renderer/question-nav.js');
import {asks, weightOf} from '../lib/contact-review.js';
import {install} from './tiny-dom.js';

const plainCrypto = {encrypt: v => v, decrypt: v => v};
const fresh = () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-contact-')), plainCrypto);
  storage.saveSettings({store: 'sqlite', telemetry: false, missingFacts: {since: '2020-01-01'}});
  return storage;
};
let calls = 0;
const client = {messages: {create: async request => {
  const tag = request.messages[0].content.startsWith('<facts>') ? 'facts' : 'empty';   // the same writer words the base facts (lib/missing-facts.js wording)
  if (tag === 'empty') calls += 1;
  const keys = [...request.messages[0].content.match(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`))[1].matchAll(/^(\w+):/gm)].map(each => each[1]);
  return {content: [{type: 'text', text: JSON.stringify({asks: keys.map(field => ({field, question: `Q-${field}`, hint: '', importance: field === 'last_name' ? 3 : field === 'github' ? 0 : 2, held: field === 'phone'}))})}]};
}}};
const contactItems = async (storage, ai) => (await review.pending(storage, {ai})).filter(each => each.details.kind === 'contact');

test('the questions are worded and rated by the AI; a held field and a not-worth-asking one are not asked', async () => {
  const items = await contactItems(fresh(), {client});
  const asked = items.map(each => each.question);
  assert.ok(asked.includes('Q-last_name') && asked.includes('Q-email'));
  assert.ok(!asked.includes('Q-phone') && !asked.includes('Q-github'), `held and importance 0 stay out: ${asked}`);
  const weight = field => items.find(each => each.question === `Q-${field}`).details.weight;
  assert.ok(weight('last_name') > weight('email'), 'importance 3 outweighs 2');
});

test('what the AI wrote is kept for the same set of empty fields: a second list asks nothing', async () => {
  const storage = fresh();
  calls = 0;
  await contactItems(storage, {client});
  const first = calls;
  await contactItems(storage, {client});
  assert.equal(calls, first);
});

test('a detail Your details already has is not asked again', async () => {
  const storage = fresh();
  await contactDetails.save(storage, {first_name: 'Ana', last_name: 'Lupu', email: 'ana@example.org', phone: '+373 1'});
  const asked = (await contactItems(storage, {client})).map(each => each.question);
  assert.ok(!asked.some(each => /first_name|last_name|email|phone/.test(each)), `nothing held is asked: ${asked}`);
});

test('no AI at all: the first four empty fields by their label, outranking a blocked fill; an answer lands in its field', async () => {
  const storage = fresh();
  const items = await contactItems(storage, {});
  assert.deepEqual(items.map(each => each.question), ['First name', 'Last name', 'Email', 'Phone']);
  assert.ok(items.every(each => each.details.weight === MUST));
  assert.equal((await review.answer(storage, items[0].key, 'Ana')).ok, true);
  assert.equal((await contactDetails.read(storage)).first_name, 'Ana');
});

test('the weight of a rating: 3 above any blocked fill, 2 right below them, 0 none', () => {
  assert.ok(weightOf(3) > BLOCKED && weightOf(2) < BLOCKED && weightOf(2) > weightOf(1) && weightOf(0) === 0);
});


test('contact wording names its AI request', async () => {
  let sent;
  const client = {messages: {create: async (_request, options) => { sent = options; return {content: []}; }}};
  await asks(fresh(), ['first_name'], {client});
  assert.equal(sent?.headers?.['x-jp-action'], 'contact_asks');
});

// Windows tester on 0.9.2, 3 Nov 2026: a finance and accounting profile had GitHub and Website marked "Needed by every form" and counted as missing (the label was one fixed
// string for every contact detail, and the AI was never told the person's line of work).
test('the AI is told the person\'s roles, a role change asks again, and each question\'s label follows its rating (finance profile: GitHub and Website are not "every form")', async () => {
  const storage = fresh();
  storage.writeText('config/search.json', JSON.stringify({target_roles: [{title: 'Senior Accountant', also: []}, {title: 'Financial Controller', also: []}]}));
  const seen = [];
  const rating = {last_name: 3, email: 3, github: 0, website: 1, linkedin: 2};
  const roleAware = {messages: {create: async request => {
    const content = request.messages[0].content;
    seen.push({content, system: request.system});
    if (!content.startsWith('<empty>')) return {content: []};   // the base facts' wording is another call
    const keys = [...content.match(/<empty>\n([\s\S]*?)\n<\/empty>/)[1].matchAll(/^(\w+):/gm)].map(each => each[1]);
    return {content: [{type: 'text', text: JSON.stringify({asks: keys.map(field => ({field, question: `Q-${field}`, hint: '', importance: rating[field] ?? 2, held: false}))})}]};
  }}};
  const items = await contactItems(storage, {client: roleAware});
  assert.match(seen[0].content, /<roles>Senior Accountant; Financial Controller<\/roles>/, 'the request carries the person\'s roles');
  assert.match(seen[0].system, /<roles>[\s\S]*GitHub or a personal website for accounting/, 'the prompt says how to rate a link for a non-software line of work');
  const words = field => stateOf({details: items.find(each => each.question === `Q-${field}`).details})[0];
  assert.equal(words('last_name'), 'Needed by every form');
  assert.equal(words('linkedin'), 'Asked by many forms');
  assert.ok(!items.some(each => each.question === 'Q-website'), 'rated 1 (only some forms): a suggestion, not a missing answer: not asked, not counted in the badge');
  assert.ok(!items.some(each => each.question === 'Q-github'), 'rated 0: never asked, so never counted as missing');
  storage.writeText('config/search.json', JSON.stringify({target_roles: [{title: 'Software Engineer', also: []}]}));
  const contactCalls = () => seen.filter(each => each.content.startsWith('<empty>')).length, before = contactCalls();
  await contactItems(storage, {client: roleAware});
  assert.equal(contactCalls(), before + 1, 'another line of work is worded and rated again, not read from the kept answer');
});
