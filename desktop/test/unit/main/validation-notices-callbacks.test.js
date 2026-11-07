// Guard: money/data — offline license fixtures and real review callbacks preserve validation and dispatch gates without live services.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {test, beforeEach, afterEach} from 'node:test';
import {setLocale} from '../../../i18n/index.js';
import {check, allowance, open} from '../../../lib/license.js';
import {registerInterviewHandlers} from '../../../lib/interview-handlers.js';
const NOW = Date.parse('2026-11-07T12:00:00Z');
const pair = crypto.generateKeyPairSync('ed25519');
const publicKey = pair.publicKey.export({type: 'spki', format: 'der'}).subarray(-32).toString('base64url');
const sign = payload => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `JP1.${body}.${crypto.sign(null, Buffer.from(body), pair.privateKey).toString('base64url')}`;
};
let state, handles;
const trip = name => {state.trips.push(name); throw new Error(`Forbidden service: ${name}`);};
function register(demo = false) {
  const ipcMain = {handle: (name, fn) => handles.set(name, fn)};
  const context = {DEMO: demo, ipcMain, sharedRead: (name, fn) => fn, handleImportant: (name, label, fn) => handles.set(name, fn),
    cloud: () => state.cloud, needsNotion: reason => {state.gates.push(reason); return state.gate;},
    dispatchCloud: async (caller, request) => {state.dispatches.push({caller, request}); return state.dispatched;},
    interviews: {review: async (storage, id) => {state.local.push(id); return state.reviewed;}},
    storage: {settings: () => ({cloud: {repo: 'fictional/repository'}}), secret: () => trip('secret'), saveSettings: () => trip('write'), path: () => trip('file')},
    appLog: (...args) => state.logs.push(args), notify: () => trip('notice'), toWindow: () => trip('window'),
    shell: {openPath: () => trip('open file')}, dialog: {showOpenDialog: () => trip('native dialog')},
    calltap: {}, reminders: {}, viewCache: {}};
  registerInterviewHandlers(context);
}
const invoke = (...args) => handles.get('ivReview')(null, ...args);
beforeEach(t => {
  state = {trips: [], gates: [], dispatches: [], local: [], logs: [], cloud: true, gate: null, dispatched: {ok: true}, reviewed: {ok: true, summary: 'Original review {error} Mac ⌘K'}};
  handles = new Map(); setLocale('en');
  t.mock.method(Date, 'now', () => NOW);
  t.mock.method(globalThis, 'fetch', () => trip('network'));
  register();
});
afterEach(() => {setLocale('en'); assert.deepEqual(state.trips, [], 'tripwires checked outside caught/rejected callbacks');});

test('license errors follow the active locale while fixture signature, dates, payload fields and flags stay unchanged', () => {
  const payload = {id: 'fixture-key', name: 'Fictional {name} Mac ⌘K', kind: 'friend', until: '2026-11-08'};
  const key = sign(payload); assert.deepEqual(open(key, 'JP1', publicKey), payload);
  const options = {now: NOW, publicKey};
  assert.deepEqual(check(key, options), {ok: true, license: payload});
  setLocale('de');
  assert.deepEqual(check('invalid', options), {ok: false, error: 'Das ist kein Jobadabra-Lizenzschlüssel. Fügen Sie ihn genau so ein, wie Sie ihn erhalten haben (er beginnt mit JP1.).'});
  assert.deepEqual(check(key, {...options, revoked: [payload.id]}), {ok: false, error: 'Dieser Schlüssel wurde zurückgezogen. Bitten Sie Igor um einen neuen.'});
  const expired = sign({...payload, until: '2026-11-06'});
  assert.deepEqual(check(expired, options), {ok: false, error: 'Dieser Schlüssel ist am 2026-11-06 abgelaufen. Bitten Sie Igor um einen neuen.'});
  assert.deepEqual(check(key, options), {ok: true, license: payload});
});

test('real cloud review callback resolves summaries after registration and leaves dispatch/caller identities canonical', async () => {
  setLocale('de'); const id = 'Original {id} Mac ⌘K';
  assert.deepEqual(await invoke(id, 'Original caller'), {ok: true, cloud: true, summary: 'Die Auswertung läuft auf GitHub: Sie erscheint unter Letzte Aktivitäten und wird beim Interview in Notion gespeichert.'});
  assert.deepEqual(state.dispatches, [{caller: 'Interview review (Original caller)', request: {mode: 'interview', interview: id}}]);
  setLocale('fr');
  assert.deepEqual(await invoke(id, 'Original caller'), {ok: true, already: true, summary: 'L’analyse de cet entretien est déjà en cours — elle apparaît dans Activité récente'});
  assert.equal(state.dispatches.length, 1);
  assert.ok(state.logs[0][1].startsWith('refused Interview review (Original caller) → daily.yml (interview) in fictional/repository: already started within '));
});

