// Reviewed Windows messages cover each display language without rewriting personal interpolation values or Mac copy.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import '../../../i18n/screens-helpers.js';
import '../../../i18n/screens-pages.js';
import windowsTemplates from '../../../i18n/catalogs/windows-platform.js';
import {osText} from '../../../i18n/platform.js';
import {guide} from '../../../renderer/ai-plan-guide.js';
import {SUPPORTED_LOCALES, setLocale, t} from '../../../i18n/index.js';

afterEach(() => setLocale('en'));

test('device copy is Windows-specific in every locale, with personal engine names unchanged', () => {
  const raw = 'Fictional this Mac Keychain ⌘K {engine}';
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    const missing = t('helperMore.notInstalledMac', {}, 'win32');
    assert.notEqual(missing, 'helperMore.notInstalledMac', locale);
    assert.doesNotMatch(missing, /\bMac\b/, locale);
    const cloud = t('helperMore.githubOwnKeyWhy', {engine: raw}, 'win32');
    assert.ok(cloud.includes(raw), locale);
    assert.doesNotMatch(cloud.replaceAll(raw, ''), /\bMac\b/, locale);
  }
});

test('Mac messages retain their existing wording when Windows variants are available', () => {
  setLocale('en');
  assert.match(t('helpers.terminal', {}, 'darwin'), /⌘/);
  assert.doesNotMatch(t('helpers.terminal', {}, 'darwin'), /PowerShell/);
  setLocale('ru');
  assert.match(t('helperMore.notInstalledMac', {}, 'darwin'), /Mac/);
});


test('reviewed Windows variants preserve catalog parameters and leave all inserted values untouched', () => {
  const parameters = value => [...new Set([...value.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(match => match[1]))].sort();
  const raw = 'Fictional this Mac Keychain ⌘K {variable}';
  for (const [key, variants] of Object.entries(windowsTemplates)) {
    assert.equal(variants.length, SUPPORTED_LOCALES.length, key);
    setLocale('en');
    const original = t(key, {}, 'darwin');
    assert.notEqual(original, key, 'variant keys must refer to existing app-authored messages');
    const names = parameters(original), values = Object.fromEntries(names.map(name => [name, raw]));
    for (const [column, locale] of SUPPORTED_LOCALES.entries()) {
      setLocale(locale);
      assert.deepEqual(parameters(variants[column] ?? t(key, {}, 'darwin')), names, `${key}/${locale}`);
      const rendered = t(key, values, 'win32');
      if (names.length) assert.ok(rendered.includes(raw), `${key}/${locale}`);
      assert.doesNotMatch(rendered.replaceAll(raw, ''), /\bMac\b|Keychain|⌘/, `${key}/${locale}`);
      assert.equal(t(key, {}, 'darwin'), t(key, {}, 'linux'), 'explicit Windows variants never rewrite another platform');
    }
  }
});

test('genuine Mac-only instructions are kept when shown as an explanation on Windows', () => {
  setLocale('en');
  assert.match(t('pagesAuditThird.a194', {}, 'win32'), /can only be asked of a Mac/);
});


test('the real AI guide keeps its existing Windows shell selector instead of translating a Mac-only hint', () => {
  assert.equal(Object.hasOwn(windowsTemplates, 'helpers.terminal'), false);
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    assert.match(guide('app-only', {platform: 'win32'}).steps[0], /PowerShell/, locale);
  }
});

test('Windows storage wording retains each locale’s established Always on feature name', () => {
  const names = ['Always on', 'Immer an', 'Toujours actif', 'Sempre attivo', 'Siempre activo', 'Mereu activ', 'постоянная работа'];
  for (const [column, locale] of SUPPORTED_LOCALES.entries()) {
    setLocale(locale);
    assert.ok(t('pagesDynamicSessionReports.m382', {}, 'win32').includes(names[column]), locale);
  }
});

test('English Windows overrides only exist when they differ from the canonical catalog formatter', () => {
  setLocale('en');
  for (const [key, variants] of Object.entries(windowsTemplates)) {
    if (variants[0] !== null) assert.notEqual(variants[0], osText(t(key, {}, 'darwin'), 'win32'), key);
  }
});
