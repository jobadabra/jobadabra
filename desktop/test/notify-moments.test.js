// The pop-ups for an e-mail address that waits for its link (spec docs/superpowers/specs/2026-11-02-notify-moments-design.md): day 3, day 10 and the day-14 stop, each once, counted
// from the day the address was saved; never once a channel works; a changed address starts over. Guard for lib/notify-moments.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createNotifyMoments} from '../lib/notify-moments.js';

const DAY = 24 * 60 * 60 * 1000;
const SAVED = Date.parse('2026-11-02T09:00:00Z');
const pending = (extra = {}) => ({reached: true, by: ['email', 'app'], telegram: false, email: 'me@example.com', confirmed: false, serviceOff: false, unconfirmedStopped: false, sending: true, emailAt: new Date(SAVED).toISOString(), ...extra});
function world(settings = {}) {
  const kept = {setupDone: true, notifyEmailAt: new Date(SAVED).toISOString(), ...settings};
  const storage = {settings: () => kept, saveSettings: patch => Object.assign(kept, patch)};
  return {moments: createNotifyMoments(storage), kept};
}

test('before day 3 nothing; on day 3 the first reminder; on day 10 the second; the stop on day 14', () => {
  const {moments} = world();
  assert.equal(moments.next(pending(), SAVED + 2 * DAY), null, 'positive control: nothing yet');
  assert.equal(moments.next(pending(), SAVED + 3 * DAY)?.moment, 'day3');
  assert.equal(moments.next(pending(), SAVED + 10 * DAY)?.moment, 'day10');
  assert.equal(moments.next(pending({unconfirmedStopped: true}), SAVED + 15 * DAY)?.moment, 'stopped');
});

test('each moment opens once: shown is recorded, and a later moment still comes', () => {
  const {moments} = world();
  moments.shown('day3', SAVED + 3 * DAY);
  assert.equal(moments.next(pending(), SAVED + 4 * DAY), null);
  assert.equal(moments.next(pending(), SAVED + 10 * DAY)?.moment, 'day10');
});

test('the app opened first on day 11: only the day-10 reminder, and the day-3 one is not shown afterwards', () => {
  const {moments} = world();
  assert.equal(moments.next(pending(), SAVED + 11 * DAY)?.moment, 'day10');
  moments.shown('day10', SAVED + 11 * DAY);
  assert.equal(moments.next(pending(), SAVED + 12 * DAY), null, 'the stale day-3 words are skipped');
});

test('the words carry the real day and the address', () => {
  const {moments} = world();
  const day10 = moments.next(pending(), SAVED + 10 * DAY);
  assert.deepEqual([day10.days, day10.email], [10, 'me@example.com']);
});

test('a working channel (confirmed, or a connected bot), an unsubscribed address, no address: no pop-up', () => {
  const {moments} = world();
  const later = SAVED + 11 * DAY;
  assert.equal(moments.next(pending({confirmed: true}), later), null);
  assert.equal(moments.next(pending({telegram: true, by: ['email', 'telegram', 'app']}), later), null, 'the bot is a channel');
  assert.equal(moments.next(pending({serviceOff: true}), later), null);
  assert.equal(moments.next(pending({email: ''}), later), null);
  assert.equal(moments.next(pending(), later)?.moment, 'day10', 'positive control');
});

test('a new address starts the count and the once-only record over', () => {
  const {moments, kept} = world();
  moments.shown('day3', SAVED + 3 * DAY);
  const fresh = SAVED + 20 * DAY;
  kept.notifyEmailAt = new Date(fresh).toISOString();
  assert.equal(moments.next(pending({emailAt: kept.notifyEmailAt}), fresh + 3 * DAY)?.moment, 'day3');
});

test('no saved day (an address from before this version): no count, so no reminder; the card still shows', () => {
  const {moments} = world({notifyEmailAt: ''});
  assert.equal(moments.next(pending({emailAt: ''}), SAVED + 11 * DAY), null);
  assert.equal(moments.next(pending({emailAt: '', unconfirmedStopped: true}), SAVED + 11 * DAY)?.moment, 'stopped', 'the stop is the site\'s fact and needs no count');
});

