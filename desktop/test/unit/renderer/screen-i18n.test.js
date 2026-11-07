// Screen localization preserves complete locale coverage, interpolation and the setup's existing controls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {readScreenSource} from '../../static-screen-source.js';

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

test('every static binding resolves through the same loader used before renderer startup', async () => {
  await import('../../../i18n/screens.js');
  const {setLocale, t} = await import('../../../i18n/index.js');
  const keys = [...new Set([...html.matchAll(/data-i18n(?:-[\w-]+)?="([^"]+)"/g)].map(match => match[1]))];
  assert.ok(keys.length > 0);
  try {
    for (const locale of locales) {
      setLocale(locale);
      for (const key of keys) assert.notEqual(t(key), key, `${locale}: unregistered ${key}`);
    }
  } finally { setLocale('en'); }
});

test('text bindings are leaves so translating them cannot erase nested links, icons or controls', () => {
  const slots = [...html.matchAll(/<([a-z][\w-]*)\b[^>]* data-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/gi)];
  assert.ok(slots.length > 0);
  for (const [, , key, text] of slots) assert.ok(!/<[a-z]/i.test(text), `${key} contains a child element`);
  const english = readScreenSource(new URL('../../../renderer/index.html', import.meta.url), 'utf8');
  assert.ok(!english.includes('data-i18n'), 'the source guards see only fallback markup');
  assert.ok(english.includes('<span data-notion-only> and in your Notion</span>'), 'inline spacing and original visibility stay intact');
});

test('Windows static copy uses explicit localized PC and credential-storage wording', async () => {
  const oldWindow = globalThis.window;
  const {setLocale, t} = await import('../../../i18n/index.js');
  try {
    globalThis.window = {pilot: {platform: 'win32'}};
    await import('../../../i18n/screens.js?platform=windows');
    setLocale('en');
    assert.equal(t('screenWelcome.privacy'), 'Passwords and keys are encrypted in Windows Credential Manager. While Always on is off, your data stays on this PC.');
    setLocale('ru');
    assert.equal(t('screenWelcome.staysMac'), 'Остаётся на этом ПК');
    assert.equal(t('screenStaticConnections.text542'), 'Показать в проводнике');
    assert.ok(t('screenWelcome.privacy').includes('Диспетчере учётных данных Windows'));
  } finally {
    globalThis.window = oldWindow;
    await import('../../../i18n/screens.js?platform=restore');
    setLocale('en');
  }
});
