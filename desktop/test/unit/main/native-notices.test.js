// Native notice constructors preserve consent safety, raw session content and complete catalog parity.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {SUPPORTED_LOCALES, setLocale} from '../../../i18n/index.js';
import {claudeConsentOptions, claudeOffText, stuckSessionNotice, focusReminderTitle, sessionInputNotice} from '../../../lib/native-notices.js';

afterEach(() => setLocale('en'));

test('remaining notices resolve at call time and preserve raw titles, companies and briefs', () => {
  const raw = '<Fictional {company}> ⌘K';
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    const consent = claudeConsentOptions();
    assert.deepEqual([consent.type, consent.defaultId, consent.cancelId, consent.buttons.length], ['warning', 1, 1, 2]);
    assert.ok(consent.detail.includes('Submit'), locale);
    assert.ok(consent.detail.includes('Claude'), locale);
    assert.ok(stuckSessionNotice({company: raw}).title.endsWith(` · ${raw}`));
    assert.ok(!stuckSessionNotice().title.includes(' · '));
    assert.equal(sessionInputNotice({title: raw, brief: raw}).body, raw);
    assert.ok(sessionInputNotice({title: raw}).title.endsWith(` · ${raw}`));
    for (const text of [consent.message, stuckSessionNotice().body, focusReminderTitle(), sessionInputNotice({title: raw}).body]) {
      assert.ok(text && !text.startsWith('nativeRemaining.'), locale);
    }
    if (locale !== 'en') assert.notEqual(consent.message, 'Let Claude work without asking before each step?');
  }
});

test('English consent keeps all permission and self-review warnings', () => {
  const options = claudeConsentOptions();
  assert.deepEqual(options.buttons, ['Allow', 'Cancel']);
  assert.match(options.detail, /It never clicks Submit: you review and submit yourself/);
  assert.match(options.detail, /Any other command it decides to run also runs without asking/);
  assert.match(options.detail, /your own Claude account and plan/);
  assert.match(options.detail, /watch its window/);
  assert.match(options.detail, /turn this off in Settings/);
});

test('all seven remaining catalogs have identical keys and interpolation parameters', async () => {
  const english = (await import('../../../i18n/catalogs/native/remaining-en.js')).default;
  const parameters = value => [...value.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(match => match[1]).sort();
  for (const locale of SUPPORTED_LOCALES) {
    const messages = (await import(`../../../i18n/catalogs/native/remaining-${locale}.js`)).default;
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(english).sort(), locale);
    for (const [key, value] of Object.entries(messages)) {
      assert.equal(typeof value, 'string');
      assert.ok(value.trim(), `${locale}.${key}`);
      assert.deepEqual(parameters(value), parameters(english[key]), `${locale}.${key}`);
      if (locale !== 'en') assert.notEqual(value, english[key], `${locale}.${key} must be translated`);
    }
  }
});

test('disabled Claude explanation is localized at invocation', () => {
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    const value = claudeOffText();
    assert.ok(value.includes('Claude') && value.includes('Chrome'), locale);
    assert.ok(!value.startsWith('nativeRemaining.'), locale);
    if (locale !== 'en') assert.notEqual(value, 'Apply with Claude is off. Use Fill in Chrome, or allow it next time.');
  }
});
