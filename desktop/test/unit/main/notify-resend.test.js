// Resend the confirm mail (site: jobadabra-web POST /api/account/email/resend, #333) and the date the address was first saved (the day 3 / 10 / 14 reminders count from it).
// Spec docs/superpowers/specs/2026-11-02-notify-moments-design.md. The site refuses with a code; the person is told in words, never the code.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SLOW_MS, resend, save, state} from '../../../lib/notify-channel.js';

const storage = ({settings = {}, secrets = {JOBADABRA_TRIAL_KEY: 'JPF1.install-0001.tok'}} = {}) => {
  const kept = {...settings};
  return {settings: () => kept, saveSettings: patch => Object.assign(kept, patch), secret: name => secrets[name] || ''};
};
const site = (answers, asked = []) => async (url, init) => { asked.push({url, method: init?.method, key: init?.headers['x-api-key']}); const answer = answers.shift(); if (answer instanceof Error) throw answer; return {json: async () => answer}; };

test('Resend asks the site with the install key and tells the person it was sent', async () => {
  const asked = [];
  const done = await resend(storage({settings: {notifyEmail: 'me@example.com'}}), site([{ok: true}], asked));
  assert.equal(done.ok, true);
  assert.deepEqual([asked[0].method, asked[0].url.endsWith('/api/account/email/resend'), asked[0].key], ['POST', true, 'JPF1.install-0001.tok']);
});

test('every refusal the site can give is said in words, with its code kept for the caller', async () => {
  const say = async code => resend(storage({settings: {notifyEmail: 'me@example.com'}}), site([{ok: false, error: code}]));
  const wait = await say('wait');
  assert.match(wait.error, /hour/);
  assert.equal(wait.code, 'wait');
  assert.match((await say('confirmed')).error, /already confirmed/);
  assert.match((await say('stopped')).error, /Email settings/);
  assert.match((await say('no_address')).error, /Add your e-mail/);
  assert.match((await say('off')).error, /switched off/);
  assert.match((await say('not_sent')).error, /Try again/);
  for (const code of ['wait', 'confirmed', 'stopped', 'no_address', 'off', 'not_sent']) assert.notEqual((await say(code)).error, code, `the code ${code} is not shown as the message`);
});

test('no address on this Mac: nothing is asked of the site', async () => {
  const asked = [];
  const done = await resend(storage(), site([{ok: true}], asked));
  assert.equal(done.ok, false);
  assert.deepEqual(asked, []);
});

test('offline: said, not thrown', async () => {
  const done = await resend(storage({settings: {notifyEmail: 'me@example.com'}}), site([new Error('offline')]));
  assert.equal(done.ok, false);
  assert.match(done.error, /could not be reached/);
});

test('the day an address was first saved is kept once: a changed address starts the count again, the same address again does not', async () => {
  const kept = storage();
  const day = new Date('2026-11-02T09:00:00Z');
  await save(kept, {by: ['email'], email: 'me@example.com'}, site([{ok: true}]), day);
  assert.equal(kept.settings().notifyEmailAt, day.toISOString());
  await save(kept, {by: ['email'], email: 'me@example.com', cadence: 'weekly'}, site([{ok: true}]), new Date('2026-11-09T09:00:00Z'));
  assert.equal(kept.settings().notifyEmailAt, day.toISOString(), 'the same address: the day stands');
  await save(kept, {by: ['email'], email: 'other@example.com'}, site([{ok: true}]), new Date('2026-11-10T09:00:00Z'));
  assert.equal(kept.settings().notifyEmailAt, '2026-11-10T09:00:00.000Z');
});

test('the state hands the window the day the address was saved', async () => {
  const kept = storage({settings: {notifyEmail: 'me@example.com', notifyEmailAt: '2026-11-02T09:00:00.000Z'}});
  const answer = await state(kept, site([{ok: true, email: 'me@example.com', confirmed: false}]));
  assert.equal(answer.emailAt, '2026-11-02T09:00:00.000Z');
});

// 2/2: the "nothing can reach you" pop-up is only for Full automation, which the person turned on and confirmed (apply.autoConfirmedAt): Auto without the confirmation does not submit, so nothing waits.
test('the state says whether Full automation is on: the mode AND its confirmation', async () => {
  const answerFor = async apply => (await state(storage({settings: {apply}}), site([{ok: true}]))).automation;
  assert.equal(await answerFor({mode: 'auto', autoConfirmedAt: '2026-11-01T09:00:00Z'}), true, 'positive control');
  assert.equal(await answerFor({mode: 'auto'}), false, 'no confirmation');
  assert.equal(await answerFor({mode: 'hybrid', autoConfirmedAt: '2026-11-01T09:00:00Z'}), false, 'another mode');
  assert.equal(await answerFor(undefined), false);
});

// Gitar on #3011: the website call had no time limit, so a hanging connection kept Full automation's confirmation from opening. A call that is not answered in time ends as "not reached".
test('a website call that never answers ends after its time limit as not reached, so nothing waits on it', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const pending = state(storage({settings: {notifyEmail: 'me@example.com'}}), hang);
  t.mock.timers.tick(SLOW_MS);
  const answer = await pending;
  assert.equal(answer.reached, false);
  assert.equal(answer.email, 'me@example.com', 'the address this Mac knows is still shown');
});

test('the answer that comes in time is used (positive control for the limit)', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const answer = await state(storage({settings: {notifyEmail: 'me@example.com'}}), site([{ok: true, email: 'me@example.com', confirmed: true}]));
  assert.equal(answer.reached, true);
  assert.equal(answer.confirmed, true);
});
