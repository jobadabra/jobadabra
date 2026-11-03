// The one save of an answer (lib/question-answer.js), on a real local store: a place chosen by the caller routes the answer with no AI call, no place and no AI keeps it on the answers page (today's no-AI path).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../../../lib/storage.js';
import * as store from '../../../lib/store/index.js';
import * as sections from '../../../lib/profile-sections.js';
import * as questions from '../../../lib/questions.js';
import {answerKey} from '../../../lib/question-answer.js';

const ANSWERS = '## Common questions\n- Notice period: ❓ (asked by Acme)\n- How did you hear about us?: ❓\n';
const fresh = async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-answer-key-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite'});
  const opened = store.openStore(storage);
  await opened.page('profile').write('## Targets\n- **Roles:** Site Reliability Engineer\n');
  await opened.page('answers').write(ANSWERS);
  return storage;
};
const keyOf = async (storage, question) => (await questions.list(storage)).find(q => q.question === question).key;
const noAi = {client: {messages: {create: async () => { throw new Error('the AI must not be asked when the place is chosen'); }}}};

test('a place the caller chose routes the answer to Your details and asks no AI, even when an AI is available', async () => {
  const storage = await fresh();
  const done = await answerKey(storage, await keyOf(storage, 'Notice period'), '3 months', {home: 'availability', ai: noAi});
  assert.equal(done.ok, true);
  assert.equal(done.home, 'availability');
  assert.deepEqual((await sections.read(storage)).availability, [{label: 'Notice period', value: '3 months'}]);
  assert.doesNotMatch(await store.openStore(storage).page('answers').text(), /Notice period/, 'the open question left the answers page');
});

test('no place and no AI: the answer stays on the answers page as today, nothing is routed', async () => {
  const storage = await fresh();
  assert.deepEqual(await answerKey(storage, await keyOf(storage, 'How did you hear about us?'), 'LinkedIn'), {ok: true});
  assert.match(await store.openStore(storage).page('answers').text(), /How did you hear about us\?: LinkedIn/);
  assert.deepEqual((await sections.read(storage)).availability || [], []);
});
