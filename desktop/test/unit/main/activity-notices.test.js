// Activity notice catalogs preserve plural forms, safety guidance and raw values without changing producer decisions.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {SUPPORTED_LOCALES, setLocale} from '../../../i18n/index.js';
import {activityText, activityHandoff} from '../../../i18n/activity-notices.js';

afterEach(() => setLocale('en'));

test('activity notices follow the current locale and interpolate raw values exactly once', () => {
  const raw = 'Fictional {title} this Mac Keychain ⌘K <name>';
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    for (const count of [0, 1, 2, 5, 21, 101, 1000000]) {
      const title = activityText('remembered', {count});
      assert.ok(title.includes(String(count)), `${locale}:${count}`);
      assert.ok(!title.startsWith('activityNotice.'), locale);
    }
    assert.ok(activityText('transcriptBody', {title: raw}).startsWith(raw), locale);
    assert.ok(activityText('overnight', {count: 2, left: ''}).includes('Submit'), locale);
    assert.ok(activityText('readyBody').includes('Submit'), locale);
    if (locale !== 'en') assert.notEqual(activityText('needsYou'), 'Application needs you');
  }
});

test('catalog keys and parameters match English, with every locale plural category present', async () => {
  const english = (await import('../../../i18n/catalogs/activity-notices/en.js')).default;
  const variables = value => [...value.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(match => match[1]).sort();
  for (const locale of SUPPORTED_LOCALES) {
    const messages = (await import(`../../../i18n/catalogs/activity-notices/${locale}.js`)).default;
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(english).sort(), locale);
    for (const [key, value] of Object.entries(messages)) {
      const source = typeof english[key] === 'string' ? english[key] : english[key].other;
      if (typeof value === 'object') assert.deepEqual(Object.keys(value).sort(), new Intl.PluralRules(locale).resolvedOptions().pluralCategories.sort(), `${locale}.${key}`);
      for (const text of typeof value === 'string' ? [value] : Object.values(value)) {
        assert.ok(text.trim()); assert.deepEqual(variables(text), variables(source), `${locale}.${key}`);
        if (locale !== 'en') assert.notEqual(text, source, `${locale}.${key}`);
      }
    }
  }
});

test('native handoff reasons map only to display templates and preserve both fallback meanings', () => {
  const reasons = {captcha_preflight: 'captchaPreflight', captcha_runtime: 'captchaRuntime', stopped: 'stopped',
    submission_outcome_unknown: 'outcomeUnknown', app_closed: 'appClosed', app_updated: 'appUpdated'};
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    for (const [reason, key] of Object.entries(reasons)) assert.equal(activityHandoff(reason), activityText(key));
    assert.equal(activityHandoff('fictional_unknown'), activityText('reviewSelf'));
    assert.equal(activityHandoff('fictional_unknown', 'outcomeUnknown'), activityText('outcomeUnknown'));
  }
});
