// The notification card (spec docs/superpowers/specs/2026-11-02-notify-moments-design.md): always present on Focus and Jobs while no channel works (the Always on card's pattern),
// with the buttons of the address's state; Not now hides it 14 days; gone the moment a channel works. Pure: the page draws it (pages/focus-suggestions.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {jobsEntries} from '../renderer/suggestions.js';
import {KEY, notifyEntries, saveChoice} from '../renderer/notify-suggestion.js';

const none = {reached: true, by: ['app'], chosen: null, telegram: false, email: '', confirmed: false, sending: true, serviceOff: false, unconfirmedStopped: false};
const pending = {...none, by: ['email', 'app'], email: 'me@example.com'};
const working = {...pending, confirmed: true};

test('no channel yet: one card, on Focus and on Jobs, with an e-mail field\'s button and Telegram', () => {
  const [entry, ...rest] = notifyEntries({state: none});
  assert.equal(rest.length, 0);
  assert.equal(entry.kind, 'notify');
  assert.equal(entry.key, KEY);
  assert.deepEqual(entry.actions.map(action => action.do), ['add_email', 'open_notifications']);
  assert.equal(entry.alsoJobs, true);
  assert.equal(jobsEntries([entry]).length, 1, 'the Jobs bar shows it too');
  assert.deepEqual(entry.answers, ['Not now'], 'Not now only: it is never "not true"');
});

test('an address waiting for its link: Resend, and the words say check your inbox', () => {
  const [entry] = notifyEntries({state: pending});
  assert.match(entry.title, /Check your inbox/);
  assert.deepEqual(entry.actions.map(action => action.do), ['resend_confirm', 'open_notifications']);
});

test('mail stopped: Resend; unsubscribed: no Resend, only the way to Notifications', () => {
  assert.deepEqual(notifyEntries({state: {...pending, unconfirmedStopped: true}})[0].actions.map(action => action.do), ['resend_confirm', 'open_notifications']);
  assert.deepEqual(notifyEntries({state: {...working, serviceOff: true}})[0].actions.map(action => action.do), ['open_notifications']);
});

test('a working channel, a state not read yet, Not now (held now or hidden for 14 days): no card', () => {
  assert.deepEqual(notifyEntries({state: working}), []);
  assert.deepEqual(notifyEntries({state: null}), []);
  assert.deepEqual(notifyEntries({state: none, held: new Set([KEY])}), []);
  assert.deepEqual(notifyEntries({state: none, hidden: new Set([KEY])}), []);
  assert.equal(notifyEntries({state: none}).length, 1, 'positive control');
});

test('the e-mail the card saves keeps what the person already chose and adds e-mail', () => {
  assert.deepEqual(saveChoice(none, 'me@example.com'), {by: ['app', 'email'], email: 'me@example.com'});
  assert.deepEqual(saveChoice({...none, chosen: ['telegram', 'app']}, 'me@example.com'), {by: ['telegram', 'app', 'email'], email: 'me@example.com'});
  assert.deepEqual(saveChoice({...none, chosen: ['email', 'app']}, 'me@example.com').by, ['email', 'app'], 'no duplicate');
});

test('offline (the website did not answer): no card on a guess', () => {
  assert.deepEqual(notifyEntries({state: {...none, reached: false}}), []);
});
