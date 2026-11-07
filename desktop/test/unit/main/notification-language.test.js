// Notification language derives only from the authoritative saved appearance choice and resolved system locale.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {setLocale} from '../../../i18n/index.js';
import {notificationLanguage} from '../../../lib/notification-language.js';
afterEach(() => setLocale('en'));

test('explicit saved choice wins over process locale, while system uses its current resolution', () => {
  setLocale('de');
  for (const language of ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru']) {
    assert.equal(notificationLanguage({settings: () => ({displayLanguage: language})}), language);
  }
  assert.equal(notificationLanguage({settings: () => ({displayLanguage: 'system'})}), 'de');
  setLocale('ru');
  assert.equal(notificationLanguage({settings: () => ({displayLanguage: 'system'})}), 'ru');
});

test('fresh or invalid preferences stay English without reading secrets or modifying settings', () => {
  setLocale('ru');
  for (const displayLanguage of [undefined, null, 'xx', '']) {
    const storage = {settings: () => ({displayLanguage}), secret: () => assert.fail('no secrets'), saveSettings: () => assert.fail('no writes')};
    assert.equal(notificationLanguage(storage), 'en');
  }
});
