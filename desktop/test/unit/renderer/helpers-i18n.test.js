// Helper catalogs keep seven real translations and preserve named interpolation boundaries.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const root = new URL('../../../', import.meta.url);
const locales = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];
const catalog = locale => import(new URL(`i18n/catalogs/helpers/${locale}.js`, root));
const parameters = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('helper messages have seven complete catalogs with matching named parameters', async () => {
  const {messages: english} = await catalog('en');
  assert.ok(Object.keys(english).length >= 50);
  for (const locale of locales) {
    const {messages} = await catalog(locale);
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(english).sort(), locale);
    for (const [key, value] of Object.entries(messages)) {
      assert.equal(typeof value, 'string', `${locale}.${key}`);
      assert.ok(value.trim(), `${locale}.${key}`);
      assert.deepEqual(parameters(value), parameters(english[key]), `${locale}.${key}`);
    }
  }
});

test('every migrated helper lookup is registered and user content stays outside the catalog', async () => {
  const {messages} = await catalog('en');
  const files = fs.readdirSync(new URL('renderer/job-drawer/', root)).filter(file => file.endsWith('.js')).map(file => `renderer/job-drawer/${file}`);
  files.push(...fs.readdirSync(new URL('renderer/', root)).filter(file => file.endsWith('.js')).map(file => `renderer/${file}`));
  let count = 0;
  for (const file of files) {
    const source = fs.readFileSync(new URL(file, root), 'utf8');
    for (const match of source.matchAll(/t\('helpers\.([^']+)'/g)) {
      assert.ok(match[1] in messages, `${file}: ${match[1]}`);
      count++;
    }
  }
  assert.ok(count >= 50, `only ${count} localized helper lookups`);
  const rows = fs.readFileSync(new URL('renderer/job-drawer/documents-rows.js', root), 'utf8');
  assert.match(rows, /document\.createTextNode\(part\)/);
});
