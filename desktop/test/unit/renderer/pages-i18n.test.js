// Dynamic page localization: catalog parity and explicit boundaries preserve applicant content.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const root = new URL('../../../', import.meta.url);
const locales = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];
const parameters = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('page catalogs provide seven real translations with matching interpolation', async () => {
  const dir = new URL('i18n/catalogs/pages/', root);
  const files = fs.readdirSync(dir).filter(file => file.endsWith('.js'));
  assert.ok(files.length);
  for (const file of files) {
    const {messages} = await import(new URL(file, dir));
    const keys = Object.keys(messages.en).sort();
    for (const locale of locales) {
      assert.deepEqual(Object.keys(messages[locale]).sort(), keys, `${file}: ${locale} keys`);
      for (const key of keys) {
        assert.equal(typeof messages[locale][key], 'string');
        assert.deepEqual(parameters(messages[locale][key]), parameters(messages.en[key]), `${locale}.${key}`);
        if (locale !== 'en') assert.notEqual(messages[locale][key], messages.en[key], `${locale}.${key}: real translation`);
      }
    }
  }
});

test('page display copy uses explicit keys while workflow identifiers remain unchanged', () => {
  const source = fs.readFileSync(new URL('renderer/pages/ready-pick.js', root), 'utf8');
  assert.match(source, /t\('pagesCommon\.cancel'\)/);
  assert.match(source, /codes: top\.picked\.slice\(0, count\)\.map\(job => job\.code\)/);
  assert.match(source, /el\('li', '', job\.name \|\| job\.code\)/);
  const actions = fs.readFileSync(new URL('renderer/pages/session-actions.js', root), 'utf8');
  assert.match(actions, /stage: 'Applied', status: 'applied'/);
  assert.match(actions, /result\?\.error \|\| t\('pagesCommon\.tryAgain'\)/);
});
