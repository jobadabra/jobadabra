// "Can we reach you?" (spec docs/superpowers/specs/2026-11-02-notify-moments-design.md): ONE definition of a working channel, used by the card, the pop-ups and the Full automation and Always on gates.
// A confirmed e-mail address or a connected, chosen Telegram bot. An address that was typed but never confirmed is not one (the site sends it one mail a day, then holds it).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {offerCard, workingChannel} from '../renderer/notify-words.js';

const mail = (extra = {}) => ({by: ['email', 'app'], chosen: null, telegram: false, email: 'me@example.com', confirmed: true, sending: true, serviceOff: false, unconfirmedStopped: false, reached: true, ...extra});
const bot = (extra = {}) => ({by: ['telegram', 'app'], chosen: null, telegram: true, email: '', confirmed: false, sending: true, serviceOff: false, unconfirmedStopped: false, reached: true, ...extra});

test('a confirmed e-mail address works; the same address unconfirmed does not (positive control above, the owner\'s rule below)', () => {
  assert.equal(workingChannel(mail()), 'email');
  assert.equal(workingChannel(mail({confirmed: false})), '', 'typed but not confirmed: not a channel');
});

test('an address the person unsubscribed, the site stopped, or our sender being off is not a channel either', () => {
  assert.equal(workingChannel(mail({serviceOff: true})), '');
  assert.equal(workingChannel(mail({confirmed: false, unconfirmedStopped: true})), '');
  assert.equal(workingChannel(mail({sending: false})), '');
});

test('a connected Telegram bot that is among the chosen channels works; a bot the person did not choose does not', () => {
  assert.equal(workingChannel(bot()), 'telegram');
  assert.equal(workingChannel(bot({by: ['app'], chosen: ['app']})), '', 'connected but not chosen: only the app shows it');
  assert.equal(workingChannel(bot({telegram: false, by: ['app']})), '', 'chosen, then the bot was lost');
});

test('an unconfirmed address plus a Telegram bot: the bot is the channel', () => {
  assert.equal(workingChannel(mail({confirmed: false, by: ['email', 'telegram', 'app'], telegram: true})), 'telegram');
});

test('no state at all (the website was not asked yet) says nothing works, and the card is not drawn from that', () => {
  assert.equal(workingChannel(null), '');
  assert.equal(offerCard(null), null);
});

test('the card has one state per fact: nothing yet, check your inbox, mail stopped, unsubscribed; none once a channel works', () => {
  assert.equal(offerCard(mail()), null);
  assert.equal(offerCard(bot()), null);
  assert.deepEqual(offerCard(mail({email: '', confirmed: false, by: ['app']})).state, 'none');
  const pending = offerCard(mail({confirmed: false}));
  assert.equal(pending.state, 'pending');
  assert.match(pending.detail, /me@example\.com/);
  assert.equal(pending.resend, true, 'a lost confirm mail can be sent again');
  const stopped = offerCard(mail({confirmed: false, unconfirmedStopped: true}));
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.resend, true);
  const unsubscribed = offerCard(mail({serviceOff: true}));
  assert.equal(unsubscribed.state, 'unsubscribed');
  assert.equal(unsubscribed.resend, false, 'the person stopped the mails themselves: only their own link in one of our e-mails turns them on');
});

test('every card state says what is true: nothing is sent until the link is pressed', () => {
  assert.match(offerCard(mail({confirmed: false})).title, /Check your inbox/);
  assert.match(offerCard(mail({confirmed: false})).detail, /Nothing is sent until you press/);
  assert.doesNotMatch(JSON.stringify(offerCard(mail({email: '', confirmed: false, by: ['app']}))), /interview/i, 'the first card promises only what is sent today');
});

test('the reminder pop-ups say the real day count and address, and day 14 is when the site stops', async () => {
  const {momentWords} = await import('../renderer/notify-words.js');
  assert.match(momentWords({moment: 'day3', days: 3, email: 'me@example.com'}).body, /me@example\.com 3 days ago/);
  assert.match(momentWords({moment: 'day10', days: 11, email: 'me@example.com'}).body, /waited 11 days.*day 14/);
  assert.match(momentWords({moment: 'stopped', days: 14, email: 'me@example.com'}).title, /Mail stopped/);
  for (const moment of ['day3', 'day10', 'stopped']) assert.doesNotMatch(JSON.stringify(momentWords({moment, days: 5, email: 'a@b.co'})), /interview/i, 'only what is sent today');
});

test('Full automation asks for a channel only when none was given: an address (even unconfirmed) or a connected bot is enough, an unreadable state asks nothing', async () => {
  const {automationNeedsChannel} = await import('../renderer/notify-words.js');
  assert.equal(automationNeedsChannel(mail({email: '', confirmed: false, by: ['app']})), true, 'nothing given: asked');
  assert.equal(automationNeedsChannel(mail({confirmed: false})), false, 'typed, link not pressed yet: given');
  assert.equal(automationNeedsChannel(bot()), false);
  assert.equal(automationNeedsChannel(bot({by: ['app'], telegram: true})), true, 'a bot that is not chosen tells nobody');
  assert.equal(automationNeedsChannel(null), false, 'no state: no gate on a guess');
  assert.equal(automationNeedsChannel(mail({email: '', confirmed: false, by: ['app'], reached: false})), false, 'the website did not answer (offline, no install key, a test app): no gate');
});

test('offline: no card', () => {
  assert.equal(offerCard(mail({confirmed: false, reached: false})), null);
});
