// Native desktop copy follows the selected language without changing actions or interpolated company data.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {setLocale} from '../../../i18n/index.js';
import {template, answer} from '../../../lib/app-menu.js';
import {submitted, cancelAll} from '../../../lib/quit-dialog.js';
import {guardUnsaved} from '../../../lib/unsaved-guard.js';
import menus from '../../../i18n/catalogs/native/menu.js';
import quits from '../../../i18n/catalogs/native/quit.js';
import pickers from '../../../i18n/catalogs/native/pickers.js';
import system from '../../../i18n/catalogs/native/system.js';
import channels from '../../../i18n/catalogs/native/channels.js';
import {resumeQuestion} from '../../../lib/resume-queue.js';
import {failedToast} from '../../../lib/save-notice.js';

afterEach(() => setLocale('en'));

test('all native catalog languages carry the same keys and interpolation names', () => {
  const parameters = value => [...new Set((typeof value === 'string' ? [value] : Object.values(value)).flatMap(text => [...text.matchAll(/\{(\w+)\}/g)].map(found => found[1])))].sort();
  for (const catalog of [menus, quits, pickers, system, channels]) for (const locale of ['de', 'fr', 'it', 'es', 'ro', 'ru']) {
    assert.deepEqual(Object.keys(catalog[locale]).sort(), Object.keys(catalog.en).sort(), locale);
    for (const key of Object.keys(catalog.en)) assert.deepEqual(parameters(catalog[locale][key]), parameters(catalog.en[key]), `${locale}.${key}`);
  }
});

test('resume and file-save messages translate around unchanged task and file names', () => {
  setLocale('de');
  const question = resumeQuestion(['Mac {count}', 'Example']);
  assert.match(question.message, /Mac \{count\} und Example/);
  assert.deepEqual(question.buttons, ['Erneut starten', 'Gestoppt lassen']);
  assert.equal(question.cancelId, 1);
  const toast = failedToast('/tmp/My Mac {name}.json');
  assert.match(toast.title, /My Mac \{name\}\.json/); assert.equal(toast.retrySave, '/tmp/My Mac {name}.json');
});

test('native menus translate labels while preserving accelerators, roles and callbacks', () => {
  setLocale('de'); const calls = [];
  const menu = template({name: 'Jobadabra', mac: true, checkForUpdates: () => calls.push('update'), find: action => calls.push(action)});
  assert.equal(menu[0].submenu[1].label, 'Nach Updates suchen…'); menu[0].submenu[1].click();
  const edit = menu.find(item => item.label === 'Bearbeiten'); assert.ok(edit);
  const find = edit.submenu.find(item => item.accelerator === 'CmdOrCtrl+F'); assert.equal(find.label, 'Suchen…'); find.click();
  assert.deepEqual(calls, ['update', 'open']); assert.ok(edit.submenu.some(item => item.role === 'paste'));
});

test('update dialogs translate app text and preserve version strings and third-party error details', () => {
  setLocale('ru'); const offered = answer({ok: true, offer: {version: '0.9.2'}}, '0.9.1');
  assert.match(offered.message, /0\.9\.2/); assert.match(offered.detail, /0\.9\.1/);
  assert.deepEqual(offered.buttons, ['Обновить сейчас', 'Позже']); assert.equal(offered.install, true);
  const raw = '<provider> Forbidden Mac {name}'; assert.equal(answer({ok: false, text: raw}, '0.9.1').detail, raw);
});

test('native application questions translate around company data and use Russian plural forms', () => {
  setLocale('fr'); const question = submitted('My Mac {count} Ltd');
  assert.match(question.message, /My Mac \{count\} Ltd/); assert.notEqual(question.buttons[0], 'Yes, I submitted it');
  setLocale('ru');
  assert.match(cancelAll(Array.from({length: 2}, () => ({company: 'Example'}))).message, /2 заявки/);
  assert.match(cancelAll(Array.from({length: 5}, () => ({company: 'Example'}))).message, /5 заявок/);
});

test('an unsaved draft dialog uses the current locale even after the module was imported', () => {
  let callback, asked, left = false;
  guardUnsaved({on: (_, fn) => { callback = fn; }}, {ask: options => { asked = options; return 0; }});
  setLocale('de'); callback({preventDefault: () => { left = true; }});
  assert.equal(asked.buttons[0], 'Bleiben'); assert.equal(asked.defaultId, 0); assert.equal(asked.cancelId, 0); assert.equal(left, false);
});
