// Apply triage's mode table: each form read gives one mode, and a missing flag never counts as the safe answer (lib/apply-triage-mode.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {modeOfRead} from '../../../renderer/apply-triage-mode.js';

const clean = {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: true};

test('no captcha, no login, every answer a saved fact: Full automation can take it', () => {
  assert.deepEqual(modeOfRead(clean), {mode: 'auto', reason: 'every answer is a saved fact'});
});

test('no captcha, no login, some answers not saved: Background (you review and submit)', () => {
  assert.deepEqual(modeOfRead({...clean, allFactsSaved: false}), {mode: 'fill', reason: 'answers you have not saved'});
});

test('a captcha, a login wall, or an account to create: Standard, with the reason', () => {
  assert.deepEqual(modeOfRead({...clean, captcha: true}), {mode: 'check', reason: 'captcha'});
  assert.deepEqual(modeOfRead({...clean, login: true}), {mode: 'check', reason: 'login wall'});
  assert.deepEqual(modeOfRead({...clean, accountCreation: true}), {mode: 'check', reason: 'asks you to create an account'});
});

test('not eligible is skipped, whatever the form says', () => {
  assert.deepEqual(modeOfRead({...clean, eligible: false}), {mode: 'none', reason: 'not eligible'});
});

test('a missing flag is the unsafe answer, never the automatic one', () => {
  assert.equal(modeOfRead({eligible: true}).mode, 'check', 'no captcha answer: the person decides');
  assert.equal(modeOfRead({...clean, allFactsSaved: undefined}).mode, 'fill');
  assert.equal(modeOfRead(undefined).mode, 'none');
  assert.equal(modeOfRead(null).mode, 'none', 'a failed read (null) is never automatic');
});

test('the captcha outranks the answers: a captcha form is never Background or Full automation', () => {
  assert.equal(modeOfRead({...clean, captcha: true, allFactsSaved: false}).mode, 'check');
});

test('the light look: a simple form is Full automation, anything else it named needs the person, and a captcha still outranks a simple flag', () => {
  const look = {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: null};
  assert.deepEqual(modeOfRead({...look, simple: true, why: ''}), {mode: 'auto', reason: 'a simple form'});
  assert.deepEqual(modeOfRead({...look, simple: false, why: 'no form'}), {mode: 'check', reason: 'no form'});
  assert.deepEqual(modeOfRead({...look, captcha: true, simple: false, why: 'captcha'}), {mode: 'check', reason: 'captcha'});
  assert.deepEqual(modeOfRead({...look, captcha: true, simple: true}), {mode: 'check', reason: 'captcha'});
  assert.equal(modeOfRead({...look, eligible: false, simple: true}).mode, 'none', 'a job marked not eligible is never taken by a simple form');
  assert.deepEqual(modeOfRead({eligible: true, captcha: null, login: null, accountCreation: null, allFactsSaved: null}).mode, 'check', 'an unknown look is the unsafe answer');
});

test('a read that could not be made is never a mode a batch can take', () => {
  assert.deepEqual(modeOfRead({unreadable: true, why: 'timeout'}), {mode: 'none', reason: 'unreadable'});
  assert.deepEqual(modeOfRead({unreadable: true, eligible: true, captcha: false, login: false, accountCreation: false, simple: true}).mode, 'none', 'even with flags that would read as simple');
});
