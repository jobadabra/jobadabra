// Guard: safety — without it a practice page could be served beyond loopback, reach a host that is not a recorded one, or write a typed password into the ledger shown to the person.
// The practice server (practice/server.js) serves recorded employer pages and catches their Submit; spec docs/superpowers/specs/2026-11-07-practice-jobs-design.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {hostRulesFor, loadCases, startPractice, withShim} from '../../../practice/server.js';

const askAt = (port, host, pathname, {method = 'GET', body = '', type = 'application/json'} = {}) => new Promise((resolve, reject) => {
  const req = https.request({host: '127.0.0.1', port, path: pathname, method, rejectUnauthorized: false, headers: {host: `${host}:${port}`, 'content-type': type}}, res => {
    let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({status: res.statusCode, text}));
  });
  req.on('error', reject); req.end(body);
});
function oneCase(html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-practice-test-'));
  fs.writeFileSync(path.join(dir, 'form.html'), html);
  return {name: 'x', dir, pages: [{url: 'https://jobs.example.com/x/apply', file: 'form.html'}]};
}

test('the server listens on loopback only and serves a recorded page with the capture script', async () => {
  const server = await startPractice({cases: [oneCase('<html><body><form></form></body></html>')]});
  try {
    const page = await askAt(server.port, 'jobs.example.com', '/x/apply');
    assert.equal(page.status, 200);
    assert.match(page.text, /__practiceShim/);
    assert.equal(withShim('<p>no body tag</p>').includes('__practiceShim'), true);
    assert.deepEqual(server.hosts, ['jobs.example.com']);
    assert.match(server.hostRules(), /MAP jobs\.example\.com 127\.0\.0\.1:\d+, MAP \* ~NOTFOUND , EXCLUDE 127\.0\.0\.1/);   // every other name fails to resolve
  } finally { await server.close(); }
});

test('a host that is not a recorded one is refused and counted, never answered', async () => {
  const server = await startPractice({cases: [oneCase('<form></form>')]});
  try {
    const stranger = await askAt(server.port, 'www.real-employer.com', '/x/apply');
    assert.equal(stranger.status, 404);
    assert.equal(server.strangers(), 1);
    assert.equal((await askAt(server.port, 'jobs.example.com', '/not-a-page')).status, 404);
  } finally { await server.close(); }
});

test('a Submit is caught once whether the script, the form\'s own POST, or both report it', async () => {
  const ledger = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-practice-ledger-')), 'caught.jsonl');
  const server = await startPractice({cases: [oneCase('<form></form>')], ledgerFile: ledger});
  try {
    await askAt(server.port, 'jobs.example.com', '/__caught', {method: 'POST', body: JSON.stringify({id: 'aaa1', page: 'https://jobs.example.com/x/apply', how: 'submit', fields: [['email', 'a@b.test'], ['pw', '[hidden]']]})});
    const reply = await askAt(server.port, 'jobs.example.com', '/envoyer', {method: 'POST', body: 'email=a%40b.test&__practice_id=aaa1', type: 'application/x-www-form-urlencoded'});
    assert.equal(reply.status, 200);
    const [entry, ...rest] = server.caught();
    assert.equal(rest.length, 0, 'the script and the post are one submission');
    assert.deepEqual([entry.host, entry.path, entry.posted, entry.postedTo], ['jobs.example.com', '/x/apply', true, '/envoyer']);
    assert.deepEqual(entry.fields, [['email', 'a@b.test'], ['pw', '[hidden]']]);
    await askAt(server.port, 'jobs.example.com', '/other', {method: 'POST', body: 'a=1&pw=hunter2', type: 'application/x-www-form-urlencoded'});   // a post the script did not report is its own entry
    assert.equal(server.caught().length, 2);
    assert.equal(fs.readFileSync(ledger, 'utf8').trim().split('\n').length, 2);
    assert.deepEqual(server.caught()[1].fields.map(([name]) => name), ['a', 'pw']);
    assert.equal(fs.readFileSync(ledger, 'utf8').includes('hunter2'), false, 'a value the script did not report is never written');
    // a multipart POST nobody reported: field names only, never a file's name or text inside a value
    const part = (name, extra, value) => `--B\r\nContent-Disposition: form-data; name="${name}"${extra}\r\n\r\n${value}\r\n`;
    await askAt(server.port, 'jobs.example.com', '/files', {method: 'POST', body: `${part('cv', '; filename="CV.pdf"', 'x')}${part('note', '', 'name="fake"')}--B--\r\n`, type: 'multipart/form-data; boundary=B'});
    assert.deepEqual(server.caught().at(-1).fields.map(([name]) => name), ['cv', 'note']);
    assert.equal(server.caught().length, 3, 'the multipart POST is one entry');
    // the other order: the page's POST arrives first, the script's report with the same token completes that entry
    await askAt(server.port, 'jobs.example.com', '/late', {method: 'POST', body: 'e=1&__practice_id=bbb2', type: 'application/x-www-form-urlencoded'});
    await askAt(server.port, 'jobs.example.com', '/__caught', {method: 'POST', body: JSON.stringify({id: 'bbb2', page: 'https://jobs.example.com/y/apply', how: 'submit', fields: [['e', '1']]})});
    assert.equal(server.caught().length, 4);
    assert.deepEqual([server.caught()[3].path, server.caught()[3].how, server.caught()[3].fields], ['/y/apply', 'submit', [['e', '1']]]);
    assert.deepEqual(server.caught()[1].fields.map(([name]) => name), ['a', 'pw'], 'the earlier POST with no report is not taken by another form\'s report');
    // another form's report right after a report-less POST is its own entry (no host + time match)
    await askAt(server.port, 'jobs.example.com', '/__caught', {method: 'POST', body: JSON.stringify({id: 'ccc3', page: 'https://jobs.example.com/z/apply', how: 'submit', fields: [['z', '9']]})});
    assert.equal(server.caught().length, 5);
  } finally { await server.close(); }
});

test('every recorded case with a form loads and its pages sit on hosts the rule maps', () => {
  const cases = loadCases();
  assert.ok(cases.length > 100);
  const hosts = [...new Set(cases.flatMap(item => item.pages.map(page => new URL(page.url).host)))];
  assert.match(hostRulesFor(hosts, 1234), new RegExp(`MAP ${hosts[0].replace(/\./g, '\\.')} 127\\.0\\.0\\.1:1234`));
});
