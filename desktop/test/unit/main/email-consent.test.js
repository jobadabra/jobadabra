// E-mail consent (lib/email-consent.js, lib/notify-channel.js; owner, 5 Nov 2026: "we shouldn't start sending him email right away. We should still get the user consent"):
// the CV's address is offered and fills forms, but nothing reaches the site or a mailbox until the person ticks the line; the tick is stored with the date and its exact sentence;
// the switch starts ON (owner, 5 Nov 2026: "Let it be on by default") and only Continue with it on sends; each place asks once. Fictional addresses only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {LINE} from '../../../renderer/email-consent-words.js';
import {asked, clear, consentOf, consented, record, shouldAsk} from '../../../lib/email-consent.js';
import {cvAddress, view} from '../../../lib/email-from-cv.js';
import {addressToSave, atContinue, startsOn} from '../../../renderer/email-consent-choice.js';
import {registerNotifyHandlers} from '../../../lib/notify-handlers.js';
import {NO_ADDRESS, turnOnShared} from '../../../lib/hosted-email.js';
import {channelsOf, notifyEnv, save, sendEmail} from '../../../lib/notify-channel.js';

const storage = ({settings = {}, links = [], secrets = {JOBADABRA_TRIAL_KEY: 'JPF1.install-0001.tok'}} = {}) => {
  const kept = {...settings}, root = fs.mkdtempSync(path.join(os.tmpdir(), 'consent-'));
  if (links.length) { fs.mkdirSync(path.join(root, 'cv'), {recursive: true}); fs.writeFileSync(path.join(root, 'cv', 'cv.json'), JSON.stringify({links})); }
  return {settings: () => kept, saveSettings: patch => Object.assign(kept, patch), secret: name => secrets[name] || '', path: (...parts) => path.join(root, ...parts)};
};
const CV = [{text: 'Alex', href: 'mailto:alex.example@example.com'}, {text: 'site', href: 'https://example.com/alex'}];
const site = (asked = []) => async (url, init) => { asked.push({url, method: init?.method, body: init?.body ? JSON.parse(init.body) : null}); return {json: async () => ({ok: true})}; };

test('the CV address is read and offered, never stored as the notification address', async () => {
  const kept = storage({links: CV});
  assert.equal(await cvAddress(kept), 'alex.example@example.com');
  assert.deepEqual(await view(kept), {address: 'alex.example@example.com', consented: false, wording: LINE, askCv: true, askAlwaysOn: true});
  assert.equal(kept.settings().notifyEmail, undefined);
  assert.equal(await cvAddress(storage()), '', 'no CV address: the line does not show');
});

test('without consent nothing is sent: no channel, no engine key, no call to the site', async () => {
  const kept = storage({links: CV}), calls = [];
  assert.deepEqual(channelsOf(kept), ['app']);
  assert.deepEqual(notifyEnv(kept), {JOBADABRA_NOTIFY: 'app'});
  assert.equal(await sendEmail(kept, {subject: 's', text: 't'}, site(calls)), false);
  assert.deepEqual(calls, []);
});

test('ticking stores the date and the exact sentence, once the site took the address', async () => {
  const kept = storage({links: CV}), calls = [], now = new Date('2026-11-05T10:00:00Z');
  assert.deepEqual(await save(kept, {by: ['email', 'app'], email: await cvAddress(kept), consentVia: 'cv', consentGiven: 'default'}, site(calls), now), {ok: true});
  assert.equal(calls[0].body.email, 'alex.example@example.com');
  assert.deepEqual(kept.settings().emailConsent, {at: '2026-11-05T10:00:00.000Z', wording: LINE, where: 'cv', given: 'default'});
  assert.ok(consented(kept) && channelsOf(kept).includes('email'));
  const refused = storage({links: CV});
  await save(refused, {by: ['email'], email: 'alex.example@example.com'}, async () => ({json: async () => ({ok: false, error: 'taken'})}), now);
  assert.equal(refused.settings().emailConsent, undefined, 'a refused address stores no consent');
  assert.equal(consented(refused), false);
});

