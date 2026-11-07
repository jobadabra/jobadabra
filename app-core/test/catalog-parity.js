// Shared test assertion for independent bundled catalogs: keys, interpolation names and every language plural category must align.
import assert from 'node:assert/strict';
const names = value => [...new Set(String(value).match(/\{[A-Za-z][\w]*\}/g) || [])].sort();
/** Load each actual catalog and assert English key/value-shape parity plus complete locale plural categories; performs no runtime rendering. */
export async function assertCatalogs(locales, load) {
  const english = (await load('en')).default;
  for (const locale of locales) {
    const messages = (await load(locale)).default;
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(english).sort());
    for (const [key, value] of Object.entries(messages)) {
      const base = typeof english[key] === 'string' ? english[key] : english[key].other;
      for (const form of typeof value === 'string' ? [value] : Object.values(value)) {
        assert.deepEqual(names(form), names(base), `${locale}/${key}`); assert.ok(form.length > 0);
      }
      if (typeof value === 'object') for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) assert.ok(value[category], `${locale}/${key}/${category}`);
    }
  }
}
