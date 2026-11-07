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

test('waiting profiles keep independent invocation languages and changing a saved choice changes only later copy', async t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: Date.parse('2026-11-07T12:00:00Z')});
  const settings = [{displayLanguage: 'de'}, {displayLanguage: 'ru'}], messages = [[], []];
  for (const index of [0, 1]) {
    const storage = {settings: () => settings[index], saveSettings: patch => Object.assign(settings[index], patch)};
    const sender = createWaitingMessage(storage, {channels: () => ['email'], sendEmail: async mail => {messages[index].push(mail); return true;}, sendTelegram: () => {throw new Error('no Telegram channel');}, log() {}});
    sender.add({id: `raw-${index}`, title: 'Raw title', company: 'Raw company', note: 'Raw note'});
  }
  settings[0].displayLanguage = 'fr'; setLocale('it');
  t.mock.timers.tick(WINDOW_MS); await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages[0][0].subject, '1 candidature vous attend'); assert.equal(messages[1][0].subject, '1 заявка ждёт вас');
});

test('desktop bot context uses the shared resolver and preserves all other environment fields without writes', async () => {
  const {telegramEnv} = await import('../../../lib/telegram.js');
  const forbidden = [], settings = {store: 'notion', telegramChatId: 'Original chat', notionIds: {NOTION_APPLICATIONS_DB: 'Original DB'}};
  const storage = {settings: () => settings, saveSettings: () => forbidden.push('write'), secret: key => {
    if (!['TELEGRAM_BOT_TOKEN', 'NOTION_TOKEN'].includes(key)) {forbidden.push(key); throw new Error('forbidden secret');}
    return `fixture:${key}`;
  }};
  setLocale('it');
  for (const [choice, expected] of [[undefined, 'en'], ['de-CH', 'de'], ['ru', 'ru'], ['system', 'it'], ['unsupported', 'en']]) {
    settings.displayLanguage = choice;
    const env = telegramEnv(storage);
    assert.equal(env.JOBADABRA_NOTIFICATION_LANGUAGE, expected); assert.equal(env.OWNER_CHAT_ID, 'Original chat');
    assert.equal(env.NOTION_APPLICATIONS_DB, 'Original DB'); assert.equal(env.TELEGRAM_BOT_TOKEN, 'fixture:TELEGRAM_BOT_TOKEN');
  }
  assert.deepEqual(forbidden, []);
});

test('pair confirmation takes only an explicit locale and retains recipient, acknowledgement and token boundaries', async t => {
  const {pair} = await import('../../../lib/telegram.js');
  t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-11-07T12:00:00Z')});
  const forbidden = [];
  for (const locale of locales) {
    const calls = [];
    const fetcher = async (url, init) => {
      if (!String(url).startsWith('https://api.telegram.org/botfixture/')) {forbidden.push(url); throw new Error('forbidden network');}
      const method = String(url).split('/').at(-1), body = JSON.parse(init.body); calls.push({method, body});
      const result = method === 'getMe' ? {username: 'fictional_bot'} : method === 'getUpdates' && calls.filter(item => item.method === method).length === 1
        ? [{update_id: 7, message: {chat: {id: 42, type: 'private'}, text: '/start'}}] : [];
      return new Response(JSON.stringify({ok: true, result}));
    };
    assert.deepEqual(await pair('fixture', 5, fetcher, locale), {chatId: '42', username: 'fictional_bot'});
    assert.deepEqual(calls.map(item => item.method), ['getMe', 'getUpdates', 'getUpdates', 'sendMessage']);
    assert.deepEqual(calls[2].body, {offset: 8, timeout: 0}); assert.equal(calls[3].body.chat_id, 42);
    assert.equal(calls[3].body.parse_mode, 'HTML'); assert.ok(calls[3].body.text.includes('/help'));
    if (locale !== 'en') assert.ok(!calls[3].body.text.includes('Jobadabra is connected'));
  }
  assert.deepEqual(forbidden, []);
});
