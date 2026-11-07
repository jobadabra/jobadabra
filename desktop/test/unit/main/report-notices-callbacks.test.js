// Guard: privacy/data — real report routes localize replies without changing canonical logs, consent, encrypted payloads or live services.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {registerHooks} from 'node:module';
import {test, beforeEach, afterEach} from 'node:test';
import {setLocale} from '../../../i18n/index.js';
const state = globalThis.__reportNoticesTest = {logs: []};
registerHooks({load(url, context, next) {
  if (url === new URL('../../../lib/log.js', import.meta.url).href) return {format: 'module', shortCircuit: true,
    source: 'export const log=(...args)=>globalThis.__reportNoticesTest.logs.push(args);'};
  return next(url, context);
}});
const {createUploader} = await import('../../../lib/report-upload.js');
const {registerReportHandlers} = await import('../../../lib/report-handlers.js');
const {visitMore} = await import('../../../lib/server-hooks.js');
const {setSiteOff} = await import('../../../lib/recipes.js');
const {decryptBundle} = await import('../../../e2e/reports-fetch.mjs');
const {publicKey, privateKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 2048, publicKeyEncoding: {type: 'spki', format: 'pem'}, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}});
const NOW = Date.parse('2026-11-07T12:00:00Z');
let trips, calls, kept, handlers, response, thrown;
const trip = name => {trips.push(name); throw new Error(`Forbidden service: ${name}`);};
const entry = () => ({method: 'GET', url: 'https://jobs.example.test/apply', type: 'document', mode: 'navigate', startMs: 0, waitMs: 5,
  status: 200, failed: false, headers: {'content-type': 'text/html'}, hadCookie: false, body: Buffer.from('<p>Fictional job form</p>').toString('base64')});
const record = () => ({entries: [{...entry(), hash: 'h1'}], bodies: new Map([['h1', Buffer.from('Fictional form')]]), stats: {requests: 1}});
function storage() {
  return {settings: () => kept, saveSettings: patch => Object.assign(kept, patch), secret: () => trip('secret'), path: () => trip('owner file')};
}
function uploader() {
  return createUploader({storage: storage(), base: 'https://report.example.test', pem: publicKey, now: () => NOW,
    fetcher: async (url, init) => {
      if (!['https://report.example.test/api/report-form', 'https://report.example.test/api/install-token'].includes(url)) return trip(`unexpected request ${url}`);
      calls.push({url, init}); if (thrown) throw thrown; return response(url);
    }});
}
function route(upload = uploader()) {
  registerReportHandlers({ipcMain: {handle: (name, fn) => {handlers[name] = fn;}}, storage: storage(), uploader: upload, texts: () => []});
  return payload => visitMore['/extension/report-form'](payload);
}
async function submit(send) { assert.equal((await send({action: 'submit', entries: [entry()]})).ok, true); }
beforeEach(t => {
  trips = []; calls = []; state.logs = []; handlers = {}; thrown = null;
  kept = {telemetryId: 'fixture-install', siteTokens: {report: {install: 'fixture-install', value: 'fixture-token'}}};
  response = () => Response.json({ok: true, id: 'Original {id} Mac ⌘K'});
  t.mock.method(globalThis, 'fetch', () => trip('live network'));
  setSiteOff(''); setLocale('en');
});
afterEach(() => {setLocale('en'); setSiteOff(''); assert.deepEqual(trips, [], 'tripwires checked outside caught report callbacks');});

test('real route translates only returned UI error after logging canonical uploader text', async () => {
  response = () => Response.json({ok: false}, {status: 429});
  const send = route(); await submit(send); setLocale('de');
  assert.deepEqual(await send({action: 'send', note: ''}), {ok: false, error: 'Sie haben heute die maximale Anzahl an Berichten gesendet. Versuchen Sie es morgen erneut.'});
  assert.deepEqual(state.logs.at(-1), ['report', 'a report was not sent: You have sent the most reports for today. Try again tomorrow.']);
  assert.deepEqual(Object.keys(JSON.parse(calls[0].init.headers['X-Report-Meta'])).sort(), ['cause', 'requests']);
  assert.equal(kept.reportsSent, undefined);
});

test('HTTP refusal wrapper localizes status once while canonical uploader result is unchanged', async () => {
  response = () => Response.json({error: 'Raw upstream body {error} Mac'}, {status: 503});
  const up = uploader(), canonical = await up.send(record());
  assert.deepEqual(canonical, {ok: false, error: 'The site did not take it (503). Nothing was kept there.'});
  assert.deepEqual(Object.keys(canonical).sort(), ['error', 'ok']);
  assert.equal(JSON.stringify(canonical), '{"ok":false,"error":"The site did not take it (503). Nothing was kept there."}');
  const send = route(up); await submit(send); setLocale('ru');
  assert.deepEqual(await send({action: 'send', note: ''}), {ok: false, error: 'Сайт не принял отчёт (503). Ничего не было сохранено.'});
  assert.equal(state.logs.at(-1)[1], `a report was not sent: ${canonical.error}`);
});

test('denied install retains canonical result and leaves all network/storage untouched', async () => {
  const send = route(); await submit(send); setSiteOff('test'); setLocale('de');
  assert.deepEqual(await send({action: 'send', note: ''}), {ok: false, error: 'Dies ist keine reguläre Installation, daher wird nichts gesendet.'});
  assert.equal(calls.length, 0); assert.equal(kept.reportsSent, undefined);
  assert.equal(state.logs.at(-1)[1], 'a report was not sent: This is not a regular install, so nothing is sent.');
});