test('an address typed in Settings before consent existed counts as consented; unticking e-mail withdraws it for good', async () => {
  const legacy = storage({settings: {notifyEmail: 'old.example@example.com', notifyEmailAt: '2026-10-01T00:00:00.000Z'}});
  assert.equal(consented(legacy), true);
  assert.equal(consentOf(legacy).where, 'settings');
  await save(legacy, {by: ['app']}, site());
  assert.equal(consented(legacy), false, 'withdrawn: the old address does not count again');
  assert.deepEqual(channelsOf(legacy), ['app']);
  record(legacy, 'settings');
  assert.equal(consented(legacy), true);
  clear(legacy);
  assert.equal(consented(legacy), false);
});

test('each place asks once: the CV step, then Always on, then never; a consent ends all asking', () => {
  const kept = storage();
  assert.ok(shouldAsk(kept, 'cv') && shouldAsk(kept, 'alwaysOn'));
  asked(kept, 'cv', new Date('2026-11-05T10:00:00Z'));
  assert.ok(!shouldAsk(kept, 'cv') && shouldAsk(kept, 'alwaysOn'));
  asked(kept, 'alwaysOn');
  assert.ok(!shouldAsk(kept, 'alwaysOn'));
  assert.equal(shouldAsk(storage({settings: {emailConsent: {at: 'x', wording: LINE, where: 'cv'}}}), 'cv'), false);
  assert.equal(shouldAsk(kept, 'elsewhere'), false);
});

test('the switch starts on when the CV has an address; Continue with it on gives the consent, telling "left on" from "turned on"', async () => {
  const kept = storage({links: CV});
  assert.equal(startsOn(await view(kept)), true);
  assert.equal(startsOn(await view(storage())), false, 'no address: nothing to switch on');
  assert.equal(startsOn({address: 'a@example.com', consented: true}), false, 'already given: nothing to ask');
  assert.deepEqual(atContinue({on: true, touched: false}), {give: {given: 'default'}});
  assert.deepEqual(atContinue({on: true, touched: true}), {give: {given: 'switched'}});
  const calls = [];
  await save(kept, {by: ['email', 'app'], email: await cvAddress(kept), consentVia: 'cv', consentGiven: 'switched'}, site(calls));
  assert.equal(kept.settings().emailConsent.given, 'switched');
  record(kept, 'cv', LINE, new Date('2026-11-05T10:00:00Z'), 'nonsense');
  assert.equal(kept.settings().emailConsent.given, 'switched', 'an unknown way reads as an explicit act, never as a default');
});

// Why (5 Nov 2026, #3282): Settings saves on every switch, so only e-mail going from on to off is a withdrawal.
test('a Settings save that leaves e-mail off withdraws nothing: only turning it off does', async () => {
  const fresh = storage({links: CV});
  await save(fresh, {by: ['app', 'telegram']}, site());
  assert.equal(fresh.settings().emailConsent, undefined, 'never asked: nothing to withdraw');
  assert.ok(shouldAsk(fresh, 'cv') && shouldAsk(fresh, 'alwaysOn'), 'still asked in both places');

  const given = {at: '2026-11-05T10:00:00.000Z', wording: LINE, where: 'alwaysOn', given: 'switched'};
  const off = storage({settings: {emailConsent: given, notifyEmail: 'alex.example@example.com', notifyBy: ['app']}});
  await save(off, {by: ['app', 'telegram']}, site());
  assert.deepEqual(off.settings().emailConsent, given, 'e-mail was already off: another switch does not touch the consent');

  const on = storage({settings: {emailConsent: given, notifyEmail: 'alex.example@example.com', notifyBy: ['email', 'app']}});
  await save(on, {by: ['app']}, site());
  assert.equal(on.settings().emailConsent, null, 'turned off: withdrawn');
});

