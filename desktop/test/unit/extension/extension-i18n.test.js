// Verify bundled extension display languages without touching app state, browser profiles or networks.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createI18n, catalogs, locales} from '../../../../extension/i18n.js';

test('default English, inherited switches, offline cache and explicit override', async () => {
  let stored = {};
  const storage = {get: async () => ({...stored}), set: async value => Object.assign(stored, value)};
  const i18n = await createI18n(storage);
  assert.equal(i18n.locale(), 'en');
  await i18n.desktop('ro'); assert.equal(i18n.locale(), 'ro');
  await i18n.desktop('ru'); assert.equal(i18n.locale(), 'ru');
  await i18n.preference('de'); await i18n.desktop('fr'); assert.equal(i18n.locale(), 'de');
  await i18n.preference('desktop'); assert.equal(i18n.locale(), 'fr');
  const offline = await createI18n(storage); assert.equal(offline.locale(), 'fr');
  await offline.desktop(undefined); assert.equal(offline.locale(), 'en');
  await offline.desktop('invalid'); assert.equal(offline.locale(), 'en');
  stored = {extensionLanguage:'invalid', desktopDisplayLocale:'invalid'};
  assert.equal((await createI18n(storage)).locale(), 'en');
});

test('all seven catalogs have identical keys and interpolation parameters', () => {
  const keys = Object.keys(catalogs.en).sort();
  assert.equal(locales.length, 7);
  const params = value => [...JSON.stringify(value).matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter((v,i,a) => a.indexOf(v) === i).sort();
  for (const locale of locales) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), keys, locale);
    for (const key of keys) assert.deepEqual(params(catalogs[locale][key]), params(catalogs.en[key]), `${locale}.${key}`);
  }
});

test('interpolation is single-pass plain text and preserves external content; locale plural/number/date rules', async () => {
  const i18n = await createI18n({get:async()=>({}),set:async()=>{}});
  const external = '<img src=x onerror=bad> {pages}';
  assert.ok(i18n.t('reading', {name:external,pages:1,jobs:2}).includes(external));
  await i18n.preference('ru');
  assert.match(i18n.t('pages',{count:2}), /страницы/);
  assert.match(i18n.t('pages',{count:5}), /страниц/);
  await i18n.preference('ro'); assert.match(i18n.t('pages',{count:2}), /pagini/);
  assert.equal(i18n.number(1234.5), new Intl.NumberFormat('ro').format(1234.5));
  assert.equal(i18n.date(0,{timeZone:'UTC'}),new Intl.DateTimeFormat('ro',{timeZone:'UTC'}).format(0));
});