test('successful upload preserves encrypted payload, note, headers, ID and timestamp with no metadata fields', async () => {
  const send = route(); await submit(send); setLocale('fr');
  assert.deepEqual(await send({action: 'send', note: 'Original note {error} Mac'}), {ok: true});
  assert.deepEqual(kept.reportsSent, [{id: 'Original {id} Mac ⌘K', at: NOW}]);
  const {init, url} = calls[0]; assert.equal(url, 'https://report.example.test/api/report-form'); assert.equal(init.method, 'POST');
  assert.deepEqual(JSON.parse(init.headers['X-Report-Meta']), {requests: 1, cause: 'person'});
  assert.equal(init.headers.Authorization, 'Bearer fixture-token'); assert.equal(init.headers['X-Install'], 'fixture-install');
  const bundle = decryptBundle(init.body, init.headers['X-Report-Key'], privateKey);
  assert.equal(bundle.note, 'Original note {error} Mac'); assert.equal(bundle.record.entries[0].url, entry().url);
  assert.equal(bundle.record.entries[0].status, 200); assert.equal(bundle.record.source, 'person');
  assert.equal(state.logs.at(-1)[1], 'a report was sent');
});

test('raw network exceptions pass through unchanged and consumed consent cannot upload twice', async () => {
  thrown = new Error('Raw provider {error} Mac ⌘K'); const send = route(); await submit(send); setLocale('it');
  assert.deepEqual(await send({action: 'send', note: ''}), {ok: false, error: thrown.message});
  assert.equal(state.logs.at(-1)[1], `a report was not sent: ${thrown.message}`);
  assert.deepEqual(await send({action: 'send', note: ''}), {ok: false, refused: 'expired'}); assert.equal(calls.length, 1);
});

test('off, missing consent, cancellation and unknown action retain canonical flags and never send', async () => {
  const send = route();
  assert.deepEqual(await send({action: 'send', note: ''}), {ok: false, refused: 'expired'});
  await submit(send); assert.deepEqual(await send({action: 'cancel'}), {ok: true});
  assert.deepEqual(await send({action: 'send', note: ''}), {ok: false, refused: 'expired'});
  assert.deepEqual(await send({action: 'unknown'}), {ok: false, refused: 'unknown'});
  kept.reportForm = false; assert.deepEqual(await send({action: 'submit', entries: [entry()]}), {ok: false, refused: 'off'});
  assert.equal(calls.length, 0); assert.equal(kept.reportsSent, undefined);
});

test('authored missing-token Error localizes only at the reply boundary and preserves canonical exception/log text', async () => {
  kept.siteTokens = {}; response = () => Response.json({});
  const up = uploader();
  await assert.rejects(up.send(record()), error => {
    assert.equal(error.message, 'The site gave no token just now.');
    assert.deepEqual(Object.keys(error), []); return true;
  });
  const send = route(up); await submit(send); setLocale('de');
  assert.deepEqual(await send({action: 'send', note: ''}), {ok: false, error: 'Die Website hat gerade kein Token bereitgestellt.'});
  assert.equal(state.logs.at(-1)[1], 'a report was not sent: The site gave no token just now.');
  assert.ok(calls.every(call => call.url.endsWith('/api/install-token')));
  assert.equal(kept.reportsSent, undefined);
});

test('all seven invocation locales preserve canonical HTTP errors/logs and reply shapes', async () => {
  for (const locale of ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru']) {
    const messages = (await import(`../../../i18n/catalogs/report-notices/${locale}.js`)).default;
    for (const status of [429, 503, 200]) {
      response = () => Response.json({}, {status}); const send = route(); await submit(send); setLocale(locale);
      const canonical = status === 429 ? 'You have sent the most reports for today. Try again tomorrow.' : `The site did not take it (${status}). Nothing was kept there.`;
      const template = messages[status === 429 ? 'dailyLimit' : 'notAccepted'];
      const answer = await send({action: 'send', note: ''});
      assert.deepEqual(answer, {ok: false, error: template ? template.replace('{status}', String(status)) : canonical}, `${locale}:${status}`);
      assert.equal(state.logs.at(-1)[1], `a report was not sent: ${canonical}`);
      assert.equal(kept.reportsSent, undefined);
    }
  }
});

test('oversize report is refused before network and only its UI reply is localized', async () => {
  const large = record(); large.bodies = new Map([['h1', crypto.randomBytes(9 * 1024 * 1024)]]);
  const result = await uploader().send(large);
  assert.deepEqual(result, {ok: false, error: 'This report is too large to send. Untick the biggest site and try again.'});
  assert.equal(calls.length, 0);
  const send = route({send: async () => result, count: () => 0}); await submit(send); setLocale('de');
  assert.deepEqual(await send({action: 'send', note: ''}), {ok: false, error: 'Dieser Bericht ist zu groß zum Senden. Wählen Sie die größte Website ab und versuchen Sie es erneut.'});
  assert.equal(state.logs.at(-1)[1], `a report was not sent: ${result.error}`);
  assert.equal(calls.length, 0);
});

test('raw exceptions retain the existing catch-only 160-character cap in every locale', async () => {
  const raw = 'Original {error} Mac ⌘K '.repeat(12); thrown = new Error(raw);
  for (const locale of ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru']) {
    const send = route(); await submit(send); setLocale(locale);
    assert.deepEqual(await send({action: 'send', note: ''}), {ok: false, error: raw.slice(0, 160)});
    assert.equal(state.logs.at(-1)[1], `a report was not sent: ${raw.slice(0, 160)}`);
  }
});
