// The desktop AI's change list and write cap (lib/desktop-ai-changes.js): what is recorded, that values are cut, that an undone entry stays, and the 60-in-10-minutes cap.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {record, list, find, markUndone, allowWrite, MAX_ENTRIES, VALUE_CHARS, WRITES, WINDOW_MS} from '../../../lib/desktop-ai-changes.js';
import {fakeStorage} from '../../desktop-ai-fake-storage.js';

const entry = (over = {}) => ({tool: 'answer_question', target: 'row7', question: 'Notice period', before: '❓', after: '3 months (new)', undo: '', ...over});

test('an accepted change is recorded with who made it, newest first, and found by id', () => {
  const storage = fakeStorage();
  const first = record(storage, entry(), new Date('2026-11-03T09:00:00Z'));
  const second = record(storage, entry({question: 'Visa'}), new Date('2026-11-03T09:01:00Z'));
  assert.equal(first.client, 'Claude Desktop');
  assert.equal(first.at, '2026-11-03T09:00:00.000Z');
  assert.deepEqual(list(storage).map(each => each.question), ['Visa', 'Notice period']);
  assert.equal(find(storage, first.id).after, '3 months (new)');
  assert.equal(find(storage, 'nope'), null);
  assert.notEqual(first.id, second.id);
});

test('values are cut, the list is capped, and a change keeps its place when undone', () => {
  const storage = fakeStorage();
  const long = record(storage, entry({after: 'x'.repeat(VALUE_CHARS + 300)}));
  assert.equal(long.after.length, VALUE_CHARS);
  for (let i = 0; i < MAX_ENTRIES + 10; i++) record(storage, entry({question: `q${i}`}));
  assert.equal(list(storage).length, MAX_ENTRIES);
  const mine = list(storage)[0];
  assert.equal(markUndone(storage, mine.id, new Date('2026-11-03T10:00:00Z')), true);
  assert.equal(find(storage, mine.id).undoneAt, '2026-11-03T10:00:00.000Z');
  assert.equal(markUndone(storage, mine.id), false, 'not twice');
  assert.equal(list(storage).length, MAX_ENTRIES, 'undone entries stay in the list');
});

test('the cap: the 61st write call in ten minutes is refused with a plain sentence, and writes are allowed again after the window', () => {
  const calls = [];
  const start = 1_000_000;
  for (let i = 0; i < WRITES; i++) assert.equal(allowWrite(calls, start + i).ok, true, `call ${i + 1}`);
  const refused = allowWrite(calls, start + WRITES);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /Slow down/);
  assert.equal(allowWrite(calls, start + WINDOW_MS + 5).ok, true, 'the first ones aged out');
});
