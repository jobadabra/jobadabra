// Apply triage's mode table: each form read gives one mode, and a missing flag never counts as the safe answer (lib/apply-triage-mode.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountNeed, modeOfRead} from '../../../renderer/apply-triage-mode.js';

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

// L2b (owner 7 Nov 2026, "Simple form, but can or not be applied automatically"): the check's match splits a simple form.
test('a simple form whose required questions lack saved details is fill, not auto; with nothing missing or no match it stays auto; a captcha still outranks it', () => {
  const look = {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: null, simple: true, why: ''};
  const missing = [{kind: 'detail', label: 'Notice period'}];
  assert.deepEqual(modeOfRead({...look, match: {missing, unjudged: 0}}), {mode: 'fill', reason: 'needs your details'});
  assert.deepEqual(modeOfRead({...look, match: {missing: [], unjudged: 0}}), {mode: 'auto', reason: 'a simple form'});
  assert.deepEqual(modeOfRead(look), {mode: 'auto', reason: 'a simple form'}, 'an older extension sends no questions: as read');
  assert.deepEqual(modeOfRead({...look, questions: []}), {mode: 'auto', reason: 'a simple form'}, 'a form with no required typed question has nothing to match');
  // Not judged = not read on a guess (review of L2b): questions the match could not judge never read "can apply automatically".
  const asked = {...look, questions: ['Notice period']};
  assert.deepEqual(modeOfRead({...asked, match: {missing: [], unjudged: 0}}), {mode: 'auto', reason: 'a simple form'});
  for (const read of [asked, {...asked, match: {missing: [], unjudged: 1}}, {...look, questions: null}]) assert.deepEqual(modeOfRead(read), {mode: 'fill', reason: 'answers not checked'}, JSON.stringify(read));
  assert.equal(modeOfRead({...asked, match: {missing, unjudged: 1}}).reason, 'needs your details', 'what is known to be missing wins over what is unjudged');
  assert.equal(modeOfRead({...look, captcha: true, match: {missing, unjudged: 0}}).mode, 'check');
});

test('a required box with no question text is a lasting "a box without a question", not "answers not checked"; what is known missing still wins', () => {
  const look = {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: null, simple: true, why: '', questions: ['field_1']};
  assert.deepEqual(modeOfRead({...look, match: {missing: [], unjudged: 0, unnamed: 1}}), {mode: 'fill', reason: 'a box without a question'});
  assert.equal(modeOfRead({...look, match: {missing: [{kind: 'detail', label: 'Phone'}], unjudged: 0, unnamed: 1}}).reason, 'needs your details');
});

// Owner, 13 Nov 2026: "Let's somehow mark the jobs that requires an account... Let's add a chip to that job" (renderer/account-chip.js draws it).
test('"Account needed": a sign-in page or an account to create is named; unknown, clean or unread forms show nothing', () => {
  assert.deepEqual(accountNeed({...clean, login: true}), {kind: 'site', why: 'sign-in'});
  assert.deepEqual(accountNeed({...clean, accountCreation: true}), {kind: 'site', why: 'create'});
  assert.deepEqual(accountNeed({...clean, login: true, accountCreation: true}), {kind: 'site', why: 'sign-in'}, 'one chip, sign-in first');
  for (const read of [null, undefined, clean, {...clean, login: null, accountCreation: null}, {unreadable: true, login: true}]) assert.equal(accountNeed(read), null, JSON.stringify(read));
});
