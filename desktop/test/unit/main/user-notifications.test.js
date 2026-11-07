// End-user notifications use each profile's explicit language while raw values and channel/time identities remain unchanged.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {createWaitingMessage, WINDOW_MS} from '../../../lib/waiting-message.js';
import {words} from '../../../lib/few-jobs.js';
import {setLocale} from '../../../i18n/index.js';
const locales = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];
const prefixes = ['1 application', '1 Bewerbung', '1 candidature', '1 candidatura', '1 solicitud', '1 candidatură', '1 заявка'];
afterEach(() => setLocale('en'));

for (const [index, locale] of locales.entries()) test(`actual waiting producer ${locale} keeps raw content, links, cap and channel payloads`, async t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: Date.parse('2026-11-07T12:00:00Z')});
  const settings = {displayLanguage: locale}, sent = {email: [], telegram: []}, forbidden = [];
  const oldFetch = globalThis.fetch; globalThis.fetch = async () => {forbidden.push('network'); throw new Error('forbidden network');};
  try {
    setLocale('es');
    const storage = {settings: () => settings, saveSettings: patch => Object.assign(settings, patch), secret: () => {forbidden.push('secret'); throw new Error('forbidden secret');}};
    const sender = createWaitingMessage(storage, {channels: () => ['email', 'telegram'],
      sendEmail: async mail => {sent.email.push(mail); return true;}, sendTelegram: async text => {sent.telegram.push(text); return true;}, log() {}});
    const item = {id: 'raw {id}', title: 'Raw <Role> this Mac', company: 'Raw & Company', note: 'Raw Keychain ⌘K {note}'};
    sender.add(item); t.mock.timers.tick(WINDOW_MS); await new Promise(resolve => setImmediate(resolve));
    assert.ok(sent.email[0].subject.startsWith(prefixes[index]), sent.email[0].subject);
    assert.ok(sent.email[0].text.includes(item.title)); assert.ok(sent.email[0].text.includes(item.company)); assert.ok(sent.email[0].text.includes(item.note));
    assert.equal(sent.email[0].buttons[0].url, 'https://www.jobadabra.top/open?view=sessions');
    assert.equal(sent.telegram.length, 1); assert.equal(settings.waitingMessageAt, '2026-11-07T12:01:00.000Z');
    assert.deepEqual(Object.keys(settings).sort(), ['displayLanguage', 'waitingMessageAt']);
    assert.deepEqual(forbidden, []);
  } finally {globalThis.fetch = oldFetch;}
});

test('few-job outbound words use explicit languages and preserve raw source counts', () => {
  const titles = ['Few new jobs', 'Wenige neue Stellen', 'Peu de nouvelles offres', 'Poche nuove offerte', 'Pocas ofertas nuevas', 'Puține locuri de muncă noi', 'Мало новых вакансий'];
  const found = {runId: 'Original {id}', counts: [2]};
  for (const [index, locale] of locales.entries()) {
    const view = words(found, locale); assert.ok(view.title.startsWith(titles[index]), view.title);
    assert.ok(view.telegram.includes('Jobadabra')); assert.ok(view.telegram.includes('2')); assert.equal(found.counts[0], 2);
  }
  assert.deepEqual(words(found, 'unsupported'), words(found));
});