test('never while setup is not done (the wizard stays AI, CV, Strategy; owner, 2 Nov 2026)', () => {
  const {moments} = world({setupDone: false});
  assert.equal(moments.next(pending(), SAVED + 11 * DAY), null);
  assert.equal(world().moments.next(pending(), SAVED + 11 * DAY)?.moment, 'day10', 'positive control');
});

test('the website did not answer (offline): nothing is shown on a guess about the confirmation', () => {
  assert.equal(world().moments.next(pending({reached: false}), SAVED + 11 * DAY), null);
});

// 2/2: the pop-ups for what waits for the person (an application) and for Full automation that nobody can be told about. Both offer the way to be told, so they need no address.
const nobody = (extra = {}) => ({reached: true, by: ['app'], telegram: false, email: '', confirmed: false, serviceOff: false, unconfirmedStopped: false, sending: null, emailAt: '', automation: false, ...extra});
const WAITED = {hours: 3, count: 2, title: 'Designer', company: 'Acme'};

test('an application that waited over an hour with no way to tell the person: the first moment, with the real hours and what waits; once', () => {
  const {moments} = world({notifyEmailAt: ''});
  assert.equal(moments.next(nobody(), SAVED, {waited: null}), null, 'positive control: nothing waits');
  const first = moments.next(nobody(), SAVED, {waited: WAITED});
  assert.deepEqual({moment: first.moment, hours: first.hours, count: first.count, title: first.title, company: first.company}, {moment: 'waited', ...WAITED});
  moments.shown('waited', SAVED);
  assert.equal(moments.next(nobody(), SAVED + DAY, {waited: WAITED}), null, 'once');
});

test('waited comes before an address reminder, and a reminder before channel-lost', () => {
  const {moments} = world();
  const state = pending({automation: true});
  assert.equal(moments.next(state, SAVED + 3 * DAY, {waited: WAITED}).moment, 'waited');
  moments.shown('waited', SAVED + 3 * DAY);
  assert.equal(moments.next(state, SAVED + 3 * DAY, {waited: WAITED}).moment, 'day3');
  moments.shown('day3', SAVED + 3 * DAY);
  assert.equal(moments.next(state, SAVED + 3 * DAY, {waited: WAITED}).moment, 'lost');
});

test('channel lost: only Full automation (on and confirmed) with nobody who can be told; once; never with a working channel, in setup or offline', () => {
  const {moments} = world();
  assert.equal(moments.next(nobody(), SAVED), null, 'automation off: nothing');
  const lost = moments.next(nobody({automation: true}), SAVED);
  assert.equal(lost?.moment, 'lost');
  assert.equal(moments.next(nobody({automation: true, by: ['email', 'app'], email: 'me@example.com', confirmed: true}), SAVED), null, 'a confirmed address is a working channel');
  assert.equal(moments.next(nobody({automation: true, reached: false}), SAVED), null, 'offline: nothing on a guess');
  assert.equal(world({setupDone: false}).moments.next(nobody({automation: true}), SAVED), null, 'never in setup');
  moments.shown('lost', SAVED);
  assert.equal(moments.next(nobody({automation: true}), SAVED + DAY), null, 'once');
});

test('the moments the window detects (match, reply, recruiter) are recorded once too, and a new address starts them over', () => {
  const {moments, kept} = world();
  for (const name of ['match', 'reply', 'recruiter']) moments.shown(name, SAVED);
  assert.deepEqual(Object.keys(moments.done()).sort(), ['match', 'recruiter', 'reply']);
  kept.notifyEmailAt = new Date(SAVED + DAY).toISOString();
  assert.deepEqual(moments.done(), {}, 'new address: void');
});

test('allowed: the one gate every pop-up shares (set up, the website answered, no working channel)', () => {
  const {moments} = world();
  assert.equal(moments.allowed(nobody()), true);
  assert.equal(moments.allowed(nobody({reached: false})), false);
  assert.equal(moments.allowed(pending({confirmed: true})), false, 'a confirmed address works');
  assert.equal(moments.allowed(null), false);
  assert.equal(world({setupDone: false}).moments.allowed(nobody()), false);
});
