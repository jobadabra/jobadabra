// Actual bot entry points select explicit end-user languages without changing commands, callbacks, raw values or authorization.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertCatalogs} from './catalog-parity.js';
import {handleCommand, handleUpdate, withActionRow, withOutcomeRows} from '../src/index.js';
const locales = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];
const headings = ['Commands', 'Befehle', 'Commandes', 'Comandi', 'Comandos', 'Comenzi', 'Команды'];
for (const [index, locale] of locales.entries()) test(`actual user bot ${locale} localizes help and keeps exact command and button IDs`, async () => {
  const dispatched = [], env = {JOBADABRA_NOTIFICATION_LANGUAGE: locale, dispatch: async (...args) => dispatched.push(args)};
  const help = await handleCommand(env, {name: 'help'}); assert.ok(help.includes(headings[index]), help);
  for (const command of ['/check', '/today', '/saved', '/applied', '/add', '/mail', '/weekly', '/status', '/interview']) assert.ok(help.includes(command), command);
  await handleCommand(env, {name: 'run'}); assert.deepEqual(dispatched, [[{mode: 'run'}, undefined]]);
  const row = withActionRow(null, 'ab12cd34', '3', env);
  assert.deepEqual(row.inline_keyboard.flat().map(button => button.callback_data), ['act:a:ab12cd34:3', 'act:s:ab12cd34:3', 'act:d:ab12cd34:3', 'close', 'act:p:ab12cd34:3']);
  const outcomes = withOutcomeRows(null, '3', '0'.repeat(32), env);
  assert.equal(outcomes.inline_keyboard[0][1].callback_data, `out:c:${'0'.repeat(32)}:3`);
});

test('operator and CI contexts stay English regardless of unrelated user languages', async () => {
  const translated = await handleCommand({JOBADABRA_NOTIFICATION_LANGUAGE: 'de'}, {name: 'help'});
  assert.ok(translated.includes('Befehle'));
  for (const value of [undefined, '', 'xx', 'system']) {
    const env = value === undefined ? {} : {JOBADABRA_NOTIFICATION_LANGUAGE: value};
    assert.ok((await handleCommand(env, {name: 'help'})).includes('Commands'));
  }
});

test('callback authorization remains exact and no unapproved recipient is contacted', async () => {
  const calls = [], previous = globalThis.fetch;
  globalThis.fetch = async (...args) => {calls.push(args); throw new Error('forbidden live transport');};
  try {
    await handleUpdate({OWNER_CHAT_ID: '42', JOBADABRA_NOTIFICATION_LANGUAGE: 'ru'}, {callback_query: {id: 'raw', data: 'act:a:ab12cd34:3', message: {chat: {id: 'other'}}}});
    assert.deepEqual(calls, []);
  } finally {globalThis.fetch = previous;}
});


test('actual list formatters localize authored wrappers and preserve escaped content and data', async () => {
  const {formatAppliedItems, formatSavedItems, formatRunItems} = await import('../src/format.js');
  const headings = ['Applications', 'Bewerbungen', 'Candidatures', 'Candidature', 'Solicitudes', 'Candidaturi', 'Отклики'];
  const item = {id: 'Original id', title: 'Raw <Role> {title}', company: 'Raw & Co', stage: 'Offer', url: 'https://fictional.test/?x=1&y=2', applied_on: '2026-11-07', next_interview: '2026-11-08T12:00:00Z'};
  for (const [index, locale] of locales.entries()) {
    const env = {JOBADABRA_NOTIFICATION_LANGUAGE: locale}, wire = JSON.stringify(item);
    const text = formatAppliedItems([item], '', env);
    assert.ok(text.includes(headings[index]), text);
    assert.ok(text.includes('Raw &lt;Role&gt; {title}')); assert.ok(text.includes('Raw &amp; Co')); assert.ok(text.includes('https://fictional.test/?x=1&amp;y=2'));
    assert.ok(text.includes('2026-11-07')); assert.ok(text.includes('2026-11-08 · 12:00'));
    assert.equal(JSON.stringify(item), wire);
    const saved = formatSavedItems([item], '', env); assert.ok(saved.includes('Raw &lt;Role&gt; {title}'));
    const run = formatRunItems([{mode: 'Original mode', summary: 'Raw <summary> {data}', started: '2026-11-07T12:00Z'}], env);
    assert.ok(run.includes('Original mode')); assert.ok(run.includes('Raw &lt;summary&gt; {data}'));
    if (locale !== 'en') assert.ok(!run.includes('Recent runs'), run);
  }
});

