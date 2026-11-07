// Diagnostic display catalogs declare the same keys while English inherits the canonical source text without copying it.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setLocale} from '../../../i18n/index.js';
import {withDisplay, displayText} from '../../../i18n/display-values.js';
import '../../../i18n/notification-notices.js';
import '../../../i18n/report-notices.js';
import '../../../i18n/setup-notices.js';

test('diagnostic namespaces explicitly declare English inheritance for every translated key', async () => {
  for (const folder of ['notification-notices', 'report-notices', 'setup-notices']) {
    const en = (await import(`../../../i18n/catalogs/${folder}/en.js`)).default;
    for (const locale of ['de', 'fr', 'it', 'es', 'ro', 'ru']) {
      const messages = (await import(`../../../i18n/catalogs/${folder}/${locale}.js`)).default;
      assert.deepEqual(Object.keys(en).sort(), Object.keys(messages).sort(), folder);
    }
  }
});

test('English diagnostic inheritance preserves the exact tagged fallback and raw unknown errors', () => {
  setLocale('en');
  const source = 'Canonical diagnostic <raw> {value}';
  assert.equal(displayText(withDisplay({}, 'setupNotices.badCharacter'), source), source);
  setLocale('ru');
  assert.equal(displayText({}, source), source);
  setLocale('en');
});
