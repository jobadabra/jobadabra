// CV display catalogs keep all seven message/parameter sets aligned without changing document-language contracts.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import fs from 'node:fs';
import {setLocale, SUPPORTED_LOCALES} from '../../../i18n/index.js';
import {cvNotice} from '../../../i18n/cv-notices.js';
const catalogs = Object.fromEntries(await Promise.all(SUPPORTED_LOCALES.map(async locale => [locale, (await import(`../../../i18n/catalogs/cv-notices/${locale}.js`)).default])));
const params = text => [...text.matchAll(/\{([A-Za-z][\w]*)\}/g)].map(match => match[1]).sort();
afterEach(() => setLocale('en'));

test('seven bundled catalogs have real translations and identical keys/parameters', () => {
  const keys = Object.keys(catalogs.en).sort();
  assert.equal(keys.length, 13);
  for (const [locale, messages] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(messages).sort(), keys, locale);
    for (const key of keys) {
      assert.equal(typeof messages[key], 'string');
      assert.deepEqual(params(messages[key]), params(catalogs.en[key]), `${locale}.${key}`);
      if (locale !== 'en') assert.notEqual(messages[key], catalogs.en[key], `${locale}.${key} is translated`);
    }
  }
});

test('catalog registration is standalone and interpolation is single-pass for every locale', () => {
  const raw = 'Provider {provider} {error} Mac ⌘K';
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    assert.equal(cvNotice('readFailed', {error: raw}), catalogs[locale].readFailed.replace('{error}', raw));
    assert.equal(cvNotice('refused', {provider: raw}), catalogs[locale].refused.replace('{provider}', raw));
    assert.equal(cvNotice('maxJobs', {limit: 8}), catalogs[locale].maxJobs.replace('{limit}', '8'));
  }
});

test('document prompts, periods and model schema remain outside the display catalogs', () => {
  const source = fs.readFileSync(new URL('../../../lib/cv-build.js', import.meta.url), 'utf8');
  assert.match(source, /Write in the language of their answers\./);
  assert.match(source, /text\(from\) \? 'Present' : ''/);
  assert.match(source, /required: \['summary', 'roles', 'skills'\]/);
  assert.ok(!Object.values(catalogs.en).some(text => text === 'Present'));
});
