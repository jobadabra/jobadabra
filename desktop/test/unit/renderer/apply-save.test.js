// saveApply is the one save path (Settings, Jobs, first-Apply): a save that turns Full automation on asks first, a decline writes nothing, a confirm stamps the mode before the write (renderer/apply-save.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {saveApply} from '../../../renderer/apply-save.js';

const now = new Date('2026-10-29T10:00:00.000Z');
const fresh = {apply: {mode: 'check', chosenAt: ''}};

test('Full automation: a decline writes nothing and returns null (Not now)', async () => {
  const writes = [];
  const saved = await saveApply({change: {mode: 'auto'}, current: fresh, confirm: async () => false, write: async patch => { writes.push(patch); return patch; }, now});
  assert.equal(saved, null);
  assert.deepEqual(writes, [], 'nothing is written after a decline');
});

test('Full automation: a confirm stamps autoConfirmedAt on the same write', async () => {
  const writes = [];
  const saved = await saveApply({change: {mode: 'auto'}, current: fresh, confirm: async () => true, write: async patch => { writes.push(patch); return patch; }, now});
  assert.equal(writes.length, 1);
  assert.equal(writes[0].apply.mode, 'auto');
  assert.equal(writes[0].apply.autoConfirmedAt, now.toISOString());
  assert.equal(saved.apply.autoConfirmedAt, now.toISOString());
});

test('any other mode never asks and writes at once', async () => {
  let asked = false;
  const writes = [];
  await saveApply({change: {mode: 'fill'}, current: fresh, confirm: async () => { asked = true; return true; }, write: async patch => { writes.push(patch); return patch; }, now});
  assert.equal(asked, false);
  assert.equal(writes[0].apply.mode, 'fill');
});

test('an already confirmed Full automation saves without asking again', async () => {
  let asked = false;
  const confirmed = {apply: {mode: 'auto', autoConfirmedAt: '2026-10-29T09:00:00.000Z'}};
  await saveApply({change: {auto: {waitMin: 1}}, current: confirmed, confirm: async () => { asked = true; return true; }, write: async patch => patch, now});
  assert.equal(asked, false);
});

test('a failed write returns null, so the page knows nothing was saved', async () => {
  const saved = await saveApply({change: {mode: 'check'}, current: fresh, confirm: async () => true, write: async () => null, now});
  assert.equal(saved, null);
});

// Why (14 Nov 2026, owner, plan 4b-1, asked via AskUserQuestion: "In the Full auto confirm (Recommended)"): Settings' own Full automation yes carries the LinkedIn line while Easy Apply is on.
test('with Easy Apply on, Settings\' Full automation yes shows the LinkedIn line and stamps "LinkedIn may send" on the same write; turning Easy Apply on later asks again', async () => {
  const on = {linkedinJobs: {on: true}, easyApply: {on: true}}, asked = [], writes = [];
  const confirm = async options => { asked.push(options); return true; };
  const saved = await saveApply({change: {mode: 'auto'}, current: {...on, apply: {mode: 'check'}}, confirm, write: async patch => { writes.push(patch); return patch; }, now});
  assert.equal(saved.apply.autoConfirmedAt, now.toISOString());
  assert.equal(saved.apply.linkedinConfirmedAt, now.toISOString());
  const before = {...on, apply: {mode: 'auto', chosenAt: '2026-10-29T09:00:00.000Z', autoConfirmedAt: '2026-10-29T09:00:00.000Z'}};
  assert.equal((await saveApply({change: {mode: 'auto'}, current: before, confirm, write: async patch => patch, now})).apply.linkedinConfirmedAt, now.toISOString(), 'confirmed before Easy Apply was on: asked again');
  assert.equal((await saveApply({change: {auto: {waitMin: 2}}, current: before, confirm: async () => assert.fail('a wait change asks nothing'), write: async patch => patch, now})).apply.linkedinConfirmedAt, '', 'another setting keeps what was there');
  const off = await saveApply({change: {mode: 'auto'}, current: {linkedinJobs: {on: true}, easyApply: {on: false}, apply: {mode: 'check'}}, confirm, write: async patch => patch, now});
  assert.equal(off.apply.linkedinConfirmedAt, '', 'Easy Apply off: no LinkedIn yes');
  assert.deepEqual(asked, [{linkedin: true}, {linkedin: true}, {linkedin: false}], 'the line shown is the yes stamped');
  assert.equal((await saveApply({change: {mode: 'fill'}, current: {...on, apply: saved.apply}, confirm, write: async patch => patch, now})).apply.linkedinConfirmedAt, '', 'leaving Full automation clears both yeses');
});
