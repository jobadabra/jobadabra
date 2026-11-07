// Notification Settings catalogs keep source English fallback, six real translations and explicit Windows device variants.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SUPPORTED_LOCALES} from '../../../i18n/index.js';
const catalogs = Object.fromEntries(await Promise.all(SUPPORTED_LOCALES.map(async locale => [locale, (await import(`../../../i18n/catalogs/notification-notices/${locale}.js`)).default])));

test('six translated catalogs align twenty Settings notices without duplicating canonical English', () => {
  const keys = Object.keys(catalogs.de).sort(); assert.equal(keys.length, 20);
  assert.deepEqual(Object.keys(catalogs.en).sort(), keys);
  assert.ok(Object.values(catalogs.en).every(value => value === null), 'English explicitly inherits canonical diagnostics without duplicating templates');
  for (const locale of SUPPORTED_LOCALES.filter(locale => locale !== 'en')) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), keys, locale);
    for (const key of keys) { assert.equal(typeof catalogs[locale][key], 'string'); assert.doesNotMatch(catalogs[locale][key], /\{[A-Za-z]/); }
    assert.notEqual(catalogs[locale].wherePc, catalogs[locale].whereMac);
    assert.notEqual(catalogs[locale].whereAlwaysPc, catalogs[locale].whereAlwaysMac);
    assert.doesNotMatch(catalogs[locale].wherePc, /Mac/); assert.doesNotMatch(catalogs[locale].whereAlwaysPc, /Mac/);
  }
});
