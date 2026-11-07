// Editing catalogs keep locale parameters and count forms aligned while canonical control/document text stays original.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {SUPPORTED_LOCALES, setLocale} from '../../../i18n/index.js';
import {editNotice} from '../../../i18n/edit-notices.js';
const catalogs = Object.fromEntries(await Promise.all(SUPPORTED_LOCALES.map(async locale => [locale, (await import(`../../../i18n/catalogs/edit-notices/${locale}.js`)).default])));
const params = text => [...text.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(match => match[1]).sort();
afterEach(() => setLocale('en'));

test('all seven catalogs cover eight notices with matching parameters and required plural forms', () => {
  const keys = Object.keys(catalogs.en).sort(); assert.equal(keys.length, 8);
  for (const [locale, messages] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(messages).sort(), keys, locale);
    for (const key of keys) {
      const forms = typeof messages[key] === 'string' ? [messages[key]] : Object.values(messages[key]);
      const english = typeof catalogs.en[key] === 'string' ? catalogs.en[key] : catalogs.en[key].other;
      for (const text of forms) {
        assert.equal(typeof text, 'string'); assert.deepEqual(params(text), params(english), `${locale}.${key}`);
        if (locale !== 'en') assert.notEqual(text, english, `${locale}.${key}`);
      }
    }
    for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) assert.ok(messages.outlineChanged[category], `${locale}.${category}`);
  }
});

test('standalone registration interpolates raw values exactly once and selects saved-count forms', () => {
  const raw = 'Provider {error} Mac ⌘K /fictional';
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    for (const key of ['notSaved', 'notChanged']) assert.equal(editNotice(key, {error: raw}), catalogs[locale][key].replace('{error}', raw));
    for (const count of [0, 1, 2, 5, 21, 1000000]) {
      const form = new Intl.PluralRules(locale).select(count);
      assert.equal(editNotice('outlineChanged', {count}), catalogs[locale].outlineChanged[form].replace('{count}', String(count)));
    }
  }
});