test('concurrent users keep independent locales across asynchronous reads while operator output stays English', async () => {
  let release;
  const held = new Promise(resolve => {release = resolve;});
  const first = handleCommand({JOBADABRA_NOTIFICATION_LANGUAGE: 'de', store: {runs: async () => {await held; return [];}}}, {name: 'status'});
  const russian = await handleCommand({JOBADABRA_NOTIFICATION_LANGUAGE: 'ru', store: {runs: async () => []}}, {name: 'status'});
  assert.equal(russian, 'Запусков пока нет.');
  assert.equal(await handleCommand({store: {runs: async () => []}}, {name: 'status'}), 'No runs yet.');
  release(); assert.equal(await first, 'Noch keine Läufe.');
});

test('actual callbacks retain canonical outcomes, dispatch inputs, raw titles, recipients and keyboard IDs', async () => {
  const previous = globalThis.fetch, requests = [], forbidden = [], writes = [];
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.telegram.org/botfixture/')) {forbidden.push(url); throw new Error('forbidden network');}
    requests.push({method: String(url).split('/').at(-1), body: JSON.parse(init.body)});
    return new Response(JSON.stringify({ok: true}), {status: 200});
  };
  try {
    for (const locale of locales) {
      const dispatched = [], env = {JOBADABRA_NOTIFICATION_LANGUAGE: locale, TELEGRAM_BOT_TOKEN: 'fixture', OWNER_CHAT_ID: '42',
        dispatch: async (...args) => dispatched.push(args), store: {recordOutcome: async (...args) => {writes.push(args); return 'Raw <Role> {name}';}, insightFeedback: async (...args) => writes.push(args)}};
      const callback = data => handleUpdate(env, {callback_query: {id: 'Original callback', data,
        message: {chat: {id: 42}, message_id: 7, reply_markup: {inline_keyboard: [[{text: 'Original raw label', callback_data: 'pick:ab12cd34:3'}]]}}}});
      await callback('act:s:ab12cd34:3'); assert.deepEqual(dispatched[0], [{mode: 'apply', job: 'ab12cd34', action: 'saved'}, undefined]);
      await callback(`out:o:${'0'.repeat(32)}:3`); assert.deepEqual(writes.at(-1), ['0'.repeat(32), 'Offer']);
      const outcome = requests.filter(item => item.method === 'answerCallbackQuery').at(-1);
      assert.equal(outcome.body.callback_query_id, 'Original callback'); assert.ok(outcome.body.text.includes('Raw <Role> {name}'));
      assert.equal(outcome.body.show_alert, false);
      await callback(`ins:u:${'0'.repeat(32)}`); assert.deepEqual(writes.at(-1), ['0'.repeat(32), 'Useful']);
      const edited = requests.filter(item => item.method === 'editMessageReplyMarkup').at(-1);
      assert.equal(edited.body.chat_id, 42); assert.equal(edited.body.message_id, 7);
      assert.equal(edited.body.reply_markup.inline_keyboard[0][0].callback_data, 'noop');
    }
    assert.deepEqual(forbidden, []);
  } finally {globalThis.fetch = previous;}
});