test('failed cloud dispatch wraps only authored wording and keeps the existing duplicate-start guard', async () => {
  const raw = 'Provider {error} Mac ⌘K'; state.dispatched = {ok: false, error: raw}; setLocale('ru');
  assert.deepEqual(await invoke('cloud-fail'), {ok: false, error: `Не удалось запустить анализ на GitHub: ${raw}`});
  const duplicate = await invoke('cloud-fail'); assert.equal(duplicate.already, true);
  assert.equal(state.dispatches.length, 1);
});

test('gate and demo answers stay unchanged and do not dispatch or review', async () => {
  state.gate = {ok: false, cancelled: true, needsNotion: true, reason: 'interviews', error: 'Original gate'};
  setLocale('de'); assert.equal(await invoke('gate'), state.gate);
  assert.deepEqual(state.gates, ['interviews']);
  register(true);
  assert.deepEqual(await invoke('demo'), {ok: true, summary: 'Reviewed (demo): nothing was written'});
  assert.equal(state.dispatches.length, 0); assert.equal(state.local.length, 0);
});

test('local failure/cancellation clears the duplicate guard and successful raw results pass through unchanged', async () => {
  state.cloud = false; setLocale('ro');
  for (const failed of [{ok: false, error: 'Original provider {error}'}, {ok: false, cancelled: true, error: 'Original cancellation'}]) {
    state.reviewed = failed; assert.equal(await invoke('local-retry'), failed);
  }
  const original = state.reviewed = {ok: true, summary: 'Original review {error} Mac ⌘K', run: 'original-run', model: 'original-model'};
  assert.equal(await invoke('local-retry'), original); assert.equal(state.local.length, 3);
  assert.equal(state.dispatches.length, 0);
});

test('license expiry boundary and revocation precedence remain pinned to the supplied epoch in every locale', () => {
  const payload = {id: 'boundary', name: 'Original name', kind: 'pass', until: '2026-11-07'};
  const key = sign(payload), boundary = Date.parse('2026-11-07T23:59:59Z');
  for (const locale of ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru']) {
    setLocale(locale);
    assert.deepEqual(check(key, {now: boundary, publicKey}), {ok: true, license: payload});
    assert.equal(check(key, {now: boundary + 1, publicKey}).ok, false);
    const revoked = check(key, {now: boundary + 1, publicKey, revoked: ['boundary']});
    assert.equal(revoked.ok, false); assert.ok(!revoked.error.includes(payload.until));
    const result = allowance({applied: 99, firstRunAt: '2020-01-01T00:00:00Z', key, publicKey, now: boundary});
    assert.equal(result.licensed, true); assert.equal(result.ended, false); assert.deepEqual(result.license, payload);
  }
});

test('all locales reach actual license checks and cloud callbacks with exact raw values', async () => {
  const {validationNotice} = await import('../../../i18n/validation-notices.js');
  const payload = {id: 'fixture', name: 'Original {date} Mac', kind: 'friend', until: '2026-11-06'};
  const key = sign(payload), options = {publicKey, now: NOW};
  for (const locale of ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru']) {
    setLocale(locale);
    assert.deepEqual(check(key, options), {ok: false, error: validationNotice('expiredKey', {date: payload.until})});
    assert.deepEqual(check(key, {...options, revoked: ['fixture']}), {ok: false, error: validationNotice('revokedKey')});
    assert.deepEqual(check(sign({...payload, kind: 'unknown'}), options), {ok: false, error: validationNotice('invalidKey')});
    const success = await invoke(`${locale}-success`);
    assert.deepEqual(success, {ok: true, cloud: true, summary: validationNotice('reviewingCloud')});
    assert.deepEqual(await invoke(`${locale}-success`), {ok: true, already: true, summary: validationNotice('alreadyReviewing')});
    const raw = 'Original failure {error} Mac ⌘K'; state.dispatched = {ok: false, error: raw};
    assert.deepEqual(await invoke(`${locale}-failure`), {ok: false, error: validationNotice('reviewStartFailed', {error: raw})});
    state.dispatched = {ok: true};
  }
  assert.equal(state.dispatches.length, 14);
});
