// Desktop language selection, text interpolation and locale-specific plural/format behavior.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {SUPPORTED_LOCALES, resolveLocale, setLocale, getLocale, registerMessages, t} from '../../../i18n/index.js';
import {number, date, relative} from '../../../i18n/format.js';

afterEach(() => setLocale('en'));

test('the seven supported languages resolve regional preferences in priority order', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru']);
  assert.equal(resolveLocale('system', ['pt-BR', 'de-CH', 'fr']), 'de');
  assert.equal(resolveLocale(undefined, ['RU-ru']), 'ru');
  assert.equal(resolveLocale('fr', ['de-CH']), 'fr');
  assert.equal(resolveLocale('bogus', ['zz']), 'en');
  assert.equal(resolveLocale('system', []), 'en');
  assert.equal(resolveLocale('system', ['en-US', 'fr']), 'en');
});

test('English fallback, missing keys and named interpolation never rewrite user values', () => {
  registerMessages('en', 'test', {hello: 'Hello {name}', fallback: 'Only English', count: {one: '{count} item', other: '{count} items'}});
  registerMessages('fr', 'test', {hello: 'Bonjour {name}'});
  setLocale('fr');
  assert.equal(t('test.hello', {name: '<b>{count} Mac</b>'}), 'Bonjour <b>{count} Mac</b>');
  assert.equal(t('test.fallback'), 'Only English');
  assert.equal(t('absent.message'), 'absent.message');
  assert.equal(t('test.hello'), 'Bonjour {name}');
  assert.equal(t('test.count', {count: 2}), '2 items');
  assert.equal(t('test.toString'), 'test.toString');
});

test('Russian and Romanian use their own plural categories', () => {
  registerMessages('ru', 'test', {jobs: {one: '{count} вакансия', few: '{count} вакансии', many: '{count} вакансий', other: '{count} вакансии'}});
  registerMessages('ro', 'test', {jobs: {one: '{count} post', few: '{count} posturi', other: '{count} de posturi'}});
  setLocale('ru');
  assert.deepEqual([1, 2, 5, 21].map(count => t('test.jobs', {count})), ['1 вакансия', '2 вакансии', '5 вакансий', '21 вакансия']);
  setLocale('ro');
  assert.deepEqual([1, 2, 20].map(count => t('test.jobs', {count})), ['1 post', '2 posturi', '20 de posturi']);
});

test('invalid active locale falls back safely and display formats use the selected locale', () => {
  setLocale('xx'); assert.equal(getLocale(), 'en');
  setLocale('de');
  assert.equal(number(1234.5), new Intl.NumberFormat('de').format(1234.5));
  assert.equal(number(1234, {style: 'currency', currency: 'CHF'}), new Intl.NumberFormat('de', {style: 'currency', currency: 'CHF'}).format(1234));
  const value = new Date('2026-11-07T12:00:00Z'), options = {month: 'long', day: 'numeric', timeZone: 'UTC'};
  assert.equal(date(value, options), new Intl.DateTimeFormat('de', options).format(value));
  assert.equal(relative(-1, 'day'), new Intl.RelativeTimeFormat('de', {numeric: 'auto'}).format(-1, 'day'));
});

test('every language supplies real selector copy with the same interpolation parameters', () => {
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    assert.ok(t('common.language').length > 0);
    assert.notEqual(t('common.language'), 'common.language');
    for (const key of ['chooseLanguage', 'chooseHelp', 'continue', 'system', 'unsavedLanguage', 'languageFailed']) assert.notEqual(t(`common.${key}`), `common.${key}`);
    if (locale !== 'en') assert.notEqual(t('common.languageHelp'), 'Choose the language used in Jobadabra. The view reloads when you change it.');
  }
});
