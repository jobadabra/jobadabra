// Screen localization preserves complete locale coverage, interpolation and the setup's existing controls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const html = fs.readFileSync(new URL('../../../renderer/index.html', import.meta.url), 'utf8');
const locales = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];

test('setup text and accessible attributes opt in without replacing their interactive parents', () => {
  assert.ok(/data-i18n="screenWelcome\.welcome"/.test(html), 'welcome has an explicit translation slot');
  assert.ok(/data-i18n-aria-label="screenCommon\.close"/.test(html), 'close has a translated accessible name');
  assert.ok(/<button[^>]+id="wizard-exit"[^>]*><i data-icon="undo"><\/i><span data-i18n=/.test(html), 'the back button keeps its icon');
  assert.ok(/id="anthropic-key"[^>]+type="password"/.test(html), 'the API key stays a password input');
});

test('every screen catalog supplies all seven locales and keeps the same named variables', async () => {
  const folder = new URL('../../../i18n/catalogs/screens/', import.meta.url);
  const files = fs.readdirSync(folder).filter(file => file.endsWith('.js'));
  assert.ok(files.length > 0);
  const namespaces = new Set();
  for (const file of files) {
    const {default: {namespace, messages}} = await import(new URL(file, folder));
    assert.ok(!namespaces.has(namespace), `duplicate namespace ${namespace}`);
    namespaces.add(namespace);
    for (const [key, values] of Object.entries(messages)) {
      assert.equal(values.length, locales.length, `${namespace}.${key}`);
      const forms = value => typeof value === 'string' ? [value] : Object.values(value);
      const vars = value => [...new Set(forms(value).flatMap(text => [...text.matchAll(/\{([a-zA-Z]\w*)\}/g)].map(match => match[1])))].sort();
      values.forEach((value, index) => {
        assert.ok(forms(value).every(text => typeof text === 'string' && text.length > 0), `${namespace}.${key}: ${locales[index]}`);
        assert.deepEqual(vars(value), vars(values[0]), `${namespace}.${key}: ${locales[index]} variables`);
      });
    }
  }
});
