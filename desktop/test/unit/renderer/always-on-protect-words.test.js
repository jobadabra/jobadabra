// "How we protect your data": the owner's line word for word, and the claims the popup is allowed to make (checked against the code on 5 Nov 2026; docs/superpowers/specs/2026-11-04-always-on-one-choice.md).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LEAD, MEASURES, NOTE} from '../../../renderer/always-on-protect-words.js';

test('the card line is the owner\'s exact wording (5 Nov 2026)', () => {
  assert.equal(NOTE, 'Your profile is stored encrypted on our servers, kept apart per account, and deleted when you turn this off.');
});

test('every measure has a title, a sentence and a chip of icon + word; the ids are unique', () => {
  assert.equal(new Set(MEASURES.map(measure => measure.id)).size, MEASURES.length);
  for (const {title, text, chip} of MEASURES) {
    assert.ok(title && text.length > 20, `${title} says something`);
    assert.equal(chip.length, 3, `${title} has [word, tone, icon]`);
    assert.ok(chip.every(Boolean));
  }
});

test('the popup says what it is not, and never that everything is encrypted (found jobs and the schedule are not)', () => {
  const not = MEASURES.find(measure => measure.id === 'not');
  assert.match(not.text, /decrypts your profile/);
  assert.match(not.text, /not encrypted with your key/);
  const all = [LEAD, ...MEASURES.map(measure => measure.text)].join(' ');
  assert.doesNotMatch(all, /everything is encrypted|all (of )?your data is encrypted/i);
});

test('claims the code does not support stay out: no receipt, no network guarantee, no time for the idle stop', () => {
  const all = MEASURES.map(measure => measure.text).join(' ');
  assert.doesNotMatch(all, /receipt/i);   // the app shows "Everything we held is deleted", not the Worker's counts
  assert.doesNotMatch(all, /Cloudflare/i);
  assert.doesNotMatch(all, /\b\d+ minutes? (idle|of)/i);
  assert.match(MEASURES.find(measure => measure.id === 'secret').text, /30 minutes/);   // RUN_TOKEN_MINUTES, the one number we state
});

test('the CV is not claimed: the app sends the profile and search settings, never the CV file (lib/hosted-search.js config: cv \'\')', () => {
  const all = [LEAD, ...MEASURES.map(measure => measure.title + ' ' + measure.text)].join(' ');
  assert.doesNotMatch(all, /\bCV\b/);
  assert.doesNotMatch(all, /delete everything/i);   // wipe() keeps the account (api/hosted-state.js), so "your data", not "everything"
  assert.doesNotMatch(MEASURES.find(measure => measure.id === 'nothing').text, /not in the container/);   // the container holds the decrypted profile during a search
});
