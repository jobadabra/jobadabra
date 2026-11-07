// Guard: privacy/data — real notification callbacks localize UI copies while consent, cached notes and website payloads remain canonical.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {test, beforeEach, afterEach} from 'node:test';
import {setLocale} from '../../../i18n/index.js';
const state = globalThis.__notificationNoticesTest = {};
registerHooks({load(url, context, next) {
  const mocks = {
    'hosted-email.js': 'export const followNotify=async()=>globalThis.__notificationNoticesTest.follow;',
    'email-from-cv.js': 'export const cvAddress=async()=>""; export const view=async()=>({address:"",consented:false});',
  };
  for (const [name, source] of Object.entries(mocks)) if (url === new URL(`../../../lib/${name}`, import.meta.url).href) return {format: 'module', shortCircuit: true, source};
  return next(url, context);
}});
const channel = await import('../../../lib/notify-channel.js');
const mail = await import('../../../lib/mail-choices.js');
const {registerNotifyHandlers} = await import('../../../lib/notify-handlers.js');
const {wordingOf} = await import('../../../renderer/email-consent-words.js');
const NOW = Date.parse('2026-11-07T12:00:00Z');
const KEY = 'JPF1.fixture.token';
let kept, handles, calls, logs, trips, responses, writes, storage, secrets;
const trip = name => {trips.push(name); throw new Error(`Forbidden service: ${name}`);};
const invoke = (name, ...args) => handles.get(name)(null, ...args);
const upstreamRow = Object.freeze({id: 'app-matches', name: 'Original {name} Mac', when: 'Original {when} ⌘K', choice: '', suggested: Object.freeze({mac: 'digest', always: 'digest'})});
beforeEach(t => {
  kept = {notifyBy: ['app']}; handles = new Map(); calls = []; logs = []; trips = []; responses = []; writes = [];
  secrets = {JOBADABRA_TRIAL_KEY: KEY}; state.follow = {ok: true, moved: false};
  storage = {settings: () => kept, saveSettings: patch => {writes.push(patch); Object.assign(kept, patch);}, secret: name => {
    if (!['JOBADABRA_TRIAL_KEY', 'ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN'].includes(name)) return trip(`unexpected secret ${name}`);
    return secrets[name] || '';
  }, path: () => trip('owner file')};
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: NOW});
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const path = new URL(url).pathname;
    if (new URL(url).origin !== 'https://www.jobadabra.top' || !['/api/account/email', '/api/account/email/resend', '/api/mail/choices'].includes(path)) return trip(`network ${url}`);
    calls.push({url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null});
    const answer = responses.shift(); if (answer instanceof Error) throw answer;
    if (!answer) return trip('unexpected request');
    return {json: async () => answer};
  });
  setLocale('en');
  registerNotifyHandlers({ipcMain: {handle: (name, fn) => handles.set(name, fn)}, storage, DEMO: false, log: (...args) => logs.push(args)});
});
afterEach(() => {setLocale('en'); delete globalThis.window; assert.deepEqual(trips, [], 'tripwires asserted outside caught callbacks');});

// The fake storage above never reaches a real Keychain; the fetch tripwire rejects AI, Telegram, outgoing mail and owner-app routes.
test('email validation follows the invocation locale while canonical log text and opt-in state stay unchanged', async () => {
  setLocale('de');
  assert.deepEqual(await invoke('notifySave', {by: ['email'], email: ''}), {ok: false, error: 'Geben Sie Ihre E-Mail-Adresse ein, um per E-Mail benachrichtigt zu werden.'});
  assert.deepEqual(logs[0], ['notify', 'not saved', {by: 'email', email: false, error: 'Enter your email address to be told by email.'}]);
  assert.deepEqual(kept, {notifyBy: ['app']}); assert.deepEqual(writes, []); assert.equal(calls.length, 0);
});

test('reason-map errors project only at IPC reply, leaving producer results and raw provider text canonical', async () => {
  responses.push({ok: false, error: 'taken'}); const result = await channel.call(storage, 'PUT', '/api/account/email', {email: 'original@example.test'}, globalThis.fetch);
  assert.deepEqual(result, {ok: false, error: 'That address already has a Jobadabra account. Use another address, or sign in with it once Pro is out.'});
  responses.push({ok: false, error: 'taken'}); setLocale('de');
  assert.deepEqual(await invoke('notifySave', {by: ['email'], email: 'original@example.test'}), {ok: false, error: 'Für diese Adresse gibt es bereits ein Jobadabra-Konto. Verwenden Sie eine andere Adresse oder melden Sie sich damit an, sobald Pro verfügbar ist.'});
  assert.equal(logs.at(-1)[2].error, result.error);
  const raw = 'Provider {error} Mac ⌘K'; responses.push({ok: false, error: raw});
  assert.deepEqual(await invoke('notifySave', {by: ['email'], email: 'original@example.test'}), {ok: false, error: raw});
});