test('turned off before Continue: nothing reaches the site or a mailbox, and the step counts as asked', async () => {
  const kept = storage({links: CV}), calls = [];
  const answer = atContinue({on: false, touched: true});
  assert.deepEqual(answer, {asked: true});
  asked(kept, 'cv');
  assert.equal(await sendEmail(kept, {subject: 's', text: 't'}, site(calls)), false);
  assert.deepEqual(calls, []);
  assert.equal(kept.settings().notifyEmail, undefined);
  assert.equal(kept.settings().emailConsent, undefined);
  assert.equal(shouldAsk(kept, 'cv'), false);
  assert.equal(shouldAsk(kept, 'alwaysOn'), true, 'Always on asks once more');
});

// The owner's scenario through the real IPC handlers (lib/notify-handlers.js): the CV step's Continue with the switch left on, and with it turned off.
const handlersOn = kept => {
  const handlers = {};
  registerNotifyHandlers({ipcMain: {handle: (name, run) => { handlers[name] = run; }}, storage: kept, DEMO: false, log: () => {}});
  return (name, arg) => handlers[name]({}, arg);
};
const withFetch = async (calls, run) => {
  const before = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : null}); return {json: async () => ({ok: true})}; };
  try { return await run(); } finally { globalThis.fetch = before; }
};

test('Continue with the switch left on: the CV address goes to the site once, with no product news, and the consent says "default"', async () => {
  const kept = storage({links: CV}), calls = [], call = handlersOn(kept);
  assert.equal((await call('emailConsentView')).askCv, true);
  const done = await withFetch(calls, () => call('emailConsentGive', {where: 'cv', given: 'default'}));
  assert.deepEqual(done, {ok: true});
  const puts = calls.filter(item => item.url.endsWith('/api/account/email') && item.method === 'PUT');
  assert.equal(puts.length, 1);
  assert.equal(puts[0].body.email, 'alex.example@example.com');
  assert.equal(puts[0].body.marketing, false, 'the switch asks for "only when something needs you": never the product news');
  assert.equal(kept.settings().emailConsent.given, 'default');
  assert.equal(kept.settings().emailConsent.where, 'cv');
});

test('Continue with the switch turned off: nothing reaches the site, and a withdrawn consent is never offered again', async () => {
  const kept = storage({links: CV}), calls = [], call = handlersOn(kept);
  await withFetch(calls, () => call('emailConsentAsked', 'cv'));
  assert.deepEqual(calls, []);
  assert.equal(kept.settings().notifyEmail, undefined);
  const withdrawn = storage({links: CV, settings: {emailConsent: null, notifyEmail: 'alex.example@example.com'}});
  assert.equal(shouldAsk(withdrawn, 'cv') || shouldAsk(withdrawn, 'alwaysOn'), false);
  assert.equal(await withFetch(calls, () => handlersOn(withdrawn)('emailConsentGive', {where: 'nowhere'})).then(answer => answer.ok), false, 'an unknown place is refused');
  assert.deepEqual(calls, []);
});

test('Settings sends the CV address only when e-mail is switched on: another switch saving never carries it', () => {
  assert.equal(addressToSave({typed: '', offered: 'alex.example@example.com', by: ['app', 'telegram']}), '');
  assert.equal(addressToSave({typed: '', offered: 'alex.example@example.com', by: ['email', 'app']}), 'alex.example@example.com');
  assert.equal(addressToSave({typed: ' typed.example@example.com ', offered: 'alex.example@example.com', by: ['app']}), 'typed.example@example.com');
});

test('Always on never uses an address whose consent was withdrawn: the person adds one in Notifications', async () => {
  const withdrawn = storage({settings: {emailConsent: null, notifyEmail: 'alex.example@example.com'}});
  let asked = 0;
  const done = await turnOnShared(withdrawn, {}, {turnOn: async () => { asked += 1; return {ok: true}; }});
  assert.deepEqual(done, {ok: false, error: NO_ADDRESS});
  assert.equal(asked, 0);
});
