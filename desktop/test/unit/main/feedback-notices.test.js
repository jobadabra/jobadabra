// Real feedback/waitlist callbacks localize only display copy and preserve payloads, provider text and storage flags.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {SUPPORTED_LOCALES, setLocale, t} from '../../../i18n/index.js';
import {send, MAX_CHARS, ENDPOINT} from '../../../lib/app-feedback.js';
import {joinProWaitlist} from '../../../lib/pro-waitlist.js';
import {setSiteOff} from '../../../lib/recipes.js';

afterEach(() => {setLocale('en'); setSiteOff('');});
const text = (key, vars) => t(`feedbackNotice.${key}`, vars);
function store() {
  const settings = {telemetryId: 'fictional-install {id}'}, writes = [];
  return {writes, settings: () => settings, saveSettings: patch => {writes.push(patch); Object.assign(settings, patch);}};
}
const empty = {en: 'Write a few words first.', de: 'Schreibe zuerst ein paar Worte.', fr: 'Écrivez d’abord quelques mots.',
  it: 'Scrivi prima qualche parola.', es: 'Escribe unas palabras primero.', ro: 'Scrie mai întâi câteva cuvinte.', ru: 'Сначала напишите несколько слов.'};

test('feedback validation is localized and formats the same unchanged limit without network or storage writes', async () => {
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    const storage = store(), calls = [];
    const fetcher = (...args) => {calls.push(args); throw new Error('network forbidden');};
    assert.deepEqual(await send({text: ' '}, {storage, fetcher}), {ok: false, error: empty[locale]});
    assert.deepEqual(await send({text: 'x'.repeat(MAX_CHARS + 1)}, {storage, fetcher}),
      {ok: false, error: text('feedbackLength', {limit: new Intl.NumberFormat(locale).format(MAX_CHARS)})});
    assert.deepEqual(calls, [], 'tripwire is checked outside caught callbacks'); assert.deepEqual(storage.writes, []);
  }
});

test('feedback status and network wrappers preserve exact raw errors with one interpolation', async () => {
  const raw = 'Fictional {error} {status} C:\\this Mac\\Keychain ⌘K <raw>';
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    for (const status of [429, 503]) {
      const result = await send({text: 'Fictional feedback'}, {storage: store(), fetcher: async () => new Response('{}', {status})});
      assert.deepEqual(result, {ok: false, error: text(status === 429 ? 'feedbackRate' : 'feedbackHttp', {status})});
    }
    const result = await send({text: 'Fictional feedback'}, {storage: store(), fetcher: async () => {throw new Error(raw);}});
    assert.deepEqual(result, {ok: false, error: text('feedbackNetwork', {error: raw})});
    assert.ok(result.error.includes(raw));
  }
});

test('feedback success preserves request bytes, optional parts, exact limit and raw skipped identifiers', async () => {
  const values = {text: '  Fictional {text} Ключ ⌘K  ', contact: '  Contact {email}@example.test  ', screen: 'sessions',
    screenshot: 'data:image/jpeg;base64,AAAA', logs: 'Fictional {logs} Keychain', page: '{"raw":"{page}"}', profile: '{"raw":"{profile}"}'};
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    const storage = store(), calls = [], skipped = ['profile', 'Fictional {raw}'];
    const fetcher = async (url, options) => {calls.push([url, options]); return Response.json({ok: true, skipped});};
    assert.deepEqual(await send(values, {storage, version: 'fictional-version', platform: 'fictional-platform', fetcher}), {ok: true, skipped});
    assert.equal(calls[0][0], ENDPOINT);
    assert.deepEqual(calls[0][1], {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
      text: values.text.trim(), contact: values.contact.trim(), install: storage.settings().telemetryId,
      version: 'fictional-version', platform: 'fictional-platform', screen: values.screen, screenshot: values.screenshot,
      logs: values.logs, page: values.page, profile: values.profile})});
    assert.deepEqual(storage.writes, []);
    calls.length = 0;
    const exact = 'x'.repeat(MAX_CHARS);
    assert.deepEqual(await send({text: exact}, {storage, fetcher: async (url, options) => {calls.push(JSON.parse(options.body)); return Response.json({ok: true});}}), {ok: true});
    assert.equal(calls[0].text, exact);
    for (const field of ['screen', 'screenshot', 'logs', 'page', 'profile']) assert.equal(Object.hasOwn(calls[0], field), false);
  }
});

test('waitlist invalid and unavailable branches preserve validation flags without any request or save', async () => {
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale); setSiteOff('');
    const storage = store(), calls = [], fetcher = (...args) => {calls.push(args); throw new Error('network forbidden');};
    for (const email of ['wrong', `${'x'.repeat(250)}@x.test`]) assert.deepEqual(await joinProWaitlist(storage, email, {fetcher}), {ok: false, error: text('waitlistEmail')});
    setSiteOff('fictional-disabled-build');
    assert.deepEqual(await joinProWaitlist(storage, 'fictional@example.test', {fetcher}), {ok: false, error: text('waitlistUnavailable')});
    assert.deepEqual(calls, []); assert.deepEqual(storage.writes, []);
  }
});

test('waitlist failures preserve raw provider error and save only after exact success payload', async () => {
  const raw = 'Fictional {error} this Mac Keychain ⌘K <provider>';
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale); setSiteOff('');
    const storage = store(), requests = []; let nowCalls = 0;
    const now = () => {nowCalls++; return 42;};
    for (const [status, body, error] of [[503, {error: raw}, raw], [200, {ok: false, error: raw}, raw], [503, {}, text('waitlistRetry')]]) {
      const fetcher = async () => Response.json(body, {status});
      assert.deepEqual(await joinProWaitlist(storage, 'fictional@example.test', {fetcher, now}), {ok: false, error});
    }
    assert.deepEqual(await joinProWaitlist(storage, 'fictional@example.test', {fetcher: async () => {throw new Error(raw);}, now}), {ok: false, error: text('waitlistNetwork')});
    assert.deepEqual(storage.writes, []); assert.equal(nowCalls, 0);
    const result = await joinProWaitlist(storage, '  Fictional+Contact@EXAMPLE.TEST  ', {now, fetcher: async (url, options) => {requests.push([url, options]); return Response.json({ok: true});}});
    assert.deepEqual(result, {ok: true, email: 'fictional+contact@example.test'});
    assert.ok(requests[0][0].endsWith('/api/waitlist'));
    assert.deepEqual(requests[0][1], {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"email":"fictional+contact@example.test","source":"app"}'});
    assert.deepEqual(storage.writes, [{proWaitlist: {email: result.email, at: 42}}]); assert.equal(nowCalls, 1);
  }
});

test('all seven feedback catalogs have exactly the same keys and parameters', async () => {
  const english = (await import('../../../i18n/catalogs/feedback-notices/en.js')).default;
  const parameters = value => [...value.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(match => match[1]).sort();
  for (const locale of SUPPORTED_LOCALES) {
    const messages = (await import(`../../../i18n/catalogs/feedback-notices/${locale}.js`)).default;
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(english).sort());
    for (const [key, value] of Object.entries(messages)) {
      assert.ok(value.trim()); assert.deepEqual(parameters(value), parameters(english[key]));
      if (locale !== 'en') assert.notEqual(value, english[key], `${locale}.${key}`);
    }
  }
});