test('interview and add entry points retain raw payloads and escape names once without new I/O', async () => {
  const {handleInterview, handleAdd, handleScreenshot} = await import('../src/index.js');
  for (const locale of locales) {
    const calls = [], env = {JOBADABRA_NOTIFICATION_LANGUAGE: locale, dispatch: async (...args) => calls.push(args)};
    const file = {file_id: 'Original {file}', file_name: '<Raw & title>.txt', file_size: 24};
    const text = await handleInterview(env, {document: file, caption: 'Original <caption> {note}'});
    assert.ok(text.includes('&lt;Raw &amp; title&gt;.txt')); assert.ok(!text.includes('&amp;lt;'));
    assert.deepEqual(calls.at(-1), [{mode: 'interview', file: file.file_id, note: 'Original <caption> {note}'}, undefined]);
    const url = 'https://fictional.test/job?x=1&y=2'; await handleAdd(env, `/add ${url} Original date`);
    assert.deepEqual(calls.at(-1), [{mode: 'add', job: url, note: 'Original date'}, undefined]);
    await handleScreenshot(env, {photo: [{file_id: 'Original screenshot'}], caption: 'Original screenshot note'});
    assert.deepEqual(calls.at(-1), [{mode: 'add', file: 'Original screenshot', note: 'Original screenshot note'}, undefined]);
  }
});

test('seven bot catalogs align keys and all named values in every plural form', async () => {
  await assertCatalogs(locales, locale => import(`../src/bot-copy/${locale}.js`));
});

test('unknown inherited-property stage names remain original display values', async () => {
  const {botStage} = await import('../src/bot-copy.js');
  for (const stage of ['constructor', 'toString', '__proto__', 'Original stage {name}']) assert.equal(botStage({JOBADABRA_NOTIFICATION_LANGUAGE: 'fr'}, stage), stage);
});


test('known run modes have localized presentation while canonical defaults and unknown modes stay original', async () => {
  const {formatRunItems} = await import('../src/format.js');
  const run = {mode: 'run', started: '2026-11-07T12:00Z', summary: 'Original summary'};
  assert.ok(formatRunItems([run]).includes(' run · '));
  assert.ok(formatRunItems([run], {JOBADABRA_NOTIFICATION_LANGUAGE: 'de'}).includes('Stellen suchen'));
  assert.equal(run.mode, 'run');
});


test('recording callbacks localize only fabricated display labels and preserve canonical files, raw names and dispatch', async t => {
  const {handleInterview, interviewFile} = await import('../src/index.js');
  const {botText} = await import('../src/bot-copy.js');
  const trips = []; t.mock.method(globalThis, 'fetch', (...args) => {trips.push(args); throw new Error('No external transport');});
  t.after(() => assert.deepEqual(trips, []));
  const labels = {en: ['voice note', 'video note', 'recording'], de: ['Sprachnachricht', 'Videonachricht', 'Aufnahme'], fr: ['message vocal', 'message vidéo', 'enregistrement'], it: ['messaggio vocale', 'videomessaggio', 'registrazione'], es: ['nota de voz', 'nota de vídeo', 'grabación'], ro: ['mesaj vocal', 'mesaj video', 'înregistrare'], ru: ['голосовое сообщение', 'видеосообщение', 'запись']};
  for (const locale of [...locales, undefined, 'system', 'unknown']) {
    const language = labels[locale] ? locale : 'en', dispatched = [];
    const env = {JOBADABRA_NOTIFICATION_LANGUAGE: locale, dispatch: async (...args) => dispatched.push(args)};
    for (const [kind, index] of [['voice', 0], ['video_note', 1], ['audio', 2], ['video', 2]]) {
      const message = {[kind]: {file_id: 'Original {file} ' + kind, file_size: 23}, caption: 'Raw <caption> {note}'};
      const before = JSON.stringify(message), canonical = interviewFile(message);
      assert.equal(canonical.file_name, labels.en[index]);
      assert.equal(await handleInterview(env, message), botText(env, 'gotRecording', {file: labels[language][index]}));
      assert.deepEqual(dispatched.at(-1), [{mode: 'interview', file: message[kind].file_id, note: message.caption}, undefined]);
      assert.deepEqual(interviewFile(message), canonical); assert.equal(JSON.stringify(message), before);
      for (const name of ['voice note', 'video note', 'recording', '工程師 <name> & {file}.mp3']) {
        const named = {[kind]: {...message[kind], file_name: name}};
        const expected = name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        assert.equal(await handleInterview(env, named), botText(env, 'gotRecording', {file: expected}), 'real/default-like filename is content');
        assert.equal(interviewFile(named).file_name, name);
      }
    }
  }
});
