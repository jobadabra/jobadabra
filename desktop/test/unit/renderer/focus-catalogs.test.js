// Guard: data — every Focus/Jobs locale preserves named interpolation and resolves cached recipes without rewriting raw content.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {catalogs} from '../../../i18n/focus-cards.js';
import {setLocale, t} from '../../../i18n/index.js';
import {copyField, copyFields, copyMessage} from '../../../i18n/display-copy.js';

const placeholders = text => [...new Set(text.match(/\{[a-zA-Z][\w]*\}/g) || [])].sort();

test('all seven Focus catalogs cover the English keys and preserve placeholders in every plural variant', () => {
  const keys = Object.keys(catalogs.en).sort();
  assert.equal(keys.length, 291);
  for (const [locale, messages] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(messages).sort(), keys, locale);
    for (const key of keys) {
      const variants = typeof messages[key] === 'string' ? [messages[key]] : Object.values(messages[key]);
      if (typeof messages[key] !== 'string') assert.ok(messages[key].other, `${locale}/${key}: plural fallback`);
      for (const value of variants) {
        assert.ok(value.trim(), `${locale}/${key}: empty translation`);
        assert.deepEqual(placeholders(value), placeholders(catalogs.en[key]), `${locale}/${key}`);
      }
    }
  }
});

test('cached recipes follow each locale and preserve raw names, braces and markup at every count', tcase => {
  tcase.after(() => setLocale('en'));
  for (const [key, english] of Object.entries(catalogs.en)) {
    for (const count of [0, 1, 2, 5, 21, 101]) {
      const variables = Object.fromEntries(placeholders(english).map(name => [name.slice(1, -1), 'Raw English {count} <b>Ж</b>']));
      if (Object.hasOwn(variables, 'count')) variables.count = count;
      const payload = JSON.parse(JSON.stringify(copyFields({title: english, kind: 'reply'}, {
        title: copyMessage(`focusCards.${key}`, english, variables),
      })));
      const before = JSON.stringify(payload);
      for (const locale of Object.keys(catalogs)) {
        setLocale(locale);
        assert.equal(copyField(payload, 'title'), t(`focusCards.${key}`, variables));
        for (const value of Object.values(variables)) {
          assert.ok(copyField(payload, 'title').includes(String(value)), `${locale}/${key}: raw interpolation`);
        }
      }
      assert.equal(JSON.stringify(payload), before);
    }
  }
});
