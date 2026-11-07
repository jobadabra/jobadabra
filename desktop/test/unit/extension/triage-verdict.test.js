// The light triage read's verdict (extension/triage-verdict.js): the AI's page-kind answer decides what the page is, the control counts only AND with it.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verdictOf} from '../../../../extension/triage-verdict.js';

const form = {role: 'form', botCheck: false, accountStep: ''};
const shape = (over = {}) => ({fields: 4, textareas: 1, files: 1, anyFiles: 1, passwords: 0, choices: 0, frames: 0, ...over});

test('a form the AI named with controls to fill and no check, account or login is a simple form', () => {
  assert.deepEqual(verdictOf(form, shape()), {simple: true, why: ''});
});

test('a bot check, a login and an account step each name their one reason, in that order of strength', () => {
  assert.deepEqual(verdictOf({...form, botCheck: true}, shape()), {simple: false, why: 'captcha'});
  assert.deepEqual(verdictOf({role: 'account', accountStep: 'sign_in'}, shape({passwords: 1})), {simple: false, why: 'login'});
  assert.deepEqual(verdictOf({role: 'account', accountStep: 'sign_up'}, shape({passwords: 2})), {simple: false, why: 'account'});
  assert.deepEqual(verdictOf({role: 'account', accountStep: ''}, shape()), {simple: false, why: 'account'});
  assert.deepEqual(verdictOf({role: 'account', accountStep: 'sign_in', botCheck: true}, shape()), {simple: false, why: 'captcha'});
});

test('a posting or any other page is no form here, even when it shows a search box', () => {
  assert.deepEqual(verdictOf({role: 'posting'}, shape({fields: 1, textareas: 0, files: 0, anyFiles: 0})), {simple: false, why: 'no form'});
  assert.deepEqual(verdictOf({role: 'no-form'}, shape()), {simple: false, why: 'no form'});
});

test('the counts only AND: a "form" with nothing to fill is no form, and one whose controls sit in a frame is a frame, never a guess', () => {
  const empty = {fields: 0, textareas: 0, files: 0, anyFiles: 0, passwords: 0, choices: 0, frames: 0};
  assert.deepEqual(verdictOf(form, empty), {simple: false, why: 'no form'});
  assert.deepEqual(verdictOf(form, {...empty, frames: 1}), {simple: false, why: 'frame'});
  assert.deepEqual(verdictOf(form, shape({passwords: 1})), {simple: false, why: 'account'}, 'a password box on an application page is not a simple form, whatever the answer said');
});

test('a button-drawn question step and a hidden upload count as controls', () => {
  assert.equal(verdictOf(form, {fields: 0, textareas: 0, files: 0, anyFiles: 0, passwords: 0, choices: 2, frames: 0}).simple, true);
  assert.equal(verdictOf(form, {fields: 0, textareas: 0, files: 0, anyFiles: 1, passwords: 0, choices: 0, frames: 0}).simple, true);
});

test('no page-kind answer is unknown, never simple', () => {
  assert.deepEqual(verdictOf(null, shape()), {simple: false, why: 'unknown'});
  assert.deepEqual(verdictOf({}, shape()), {simple: false, why: 'unknown'});
});

// Review of #3519: the page-kind prompt answers botCheck false for a robot check among the form's own fields, so the counts must demote it.
test('a form with a visible frame among its fields may need a check, whatever the AI said about the page', () => {
  assert.deepEqual(verdictOf({...form, botCheck: false}, shape({frames: 1})), {simple: false, why: 'check'});
  assert.deepEqual(verdictOf(form, shape({frames: 0})), {simple: true, why: ''}, 'positive control: the same form without a frame is simple');
});

test('a posting whose application is a form behind Apply is "posting" (press it once); an e-mail application or a closed posting is no form', () => {
  assert.deepEqual(verdictOf({role: 'no-form', kind: 'posting', applyBy: 'form'}, shape({fields: 0, textareas: 0, files: 0, anyFiles: 0})), {simple: false, why: 'posting'});
  assert.deepEqual(verdictOf({role: 'no-form', kind: 'posting', applyBy: ''}, shape({fields: 0, textareas: 0, files: 0, anyFiles: 0})), {simple: false, why: 'posting'});
  assert.equal(verdictOf({role: 'no-form', kind: 'posting', applyBy: 'email'}, shape()).why, 'no form');
  assert.equal(verdictOf({role: 'no-form', kind: 'closed'}, shape()).why, 'no form');
});