test('resend preserves code and request data while resolving current display language', async () => {
  kept.notifyEmail = 'Original@example.test'; responses.push({ok: false, error: 'wait'}); setLocale('fr');
  assert.deepEqual(await invoke('notifyResend'), {ok: false, error: 'Nous venons de l’envoyer. Vérifiez votre boîte de réception et vos courriers indésirables ; vous pourrez le redemander dans une heure.', code: 'wait'});
  assert.deepEqual(calls[0].body, null); assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers['x-api-key'], KEY); assert.ok(calls[0].url.endsWith('/api/account/email/resend'));
  assert.deepEqual(logs[0], ['notify', 'confirm mail not sent again', {code: 'wait'}]);
});

test('mail read clones Mac UI delivery guidance while cached notes and upstream names/when remain byte-identical', async () => {
  globalThis.window = {pilot: {platform: 'darwin'}};
  kept.mailNote = 'Not every e-mail could be turned on just now: Original provider {error} Mac';
  responses.push({ok: true, rows: [upstreamRow], news: [{id: 'tips', name: 'Original news Mac', when: 'Original schedule', on: true}]});
  setLocale('de'); const answer = await invoke('mailChoices');
  assert.equal(answer.where, 'Von Ihrem Mac: nur, wenn Ihr Mac wach und die App geöffnet ist. Andernfalls wird keine E-Mail gesendet.');
  assert.equal(answer.macWhere, answer.where); assert.equal(answer.rows[0].where, answer.where);
  assert.equal(answer.rows[0].name, upstreamRow.name); assert.equal(answer.rows[0].when, upstreamRow.when);
  assert.deepEqual(answer.news, [{id: 'tips', name: 'Original news Mac', when: 'Original schedule', on: true}]);
  assert.equal(answer.note, kept.mailNote); assert.ok(!JSON.stringify(kept).includes('Von Ihrem'));
  assert.deepEqual(kept.mailRows, [{id: 'app-matches', choice: '', suggested: upstreamRow.suggested}]);
});

test('mail row refusal carries canonical metadata through wrappers and logs before the UI clone', async () => {
  responses.push({ok: false, reason: 'not_saved'}); setLocale('de');
  assert.deepEqual(await invoke('mailChoiceSet', 'app-matches', false), {ok: false, error: 'Das konnte gerade nicht gespeichert werden. Der Schalter steht wieder wie zuvor; versuchen Sie es in einer Minute erneut.'});
  assert.equal(logs.at(-1)[2].error, 'Could not save it just now. The switch is back where it was; try again in a minute.');
  assert.deepEqual(calls[0].body, {mail: 'app-matches', on: false}); assert.equal(calls[0].method, 'POST');
});

test('successful save preserves normalized address, consent wording/flags/stamp, env enums and response shape', async () => {
  responses.push({ok: true}); setLocale('ru');
  assert.deepEqual(await invoke('notifySave', {by: ['email', 'app'], email: '  Original@Example.Test ', cadence: 'weekly', consentVia: 'cv', consentGiven: 'default'}), {ok: true});
  assert.deepEqual(calls[0].body, {email: 'original@example.test', cadence: 'weekly'});
  assert.equal(kept.notifyEmail, 'original@example.test'); assert.equal(kept.notifyEmailAt, new Date(NOW).toISOString());
  assert.equal(kept.emailConsent.wording, wordingOf('settings')); assert.equal(kept.emailConsent.where, 'settings'); assert.equal(kept.emailConsent.given, 'switched');
  assert.deepEqual(kept.notifyBy, ['email', 'app']);
  assert.deepEqual(channel.notifyEnv(storage), {JOBADABRA_NOTIFY: 'email,app', JOBADABRA_TRIAL_KEY: KEY});
});

test('unknown enum validation, cached provider notes and successful values retain their original meaning', async () => {
  setLocale('it'); assert.deepEqual(await invoke('mailChoiceSet', 'unknown', 'invalid'), {ok: false, error: 'That e-mail is not one of the switches.'});
  assert.equal(calls.length, 0);
  kept.notifyEmail = 'Original@example.test'; responses.push({ok: true});
  assert.deepEqual(await invoke('notifyResend'), {ok: true});
  assert.equal(kept.notifyEmail, 'Original@example.test');
});

test('all locales project known resend codes at invocation without changing code, addresses or canonical source results', async () => {
  const codes = {wait: 'resendWait', confirmed: 'resendConfirmed', stopped: 'resendStopped', no_address: 'noAddress', off: 'serviceOff', not_sent: 'notSent'};
  kept.notifyEmail = 'Original@example.test';
  for (const locale of ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru']) {
    const messages = (await import(`../../../i18n/catalogs/notification-notices/${locale}.js`)).default;
    for (const [code, key] of Object.entries(codes)) {
      responses.push({ok: false, error: code}); const canonical = await channel.resend(storage, globalThis.fetch);
      responses.push({ok: false, error: code}); setLocale(locale);
      assert.deepEqual(await invoke('notifyResend'), {...canonical, error: messages[key] || canonical.error}, `${locale}:${code}`);
      assert.equal(kept.notifyEmail, 'Original@example.test');
    }
  }
  assert.deepEqual(writes, []);
});

