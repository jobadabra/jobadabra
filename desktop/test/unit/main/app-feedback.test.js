import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_CHARS, send} from '../../../lib/app-feedback.js';
import {countLine} from '../../../renderer/feedback-count.js';

const storage = () => { let s = {}; return {settings: () => s, saveSettings: patch => { s = {...s, ...patch}; }}; };

test('sends the words, the optional contact, the version and one stable install id', async () => {
  const sent = [];
  const st = storage();
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{}'); };
  assert.deepEqual(await send({text: '  Setup took 20 min ', contact: 'ana@x.ch'}, {storage: st, version: '0.4.0', platform: 'darwin', fetcher}), {ok: true});
  await send({text: 'Again'}, {storage: st, version: '0.4.0', fetcher});
  assert.equal(sent[0].text, 'Setup took 20 min');
  assert.equal(sent[0].contact, 'ana@x.ch');
  assert.equal(sent[0].install, sent[1].install);
  assert.ok(sent[0].install.length >= 8);
});

test('empty, too long, rate-limited and offline each say what to do', async () => {
  const ok = async () => new Response('{}');
  assert.match((await send({text: ' '}, {storage: storage(), version: '1', fetcher: ok})).error, /few words/);
  assert.match((await send({text: 'x'.repeat(MAX_CHARS + 1)}, {storage: storage(), version: '1', fetcher: ok})).error, /8,000/);
  assert.equal((await send({text: 'x'.repeat(MAX_CHARS)}, {storage: storage(), version: '1', fetcher: ok})).ok, true, 'exactly the limit is sent whole');
  assert.match((await send({text: 'hi'}, {storage: storage(), version: '1', fetcher: async () => new Response('', {status: 429})})).error, /tomorrow/);
  assert.match((await send({text: 'hi'}, {storage: storage(), version: '1', fetcher: async () => { throw new Error('offline'); }})).error, /connection/);
});

test('the screenshot, the logs and the screen go only when given; a skipped part the site names comes back', async () => {
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return Response.json({ok: true, skipped: ['screenshot']}); };
  const plain = await send({text: 'hi'}, {storage: storage(), version: '1', fetcher});
  assert.deepEqual(plain, {ok: true, skipped: ['screenshot']});
  assert.ok(!('screenshot' in sent[0]) && !('logs' in sent[0]) && !('screen' in sent[0]) && !('page' in sent[0]) && !('profile' in sent[0]));
  assert.match(sent[0].platform, new RegExp(`^${process.platform} \\S+ ${process.arch}$`));   // OS version and architecture always go (owner, 2 Nov 2026)
  await send({text: 'hi', screen: 'actions', screenshot: 'data:image/jpeg;base64,AAAA', logs: '== Support state =='}, {storage: storage(), version: '1', fetcher});
  assert.equal(sent[1].screen, 'actions'); assert.equal(sent[1].screenshot, 'data:image/jpeg;base64,AAAA'); assert.equal(sent[1].logs, '== Support state ==');
});

test('this screen\'s data and the Profile snapshot go as their own fields, only when given', async () => {
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return Response.json({ok: true}); };
  await send({text: 'hi', page: '{"jobs": []}', profile: '{"parts": {}}'}, {storage: storage(), version: '1', fetcher});
  assert.equal(sent[0].page, '{"jobs": []}'); assert.equal(sent[0].profile, '{"parts": {}}');
});

// Why (4 Nov 2026, a tester: "silently cuts text at about 2,000 characters"): the box's maxlength is the site's cap, in one number; a browser drops what is typed past it, so a lower one loses words unseen.
test('the feedback box allows exactly what the app sends and the site keeps', async () => {
  const {readFileSync} = await import('node:fs');
  const html = readFileSync(new URL('../../../renderer/index.html', import.meta.url), 'utf8');
  assert.equal(html.match(/<textarea id="app-feedback-text"[^>]*maxlength="(\d+)"/)[1], String(MAX_CHARS));
  assert.match(html, /id="app-feedback-count"[^>]*hidden/);
  assert.doesNotMatch(html, /id="app-feedback-count"[^>]*aria-live/, 'a live region would read every keystroke past 80%');
});

// The reporter's scenario: a long report. The box keeps it, send() passes it whole, and the line under the box speaks from 80% on (6,400 of 8,000).
test('a 5,000-character report is sent whole and the count line speaks at 80% and at the limit', async () => {
  const sent = [];
  const long = `${'The Jobs list shows the same job twice. '.repeat(125)}THE END`;
  assert.ok(long.length > 2000 && long.length < MAX_CHARS);
  await send({text: long}, {storage: storage(), version: '1', fetcher: async (url, init) => { sent.push(JSON.parse(init.body)); return Response.json({ok: true}); }});
  assert.ok(sent[0].text.endsWith('THE END'), 'the ending reaches the site');
  assert.equal(countLine(6399, MAX_CHARS), '');
  assert.equal(countLine(6400, MAX_CHARS), '6,400 of 8,000 characters');
  assert.equal(countLine(7999, MAX_CHARS), '7,999 of 8,000 characters');
  assert.match(countLine(8000, MAX_CHARS), /^8,000 of 8,000 characters: nothing more fits\. Send this, then write the rest as a second note\.$/);
  assert.equal(countLine(0, MAX_CHARS), '');
  assert.equal(countLine(500, 0), '', 'no limit known: say nothing');
});
