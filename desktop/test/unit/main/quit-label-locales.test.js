// Quit-dialog display labels follow locale while critical tracking and personal session labels remain canonical.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as critical from '../../../lib/critical.js';
import {rows} from '../../../i18n/catalogs/quit-labels.js';
import {working} from '../../../lib/quit-dialog.js';
import {setLocale, SUPPORTED_LOCALES} from '../../../i18n/index.js';

const cvNames = ['Saving your CV', 'Dein Lebenslauf wird gespeichert', 'Enregistrement de votre CV', 'Salvataggio del tuo CV', 'Guardando tu CV', 'Se salvează CV-ul tău', 'Сохранение вашего резюме'];
const insights = ['Insight', 'Erkenntnis', 'Éclairage', 'Approfondimento', 'Hallazgo', 'Observație', 'Наблюдение'];

test('actual quit options project critical labels without changing registry identity or personal text', async () => {
  let finish;
  const done = critical.during('Saving your CV', () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  const raw = 'Fictional this Mac Keychain ⌘K {what}';
  try {
    for (const [column, locale] of SUPPORTED_LOCALES.entries()) {
      setLocale(locale);
      const options = working({important: [...critical.labels(), raw], sessions: [{company: raw}], label: session => session.company});
      assert.ok(options.detail.includes(cvNames[column]), locale);
      assert.ok(options.detail.includes(raw), locale);
      assert.deepEqual(critical.labels(), ['Saving your CV'], 'locale never changes the tracked task label');
      assert.equal(options.buttons.length, 3);
    }
  } finally { setLocale('en'); finish(); await done; }
  assert.deepEqual(critical.labels(), []);
});

test('typed pipeline names localize only in quit options; unknown callback labels remain exact', () => {
  const raw = 'Fictional this Mac Keychain ⌘K {task}';
  try {
    for (const [column, locale] of SUPPORTED_LOCALES.entries()) {
      setLocale(locale);
      const options = working({busy: {kind: 'insight'}, queue: [{kind: 'unknown'}], taskName: kind => kind === 'insight' ? 'Insight' : raw});
      assert.ok(options.detail.includes(insights[column]), locale);
      assert.ok(options.detail.includes(raw), locale);
    }
  } finally { setLocale('en'); }
});

test('every bundled important-work label fits the supported locales and actual quit options', () => {
  const labels = Object.values(rows).map(values => values[0]);
  try {
    for (const [column, locale] of SUPPORTED_LOCALES.entries()) {
      setLocale(locale);
      const options = working({important: labels});
      for (const values of Object.values(rows)) {
        assert.equal(values.length, SUPPORTED_LOCALES.length);
        assert.equal(typeof values[column], 'string');
        assert.ok(values[column].trim());
        assert.ok(options.detail.includes(values[column]), `${locale}/${values[0]}`);
      }
    }
  } finally { setLocale('en'); }
});
