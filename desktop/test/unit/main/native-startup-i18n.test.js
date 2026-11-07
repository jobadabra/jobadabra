// Native installation dialogs localize at invocation while preserving actions, data warnings and raw errors.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {setLocale} from '../../../i18n/index.js';
import {offerMove} from '../../../lib/applications.js';
import {noticeOptions} from '../../../lib/two-installs-notice.js';

afterEach(() => setLocale('en'));

const titles = {
  en: ['Move Jobadabra to Applications?', 'Jobadabra is installed twice'],
  de: ['Jobadabra nach Programme verschieben?', 'Jobadabra ist zweimal installiert'],
  fr: ['Déplacer Jobadabra dans Applications ?', 'Jobadabra est installé deux fois'],
  it: ['Spostare Jobadabra in Applicazioni?', 'Jobadabra è installato due volte'],
  es: ['¿Mover Jobadabra a Aplicaciones?', 'Jobadabra está instalado dos veces'],
  ro: ['Muți Jobadabra în Aplicații?', 'Jobadabra este instalat de două ori'],
  ru: ['Переместить Jobadabra в Программы?', 'Jobadabra установлен дважды'],
};

test('installation dialogs follow the current language without changing action indices', () => {
  for (const [locale, [move, twice]] of Object.entries(titles)) {
    setLocale(locale);
    const shown = [];
    const app = {isPackaged: true, isInApplicationsFolder: () => false};
    assert.equal(offerMove({app, dialog: {showMessageBoxSync: box => {shown.push(box); return 1;}}, platform: 'darwin'}), false);
    assert.equal(shown[0].message, move, locale);
    assert.deepEqual([shown[0].defaultId, shown[0].cancelId, shown[0].buttons.length], [0, 1, 2]);
    for (const self of ['exe', 'store']) {
      const options = noticeOptions({self});
      assert.equal(options.message, twice, locale);
      assert.deepEqual([options.defaultId, options.cancelId, options.buttons.length, options.noLink], [0, 1, 2, true]);
      assert.doesNotMatch(options.detail, /\{which\}/, locale);
      assert.ok(options.detail.includes('Microsoft Store'), locale);
    }
  }
});

test('a localized move failure preserves the original error without a second interpolation', () => {
  setLocale('ru'); const shown = [], raw = 'This Mac’s Keychain {error} ⌘K';
  const app = {isPackaged: true, isInApplicationsFolder: () => false, moveToApplicationsFolder() {throw new Error(raw);}};
  const dialog = {showMessageBoxSync: box => {shown.push(box); return 0;}};
  assert.equal(offerMove({app, dialog, platform: 'darwin'}), false);
  assert.ok(shown[1].detail.startsWith(`${raw}\n\n`));
  assert.notEqual(shown[1].message, "Jobadabra couldn't move itself");
});

test('replacement resolves locale at the conflict callback and never replaces a running copy', () => {
  const shown = []; let conflict;
  const app = {isPackaged: true, isInApplicationsFolder: () => false,
    moveToApplicationsFolder: options => { conflict = options.conflictHandler; return true; }};
  assert.equal(offerMove({app, dialog: {showMessageBoxSync: options => {shown.push(options); return 0;}}, platform: 'darwin'}), true);
  setLocale('de');
  assert.equal(conflict('existsAndRunning'), false);
  assert.equal(shown.length, 1);
  assert.equal(conflict('exists'), true);
  assert.equal(shown[1].message, 'Jobadabra in Programme ersetzen?');
  assert.deepEqual([shown[1].defaultId, shown[1].cancelId], [0, 1]);
  assert.match(shown[1].detail, /außerhalb der App/);
});