test('Windows delivery variants use explicit locale keys without rewriting upstream Mac/name text', async () => {
  globalThis.window = {pilot: {platform: 'win32'}};
  for (const locale of ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru']) {
    setLocale(locale);
    responses.push({ok: true, rows: [upstreamRow]}); const view = await invoke('mailChoices');
    assert.equal(view.mode, 'mac'); assert.equal(view.rows[0].name, upstreamRow.name); assert.equal(view.rows[0].when, upstreamRow.when);
    const messages = (await import(`../../../i18n/catalogs/notification-notices/${locale}.js`)).default;
    if (locale === 'en') { assert.match(view.where, /your PC/); assert.doesNotMatch(view.where, /Mac/); }
    else assert.equal(view.where, messages.wherePc);
    kept.cloud = {repo: 'fictional/repo'}; responses.push({ok: true, rows: [upstreamRow]});
    const always = await invoke('mailChoices');
    assert.equal(always.mode, 'always');
    if (locale === 'en') assert.match(always.where, /your PC off/); else assert.equal(always.where, messages.whereAlwaysPc);
    assert.equal(always.macWhere, view.where); delete kept.cloud;
  }
});

test('historical cached mailNote stays canonical after a failed automatic write and subsequent localized read', async () => {
  const {displayText} = await import('../../../i18n/display-values.js');
  Object.assign(kept, {notifyBy: ['email', 'app'], notifyEmail: 'original@example.test', emailConsent: {at: new Date(NOW).toISOString(), wording: 'Original consent'}, cloud: {repo: 'fictional/repo'}});
  setLocale('de'); responses.push({ok: true, rows: [upstreamRow]}, {ok: false, reason: 'not_saved'});
  const failed = await mail.alwaysOnTurnedOn(storage, globalThis.fetch);
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'Could not save it just now. The switch is back where it was; try again in a minute.');
  assert.equal(displayText(failed, failed.error), 'Das konnte gerade nicht gespeichert werden. Der Schalter steht wieder wie zuvor; versuchen Sie es in einer Minute erneut.');
  const note = `Not every e-mail could be turned on just now: ${failed.error}`;
  assert.equal(kept.mailNote, note);
  responses.push({ok: true, rows: [upstreamRow]}); const view = await invoke('mailChoices');
  assert.equal(view.note, note); assert.equal(kept.mailNote, note);
  assert.ok(!JSON.stringify(writes).includes('Das konnte'));
});

test('untagged provider prose identical to an authored message is not interpreted as a code', async () => {
  const raw = 'That address already has a Jobadabra account. Use another address, or sign in with it once Pro is out.';
  responses.push({ok: false, error: raw}); setLocale('de');
  assert.deepEqual(await invoke('notifySave', {by: ['email'], email: 'original@example.test'}), {ok: false, error: raw});
  assert.equal(logs.at(-1)[2].error, raw);
});

test('network timeout retains the exact cap and request payload, then projects the owned guidance only', async t => {
  let aborted = false;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({url, method: init.method, body: JSON.parse(init.body)});
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => {aborted = true; reject(new Error('original timeout'));}));
  });
  setLocale('ru'); const pending = invoke('notifySave', {by: ['app'], email: ' Original@Example.Test ', cadence: 'weekly'});
  t.mock.timers.tick(channel.SLOW_MS);
  assert.deepEqual(await pending, {ok: false, error: 'Не удалось связаться с сайтом. Повторите попытку при подключении к интернету.'});
  assert.equal(aborted, true); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, {email: 'original@example.test', cadence: 'weekly'});
  assert.equal(logs.at(-1)[2].error, 'The website could not be reached. Try again when you are online.');
  assert.deepEqual(kept, {notifyBy: ['app']});
});

test('turning a row on preserves consent, normalized address, write order and successful callback fields', async () => {
  const {rowLine} = await import('../../../renderer/email-consent-words.js');
  responses.push({ok: true}, {ok: true, rows: [upstreamRow]}, {ok: true}); setLocale('de');
  assert.deepEqual(await invoke('mailChoiceSet', 'app-matches', true, {address: ' Original@Example.Test ', name: 'Original {name} Mac'}), {ok: true, addressSaved: true});
  assert.deepEqual(calls.map(call => [new URL(call.url).pathname, call.method, call.body]), [
    ['/api/account/email', 'PUT', {email: 'original@example.test'}], ['/api/mail/choices', 'GET', null], ['/api/mail/choices', 'POST', {mail: 'app-matches', on: true}],
  ]);
  assert.equal(kept.emailConsent.wording, rowLine('Original {name} Mac'));
  assert.equal(kept.emailConsent.given, 'switched'); assert.equal(kept.emailConsent.where, 'settings');
  assert.equal(kept.emailConsent.at, new Date(NOW).toISOString());
  assert.deepEqual(kept.notifyBy, ['app', 'email']); assert.equal(kept.mailRows[0].choice, 'on');
  assert.equal(kept.mailRowsSettled, new Date(NOW).toISOString());
  assert.deepEqual(logs.at(-1), ['notify', 'mail switch saved', {row: 'app-matches', on: true, addressSaved: true, error: ''}]);
});
