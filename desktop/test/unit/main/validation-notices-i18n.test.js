// Validation notice catalogs preserve identical key/parameter contracts and single-pass raw interpolation in every locale.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {SUPPORTED_LOCALES, setLocale} from '../../../i18n/index.js';
import {validationNotice} from '../../../i18n/validation-notices.js';
const catalogs = Object.fromEntries(await Promise.all(SUPPORTED_LOCALES.map(async locale => [locale, (await import(`../../../i18n/catalogs/validation-notices/${locale}.js`)).default])));
const params = text => [...text.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(match => match[1]).sort();
afterEach(() => setLocale('en'));

test('all seven catalogs provide six translated messages with matching interpolation parameters', () => {
  const keys = Object.keys(catalogs.en).sort(); assert.equal(keys.length, 6);
  for (const [locale, messages] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(messages).sort(), keys, locale);
    for (const key of keys) {
      assert.equal(typeof messages[key], 'string');
      assert.deepEqual(params(messages[key]), params(catalogs.en[key]), `${locale}.${key}`);
      if (locale !== 'en') assert.notEqual(messages[key], catalogs.en[key], `${locale}.${key}`);
    }
  }
});

test('standalone notice registration interpolates raw errors and dates exactly once', () => {
  const raw = 'Original {error} {date} Mac ⌘K';
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    assert.equal(validationNotice('reviewStartFailed', {error: raw}), catalogs[locale].reviewStartFailed.replace('{error}', raw));
    assert.equal(validationNotice('expiredKey', {date: raw}), catalogs[locale].expiredKey.replace('{date}', raw));
  }
});
