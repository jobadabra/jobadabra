// The words of the four moment pop-ups and channel-lost (spec docs/superpowers/specs/2026-11-02-notify-moments-design.md, 2/2). Every claim is a delivery fact of today: matches = one e-mail per
// run or the Telegram digest; interview invites at once; other Gmail results in the daily digest; a recruiter reminder on Telegram at once, by e-mail in the digest; never the word "reply" for Gmail.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {momentWords, offerCard} from '../renderer/notify-words.js';

const none = {by: ['app'], telegram: false, email: '', confirmed: false, reached: true};
const pending = {...none, by: ['email', 'app'], email: 'me@example.com'};
const unsubscribed = {...pending, serviceOff: true};

test('waited: the real hours and what waits, one application named, several counted; it offers the way to be told', () => {
  const one = momentWords({moment: 'waited', hours: 3, count: 1, title: 'Designer', company: 'Acme'}, none);
  assert.match(one.title, /waited 3 hours/);
  assert.match(one.body, /Designer at Acme/);
  const many = momentWords({moment: 'waited', hours: 1, count: 4, title: 'Designer', company: 'Acme'}, none);
  assert.match(many.title, /4 applications/);
  assert.match(many.title, /1 hour\b/, 'singular hour');
  assert.equal(one.ask, 'email');
});

test('match: the fit and when the check ran; Gmail: "N updates", never "reply"; recruiter: Telegram at once, e-mail in the digest, no day count', () => {
  const match = momentWords({moment: 'match', fit: 91, title: 'Designer', company: 'Acme', endedAt: '2026-11-02T03:10:00Z'}, none);
  assert.match(match.title, /91% match/);
  assert.match(match.body, /Designer at Acme/);
  assert.match(match.body, /check/);
  const updates = momentWords({moment: 'reply', count: 2}, none);
  assert.match(updates.title, /2 application updates/);
  assert.match(updates.body, /interview invite.*at once.*digest/i);
  assert.doesNotMatch(JSON.stringify(updates), /repl(y|ies)/i, 'the check cannot tell a reply from a status change');
  assert.match(momentWords({moment: 'reply', count: 1}, none).title, /1 application update\b/);
  const recruiter = momentWords({moment: 'recruiter', count: 1, company: 'Acme'}, none);
  assert.match(recruiter.body, /Telegram.*at once/);
  assert.match(recruiter.body, /e-mail.*digest/i);
  assert.doesNotMatch(JSON.stringify(recruiter), /\bdays?\b/, 'no day count: the reminder has none');
});

test('lost: Full automation stays on and the pop-up says so; the card says the same', () => {
  const lost = momentWords({moment: 'lost'}, none);
  assert.match(lost.title, /Nothing can reach you/);
  assert.match(lost.body, /Full automation is on/);
  assert.match(lost.body, /keeps running/);
  assert.doesNotMatch(lost.body, /turned off|switched off|stopped/i, 'it is never switched off in silence or otherwise');
  assert.match(offerCard({...none, automation: true}).detail, /Full automation keeps running/);
  assert.doesNotMatch(offerCard(none).detail, /Full automation/, 'without automation the card is unchanged');
});

test('the control follows the state: no address -> the e-mail field; waiting or stopped -> send again; unsubscribed -> Notifications', () => {
  const ask = state => momentWords({moment: 'waited', hours: 2, count: 1, title: 'A', company: 'B'}, state);
  assert.deepEqual([ask(none).ask, ask(none).go], ['email', 'Send me the link']);
  assert.deepEqual([ask(pending).ask, ask(pending).go], ['resend', 'Send the link again']);
  assert.deepEqual([ask(unsubscribed).ask, ask(unsubscribed).go], ['notifications', 'Open Notifications']);
  assert.equal(momentWords({moment: 'day3', days: 3, email: 'me@example.com'}, pending).ask, 'resend');
});
