// Delivery metadata follows the saved language, preserves consent and retries unacknowledged cache refreshes on normal events.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {notifyEnv, save, sendEmail, refreshLanguage, resend} from '../../../lib/notify-channel.js';
import {createPlan} from '../../../lib/plan.js';

function store(language = 'ru') {
  const settings = {displayLanguage: language, notifyEmail: 'fictional@example.test', notifyBy: ['email']};
  return {settings: () => settings, saveSettings: values => Object.assign(settings, values), secret: key => key === 'JOBADABRA_TRIAL_KEY' ? 'JPF1.fictional.fake' : ''};
}
const answer = value => ({json: async () => value});

test('a linked own-key install refreshes account language without a notification address or new credentials', async () => {
  const settings = {displayLanguage: 'ru', telemetryId: 'fictional', siteTokens: {ai: {install: 'fictional', value: 'kept-token'}}};
  const requests = [], storage = {settings: () => settings, secret: () => '', saveSettings: () => assert.fail('metadata must not change preferences')};
  assert.equal((await refreshLanguage(storage, async (url, init) => {
    requests.push({url, init}); return answer({ok: true, language: 'ru'});
  })).ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.headers['x-api-key'], 'JPF1.fictional.kept-token');
  assert.deepEqual(JSON.parse(requests[0].init.body), {language: 'ru'});
});

test('sign-in code and immediate confirmation resend use the current trusted preference', async () => {
  const storage = store('ro'), requests = [];
  const fetcher = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null; requests.push({url, body});
    if (url.endsWith('/install-token')) return Response.json({ok: true, token: 'fake-token'});
    return Response.json({ok: true});
  };
  const plan = createPlan(storage, {fetcher});
  assert.equal((await plan.signin('start', {email: 'raw@example.test', language: 'de'})).ok, true);
  assert.equal(requests.find(request => request.url.endsWith('/signin/start')).body.language, 'ro', 'renderer payload cannot override the saved preference');
  storage.settings().displayLanguage = 'ru';
  await resend(storage, fetcher);
  assert.deepEqual(requests.find(request => request.url.endsWith('/email/resend')).body, {language: 'ru'});
});

test('only successful code verification refreshes the linked account even when that language was previously acknowledged', async () => {
  const settings = {displayLanguage: 'it', telemetryId: 'fixture-link', siteTokens: {ai: {install: 'fixture-link', value: 'kept'}}};
  const storage = {settings: () => settings, secret: () => '', saveSettings: values => Object.assign(settings, values)}, calls = [];
  let verified = false;
  const fetcher = async (url, init = {}) => {
    calls.push(new URL(url).pathname);
    if (url.endsWith('/signin/verify')) return Response.json({ok: verified}, {status: verified ? 200 : 400});
    return Response.json({ok: true, language: 'it', plan: 'pro'});
  };
  await refreshLanguage(storage, fetcher);
  const plan = createPlan(storage, {fetcher});
  await plan.signin('verify', {email: 'fixture@example.test', code: 'wrong'});
  assert.equal(calls.filter(call => call === '/api/account/language').length, 1, 'wrong codes must not refresh another account');
  verified = true;
  await plan.signin('verify', {email: 'fixture@example.test', code: '123456'});
  await refreshLanguage(storage, fetcher);
  assert.equal(calls.filter(call => call === '/api/account/language').length, 2, 'successful linking invalidates the old account acknowledgement');
  assert.equal(settings.notifyEmail, undefined);
});

test('engine and first-registration metadata preserve channels and consent while adding resolved language', async () => {
  const storage = store();
  assert.deepEqual(notifyEnv(storage), {JOBADABRA_NOTIFY: 'email', JOBADABRA_TRIAL_KEY: 'JPF1.fictional.fake', JOBADABRA_NOTIFICATION_LANGUAGE: 'ru'});
  const requests = [];
  await save(storage, {by: ['email'], email: 'changed@example.test'}, async (url, init) => {
    requests.push({url, body: JSON.parse(init.body)}); return answer({ok: true});
  });
  assert.equal(requests[0].body.language, 'ru');
  assert.equal(requests[0].body.email, 'changed@example.test');
  assert.equal(storage.settings().emailConsent.given, 'switched');
});

test('outbound body receives explicit language and raw content stays unchanged', async () => {
  const storage = store('de'), requests = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body); requests.push({url, body});
    return answer(url.endsWith('/language') ? {ok: true, language: body.language} : {ok: true});
  };
  const raw = 'Fictional <b>Keychain</b> {name}';
  assert.equal(await sendEmail(storage, {subject: raw, text: raw, urgent: true, mail: 'app-needs-you'}, fetcher), true);
  await refreshLanguage(storage, fetcher);
  const delivery = requests.find(request => request.url.endsWith('/notify/email')).body;
  assert.equal(delivery.language, 'de');
  assert.equal(delivery.subject, raw);
  assert.equal(delivery.html, `<b>Fictional &lt;b&gt;Keychain&lt;/b&gt; {name}</b>\nFictional &lt;b&gt;Keychain&lt;/b&gt; {name}`);
  assert.equal(delivery.kind, 'urgent');
  assert.equal(delivery.mail, 'app-needs-you');
});

test('only acknowledged language refreshes are cached; a later normal event retries failure without changing preferences', async () => {
  const storage = store(), requests = [];
  let accept = false;
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    return answer(accept ? {ok: true, language: body.language} : {ok: false, error: 'language_not_saved'});
  };
  const before = JSON.stringify(storage.settings());
  assert.equal((await refreshLanguage(storage, fetcher)).ok, false);
  accept = true;
  assert.equal((await refreshLanguage(storage, fetcher)).ok, true);
  assert.equal((await refreshLanguage(storage, fetcher)).ok, true);
  assert.equal(requests.length, 2);
  assert.equal(JSON.stringify(storage.settings()), before);
  storage.settings().displayLanguage = 'fr';
  await refreshLanguage(storage, fetcher);
  assert.equal(requests.at(-1).language, 'fr');
  storage.settings().notifyEmail = 'other@example.test';
  await refreshLanguage(storage, fetcher);
  assert.equal(requests.length, 4, 'another address requires its own acknowledgement');
});

test('refresh ordering preserves the latest choice when an earlier request is still in flight', async () => {
  const storage = store(), requests = [];
  let release, started;
  const pending = new Promise(resolve => { release = resolve; });
  const began = new Promise(resolve => { started = resolve; });
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body); requests.push(body.language);
    if (requests.length === 1) { started(); await pending; }
    return answer({ok: true, language: body.language});
  };
  const first = refreshLanguage(storage, fetcher);
  await began;
  storage.settings().displayLanguage = 'de';
  const second = refreshLanguage(storage, fetcher);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(requests, ['ru', 'de']);
});
