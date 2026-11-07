// Layer 3 (Node + the real engine + a temp store, no window): with no AI answering, a Your details fact is asked once, never also as a bare field label in What we learned (#3514, AI persona runs 42397493597, 42397491150, 42397498182).
// The persona's data shape: the strategy draft's answers page (desktop/demo/draft.json: "- Notice period: ❓" under Eligibility) and a form's own question; the app's AI refuses every call (the agent suite's stand-in).
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {startEngineKit} from './engine-kit.mjs';

let kit, lists;
before(async () => {
  kit = await startEngineKit({});
  const [{openShown}, store] = await Promise.all([import('../../lib/question-lists.js'), import('../../lib/store/index.js')]);
  kit.proxy.setCanned(() => ({refuse: 'invalid-key'}));
  const opened = store.openStore(kit.storage);
  await opened.page('answers').write('# Eligibility\n\n- Work permit: EU citizen, no sponsorship needed in Switzerland or the EU\n- Notice period: ❓\n- Salary expectation: ❓\n- Languages: ❓\n- What is your preferred start date and notice period?: ❓\n');
  lists = await openShown(kit.storage, {ai: {}});
});
after(async () => { await kit?.close(); });

const same = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

test('a Your details fact is asked once, in Fill your details, never also as a bare label in What we learned', () => {
  assert.ok(lists.learned.some(row => /start date and notice period/.test(row.question)), 'positive control: the form question that is a sentence is still listed in What we learned');
  assert.ok(lists.details.some(row => same(row.details?.fact) === 'notice period'), 'the notice period is asked in Fill your details');
  assert.deepEqual(lists.learned.filter(row => same(row.question) === 'notice period').map(row => row.question), [], 'and not again in What we learned');
});

test('a fact Fill your details does not ask today stays listed once, never in neither list', () => {
  const rows = [...lists.details.map(row => same(row.details?.fact || row.question)), ...lists.learned.map(row => same(row.question))];
  for (const label of ['salary expectation', 'languages']) assert.equal(rows.filter(each => each === label).length, 1, `${label} is asked exactly once`);
});
