// Report display catalogs align six translated locales while English keeps canonical source diagnostics as fallback.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SUPPORTED_LOCALES} from '../../../i18n/index.js';
const catalogs = Object.fromEntries(await Promise.all(SUPPORTED_LOCALES.map(async locale => [locale, (await import(`../../../i18n/catalogs/report-notices/${locale}.js`)).default])));
const params = text => [...text.matchAll(/\{([A-Za-z][\w]*)\}/g)].map(match => match[1]).sort();

test('English has no duplicated diagnostic templates and six locales align all five display notices', () => {
  assert.deepEqual(catalogs.en, {});
  const keys = ['dailyLimit', 'noToken', 'notAccepted', 'notRegular', 'tooLarge'];
  for (const locale of SUPPORTED_LOCALES.filter(locale => locale !== 'en')) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), keys, locale);
    for (const key of keys) {
      assert.equal(typeof catalogs[locale][key], 'string');
      assert.deepEqual(params(catalogs[locale][key]), key === 'notAccepted' ? ['status'] : [], `${locale}.${key}`);
    }
  }
});
