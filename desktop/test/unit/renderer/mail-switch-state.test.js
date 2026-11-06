// The state behind every per-mail switch (renderer/mail-switch-state.js, hr 4/8): a press shows at once in every place, saves through the one IPC, and a refused save puts the switch back with the website's words.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createMailState} from '../../../renderer/mail-switch-state.js';

const rows = () => ({ok: true, mode: 'mac', where: 'From your Mac', rows: [{id: 'app-matches', name: 'New matches', on: false}, {id: 'app-needs-you', name: 'An application needs you', on: true}]});
const setup = ({set = async () => ({ok: true}), read = async () => rows()} = {}) => {
  const drawn = [], saved = [];
  const mail = createMailState({mailChoices: read, mailChoiceSet: async (id, on) => { saved.push([id, on]); return set(id, on); }}, () => drawn.push(mail.state()?.rows?.map(row => row.on)));
  return {mail, drawn, saved};
};

test('a press shows at once, then saves the one choice for that row', async () => {
  const {mail, drawn, saved} = setup();
  await mail.read();
  const press = mail.press('app-matches', true);
  assert.equal(mail.state().rows[0].on, true, 'on screen before the website answers');
  await press;
  assert.deepEqual(saved, [['app-matches', true]]);
  assert.deepEqual(drawn.at(-1), [true, true]);
  assert.equal(mail.note('app-matches'), '');
});

test('a refused save puts the switch back and keeps the website\'s words beside it until the next press', async () => {
  const {mail, drawn} = setup({set: async () => ({ok: false, error: 'Could not save it just now. The switch is back where it was; try again in a minute.'})});
  await mail.read();
  await mail.press('app-needs-you', false);
  assert.equal(mail.state().rows[1].on, true);
  assert.match(mail.note('app-needs-you'), /switch is back where it was/);
  assert.deepEqual(drawn.at(-1), [false, true]);
  assert.equal(mail.note('app-matches'), '', 'only the pressed row carries the words');
});

test('a bridge that throws is a refusal too, and an unknown row or an unread state saves nothing', async () => {
  const thrown = setup({set: async () => { throw new Error('offline'); }});
  await thrown.mail.read();
  await thrown.mail.press('app-matches', true);
  assert.equal(thrown.mail.state().rows[0].on, false);
  assert.equal(thrown.mail.note('app-matches'), 'offline');
  const unread = setup({read: async () => { throw new Error('x'); }});
  await unread.mail.read();
  assert.equal(unread.mail.state(), null);
  await unread.mail.press('app-matches', true);
  const unknown = setup();
  await unknown.mail.read();
  await unknown.mail.press('app-everything', true);
  assert.deepEqual([unread.saved, unknown.saved], [[], []]);
});

test('two quick presses on one row save in order, and when the first is refused the screen shows what the website holds', async () => {
  const order = [];
  const {mail} = setup({set: async (id, on) => { order.push(on); return on ? {ok: false, error: 'no'} : {ok: false, error: 'no'}; }});
  await mail.read();
  await Promise.all([mail.press('app-matches', true), mail.press('app-matches', false)]);
  assert.deepEqual(order, [true, false], 'one after the other, never out of order');
  assert.equal(mail.state().rows[0].on, false, 'both refused: the original value, not the opposite of it');
});

test('a read that runs while a press is saving waits for it, so the press is not undone', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const {mail} = setup({set: () => gate.then(() => ({ok: true}))});
  await mail.read();
  const press = mail.press('app-matches', true), reading = mail.read();
  release();
  await Promise.all([press, reading]);
  assert.equal(mail.state().rows[0].on, false, 'the read happened after the save: it shows what the (fake) website returns, here the stored original');
});
