// Delivery metadata follows the saved language, preserves consent and retries unacknowledged cache refreshes on normal events.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {notifyEnv, save, sendEmail, refreshLanguage} from '../../../lib/notify-channel.js';

function store(language = 'ru') {
  const settings = {displayLanguage: language, notifyEmail: 'fictional@example.test', notifyBy: ['email']};
  return {settings: () => settings, saveSettings: values => Object.assign(settings, values), secret: key => key === 'JOBADABRA_TRIAL_KEY' ? 'JPF1.fictional.fake' : ''};
}
const answer = value => ({json: async () => value});

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
