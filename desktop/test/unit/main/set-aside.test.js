// "Which is right?" never deletes (owner, 17 Oct 2026: a card paired "Target ~CHF 10,000 net/month" with "Minimum CHF 150,000/year gross" and picking one
// deleted the other): a different amount is two facts, not a conflict, and every pick of Profile facts sets the other value aside where
// "Set aside" shows it with Undo. The class test loops over every resolve path and checks each old value is still somewhere.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../../../lib/storage.js';
import * as store from '../../../lib/store/index.js';
import * as sections from '../../../lib/profile-sections.js';
import {move, planOf, resolve} from '../../../lib/profile-move.js';
import {list} from '../../../lib/set-aside.js';
import {undo} from '../../../lib/set-aside-undo.js';

const plainCrypto = {encrypt: v => v, decrypt: v => v};
const fresh = () => { const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-aside-')), plainCrypto); s.saveSettings({store: 'sqlite'}); return s; };
const item = (id, page, label, value) => ({id, page, key: label, check: label, label, value, home: ''});
const judged = ids => new Map(ids.map(id => [id, {home: 'availability', topic: 'salary expectation'}]));

test('a different amount, period or basis is two facts, never a conflict; a different notice period still is one', () => {
  const salary = [item('profile:1', 'profile', 'Target', 'Target ~CHF 10,000 net/month'), item('answers:1', 'answers', 'Minimum', 'CHF 150,000/year gross')];
  const plan = planOf(salary, judged(['profile:1', 'answers:1']));
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.moves.map(each => each.value).sort(), ['CHF 150,000/year gross', 'Target ~CHF 10,000 net/month']);
  const notice = [item('profile:2', 'profile', 'Notice period', '2 months'), item('answers:2', 'answers', 'Notice period', '3 months')];
  const same = planOf(notice, new Map(notice.map(each => [each.id, {home: 'availability', topic: 'notice period'}])));
  assert.equal(same.conflicts.length, 1);
  const twice = [item('profile:3', 'profile', 'Salary', 'CHF 140,000'), item('answers:3', 'answers', 'Salary expectation', 'chf 140,000')];
  assert.equal(planOf(twice, judged(['profile:3', 'answers:3'])).moves.length, 1);   // the same amount said twice is still one line
});

for (const pick of [0, 1]) {
  test(`Profile facts: pick ${pick} sets the other value aside; nothing is deleted; Undo puts it back`, async () => {
    const storage = fresh();
    await store.openStore(storage).page('profile').write('## Targets\n- **Notice period:** 2 months\n');
    await store.openStore(storage).page('answers').write('## Availability and pay\n\n| Question | Answer |\n|---|---|\n| Notice period / earliest start | 3 months |\n');
    const ai = {client: {messages: {create: async request => ({content: [{type: 'text', text: JSON.stringify({items: JSON.parse(request.messages[0].content).map(({id}) => ({id, home: 'availability', topic: 'notice period'}))})}]})}}};
    const {conflicts} = await move(storage, {ai, copy: async () => ({dir: 'd'})});
    const values = conflicts[0].choices.map(choice => choice.value);
    assert.deepEqual(await resolve(storage, conflicts[0].topic, pick), {ok: true});
    const other = values[1 - pick];
    const aside = list(storage);
    assert.deepEqual(aside.map(each => each.value), [other], 'the other value is set aside');
    assert.deepEqual((await sections.read(storage)).availability.map(line => line.value), [values[pick]]);
    assert.deepEqual(await undo(storage, aside[0].id), {ok: true});
    assert.deepEqual((await sections.read(storage)).availability.map(line => line.value).sort(), [...values].sort(), 'Undo: both are lines again');
    assert.deepEqual(list(storage), []);
    assert.deepEqual(await undo(storage, aside[0].id), {ok: false, error: 'That is no longer set aside'});
  });
}
