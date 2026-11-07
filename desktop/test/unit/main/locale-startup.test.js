// The real startup prefix initializes display language before its first native prompt, without opening storage or secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {test, afterEach} from 'node:test';
import {setLocale, getLocale} from '../../../i18n/index.js';
import {initializeStartupLocale} from '../../../lib/locale-startup.js';
import {offerMove} from '../../../lib/applications.js';

afterEach(() => setLocale('en'));

test('the actual startup prefix applies a saved choice before Applications consent', () => {
  const source = fs.readFileSync(new URL('../../../main.js', import.meta.url), 'utf8');
  const prefix = source.split('start: () => {')[1]?.split('\n  buildMenu();')[0];
  assert.ok(prefix?.includes('quitBeforeStart'), 'exercise the real initial startup statements');
  const events = [], asked = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-startup-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({displayLanguage: 'ru'}));
  const app = {isPackaged: true, isInApplicationsFolder: () => false, getPath: () => dir};
  const dialog = {showMessageBoxSync: options => {asked.push(options); return 1;}};
  setLocale('en');
  try {vm.runInNewContext(`(() => {${prefix}})()`, {app, dialog, appLog() {},
    initializeStartupLocale: options => {events.push('locale'); return initializeStartupLocale(options);},
    offerMove: options => offerMove({...options, platform: 'darwin'}),
    quitBeforeStart: ({offerMove: move, ...options}) => {events.push('prompt'); move(options); return true;}});
  assert.deepEqual(events, ['locale', 'prompt']);
  assert.equal(asked[0].message, 'Переместить Jobadabra в Программы?');
  } finally {fs.rmSync(dir, {recursive: true, force: true});}
});


test('early preference initialization is English-first, shares IPC policy and reads only non-secret settings', () => {
  const reads = [], osReads = [];
  const app = {getPath: name => {assert.equal(name, 'userData'); return path.join('fictional', 'profile');},
    getPreferredSystemLanguages: () => {osReads.push('preferred'); return ['pt-BR', 'fr-CH'];}};
  for (const [json, choice, locale] of [
    ['{}', 'en', 'en'], ['null', 'en', 'en'], ['{bad', 'en', 'en'],
    ['{"displayLanguage":"ru"}', 'ru', 'ru'], ['{"displayLanguage":"xx"}', 'en', 'en'],
    ['{"displayLanguage":"system"}', 'system', 'fr'],
  ]) {
    const state = initializeStartupLocale({app, readFile: (file, encoding) => {reads.push(file); assert.equal(encoding, 'utf8'); return json;}});
    assert.equal(state.choice, choice); assert.equal(state.locale, locale); assert.equal(getLocale(), locale);
  }
  assert.deepEqual(reads, Array(6).fill(path.join('fictional', 'profile', 'settings.json')));
  assert.equal(osReads.length, 1, 'only an explicit System default choice consults OS preferences');
  setLocale('ru');
  assert.equal(initializeStartupLocale({app, readFile: () => {throw new Error('unreadable');}}).locale, 'en');
});
