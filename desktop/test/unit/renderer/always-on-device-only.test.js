// The Always on card's "this computer only" rows: every row has its words in all 7 languages, and none promises a Mac or a cloud read (owner, 13 Nov 2026: sign-ins stay on the computer).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ROWS} from '../../../renderer/always-on-device-only-words.js';

const LANGS = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];
const catalogs = Object.fromEntries(await Promise.all(LANGS.map(async lang =>
  [lang, (await import(`../../../i18n/catalogs/helpers/${lang}-more.js`)).messages])));
const keys = ['deviceOnlyLead', 'deviceOnlyPill', ...ROWS.flatMap(([, , title, line]) => [title, line])];

test('LinkedIn sign-in and Gmail & Calendar are the rows, in that order', () => {
  assert.deepEqual(ROWS.map(([id]) => id), ['linkedin', 'google']);
});

test('every row word exists in all 7 languages, and the reason names security', () => {
  for (const lang of LANGS) for (const key of keys) assert.ok(catalogs[lang][key]?.trim(), `${lang}.${key}`);
  for (const [, , , line] of ROWS) assert.match(catalogs.en[line], /^For your security, .* never leaves this computer/);
});

test('the words say "this computer", never "this Mac" (the app runs on Windows too)', () => {
  for (const lang of LANGS) for (const key of keys) assert.doesNotMatch(catalogs[lang][key], /\bMac\b/, `${lang}.${key}`);
});
