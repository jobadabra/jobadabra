// Locale IPC validates display preferences, persists safely and resolves the operating system default.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {registerLocaleHandlers} from '../../../lib/locale-handlers.js';
import {setLocale, getLocale} from '../../../i18n/index.js';

afterEach(() => setLocale('en'));
function setup(settings = {}, {fail = false} = {}) {
  const handlers = {}, writes = [], events = [];
  registerLocaleHandlers({ipcMain: {handle: (name, fn) => { handlers[name] = fn; }}, app: {getPreferredSystemLanguages: () => ['pt', 'fr-CH']},
    storage: {settings: () => settings, saveSettings: patch => { if (fail) throw new Error('Disk full'); writes.push(patch); Object.assign(settings, patch); }}, onChange: () => events.push(getLocale())});
  return {handlers, settings, writes, events};
}
test('startup resolves the OS choice and a saved preference wins', () => {
  const a = setup(); assert.equal(a.handlers.locale().locale, 'fr'); assert.equal(a.handlers.locale().choice, 'system');
  const b = setup({displayLanguage: 'ru'}); assert.equal(b.handlers.locale().locale, 'ru'); assert.equal(getLocale(), 'ru');
});
test('only explicit supported choices or system can be persisted', () => {
  const a = setup();
  for (const choice of ['xx', 'fr-CH', null, {}, '__proto__']) assert.throws(() => a.handlers.setLocale(null, choice), /language/i);
  assert.deepEqual(a.writes, []);
  assert.equal(a.handlers.setLocale(null, 'de').locale, 'de');
  assert.deepEqual(a.writes, [{displayLanguage: 'de'}]); assert.deepEqual(a.events, ['de']);
  assert.equal(a.handlers.setLocale(null, 'system').locale, 'fr');
});
test('failed persistence retains the active locale and does not announce a change', () => {
  const a = setup({displayLanguage: 'en'}, {fail: true});
  assert.throws(() => a.handlers.setLocale(null, 'ru'), /Disk full/);
  assert.equal(getLocale(), 'en'); assert.deepEqual(a.events, []);
});
