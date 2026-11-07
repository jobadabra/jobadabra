// The judge's answer becomes the mode table's flags; an unknown flag is null, never a guessed false (lib/triage-read.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFromJudge, readFromLook} from '../../../lib/triage-read.js';

test('a robot check in the judge answer is a captcha flag; the rest stays unknown', () => {
  assert.deepEqual(readFromJudge({answer: 'ready', botCheck: true}), {eligible: true, captcha: true, login: null, accountCreation: null, allFactsSaved: null});
  assert.deepEqual(readFromJudge({answer: 'ready', botCheck: false}).captcha, false);
});

test('a failed judge reads nothing: every flag unknown', () => {
  assert.deepEqual(readFromJudge({error: 'no AI'}), {eligible: true, captcha: null, login: null, accountCreation: null, allFactsSaved: null});
  assert.deepEqual(readFromJudge(undefined, {eligible: false}).eligible, false);
});

test('the judge login and account answers become flags; saved facts come from the caller, not the judge', () => {
  const read = readFromJudge({answer: 'ready', botCheck: false, loginWall: true, accountCreation: false}, {allFactsSaved: true});
  assert.deepEqual([read.login, read.accountCreation, read.allFactsSaved], [true, false, true]);
  assert.equal(readFromJudge({answer: 'ready', botCheck: false}).login, null);
  assert.equal(readFromJudge({answer: 'ready', botCheck: false, loginWall: false, accountCreation: false}).allFactsSaved, null, 'no saved-facts answer: unknown');
});

test('the light look names exactly one thing the person must do, or none for a simple form', () => {
  assert.deepEqual(readFromLook({simple: true, why: ''}), {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: null, simple: true, why: ''});
  const flags = why => { const read = readFromLook({simple: false, why}); return [read.captcha, read.login, read.accountCreation]; };
  assert.deepEqual(flags('captcha'), [true, false, false]);
  assert.deepEqual(flags('login'), [false, true, false]);
  assert.deepEqual(flags('account'), [false, false, true]);
  assert.deepEqual(flags('check'), [true, false, false], 'a frame among the form\'s fields may be a robot check: the person looks');
  assert.deepEqual(flags('no form'), [false, false, false], 'a page with no form is not a captcha, a login or an account');
});

test('a look without a verdict reads nothing: every flag unknown, never a simple form', () => {
  for (const report of [null, {}, {simple: 'yes'}]) assert.deepEqual(readFromLook(report), {eligible: true, captcha: null, login: null, accountCreation: null, allFactsSaved: null});
});
