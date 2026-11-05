// The live step log of an application (owner, 5 Nov 2026: "We should have live update log … so that the user gets a good sense even without live preview"): what happened,
// when, in order. The app's real order (startForm, the controller, page marks, fill reports, a hand-over) is played by session-journal-run.test.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as journal from '../../../lib/session-journal.js';

const T0 = Date.parse('2026-11-05T10:00:00Z');

test('steps come back in order with their time; a repeated line is said once; a keyed line (the fill count) moves forward in place', () => {
  journal._reset();
  journal.start('s1', 'fill', T0);
  journal.note('s1', {text: 'Opening the job page', at: T0 + 100});
  journal.note('s1', {text: 'Opening the job page', at: T0 + 500});
  journal.note('s1', {key: 'fill', text: 'Filling the form: 2 of 9 required fields', at: T0 + 1000});
  journal.note('s1', {key: 'fill', text: 'Filling the form: 6 of 9 required fields', at: T0 + 2000});
  journal.note('s1', {text: 'Sign-in page', at: T0 + 3000});
  journal.note('s1', {key: 'fill', text: 'Filling the form: 1 of 4 required fields', at: T0 + 4000});
  assert.deepEqual(journal.journalOf('s1').map(step => [step.text, step.at - T0]), [['Started in Jobadabra\'s browser · Background automation', 0], ['Opening the job page', 100],
    ['Filling the form: 6 of 9 required fields', 2000], ['Sign-in page', 3000], ['Filling the form: 1 of 4 required fields', 4000]]);
  assert.deepEqual(journal.journalOf('other'), []);
});

test('a warning keeps its tone; a long run keeps only its latest steps; a removed session forgets its log; a new start begins a new log', () => {
  journal._reset();
  journal.start('s1', 'fill', T0);
  journal.note('s1', {text: 'Handed to you: a bot check', tone: 'warn', at: T0});
  assert.equal(journal.journalOf('s1')[1].tone, 'warn');
  for (let i = 0; i < 100; i++) journal.note('s1', {text: `step ${i}`, at: T0 + i});
  assert.equal(journal.journalOf('s1').length, journal.KEEP);
  assert.equal(journal.journalOf('s1').at(-1).text, 'step 99');
  journal.start('s1', 'fill', T0 + 200);
  assert.deepEqual(journal.journalOf('s1').map(step => step.text), ['Started in Jobadabra\'s browser · Background automation']);
  journal.forget('s1');
  assert.deepEqual(journal.journalOf('s1'), []);
});

test('the window is told once per burst, not once per step (ten forms report many times a second)', () => {
  journal._reset();
  let told = 0;
  const timers = [];
  journal.onChange(() => told++, {later: (fn, ms) => timers.push([fn, ms])});
  journal.start('s1', 'fill', T0);
  journal.start('s2', 'fill', T0);
  for (let i = 0; i < 5; i++) journal.note('s1', {key: 'fill', text: `Filling the form: ${i} of 9 required fields`, at: T0 + i});
  assert.equal(timers.length, 1, 'one pending tell for every session');
  timers[0][0]();
  assert.equal(told, 1);
  journal.note('s1', {text: 'All 9 required fields filled', at: T0 + 10});
  assert.equal(timers.length, 2, 'a later step is told again');
});

test('each background state has its words; a hand-over says its reason in amber; an unknown state says its record\'s note', () => {
  assert.deepEqual(journal.backgroundStep('queued'), {text: 'Waiting for its turn', tone: 'done'});
  assert.deepEqual(journal.backgroundStep('receipt_confirmed'), {text: 'The site confirmed the application', tone: 'done'});
  assert.deepEqual(journal.backgroundStep('needs_user_handoff', 'This application stopped at a CAPTCHA.'), {text: 'Handed to you: This application stopped at a CAPTCHA.', tone: 'warn'});
  assert.deepEqual(journal.backgroundStep('a_later_state', 'Filling in the background'), {text: 'Filling in the background', tone: 'done'});
});

test('the record writes its stuck reason once in amber and the submit; a Stop is left to the hand-over that follows it', () => {
  journal._reset();
  journal.start('b1', 'auto', T0);
  const view = {id: 'b1', kind: 'form', background: {mode: 'auto', state: 'filling'}};
  journal.observe({...view, stuck: 'no-form', note: 'No application form found on the page yet'}, T0 + 5);
  journal.observe({...view, stuck: 'no-form', note: 'No application form found on the page yet'}, T0 + 6);
  journal.observe({...view, stuck: 'stopped', note: 'Stopped by you'}, T0 + 7);
  journal.observe({...view, outcome: 'submitted'}, T0 + 8);
  assert.deepEqual(journal.journalOf('b1').slice(1).map(step => [step.text, step.tone]), [['No application form found on the page yet', 'warn'], ['Submitted · marked Applied', 'done']]);
});

test('a note for no session, or with no words, changes nothing', () => {
  journal._reset();
  journal.start('s1', 'fill', T0);
  journal.note('', {text: 'x', at: T0});
  journal.note('s1', {text: '', at: T0});
  assert.deepEqual(journal.journalOf(''), []);
  assert.equal(journal.journalOf('s1').length, 1);
});
