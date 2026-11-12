// Guard: safety — a job board read in Jobadabra's headless Chrome must go out as an honest automated browser with no cookies, and leave no profile behind.
// Job: assert state
// Why (owner, 12 Nov 2026, asked via AskUserQuestion: "Yes, as boards (Recommended)"): boards whose public search page refuses the engine's plain reader are read during the
// person's own Find jobs press in Jobadabra's own headless Chrome (lib/headless-boards.js). This proves the read on a real browser: a fixture board that refuses a plain request
// but lists its jobs to a browser (the list drawn by the page's own script) is read with its jobs; a board that refuses every request is passed on as a 403 with no AI asked;
// every request carried the browser's own user agent and each board's page went out with no cookie; the read's folder is gone afterwards.
// Real: the board read's browser (lib/headless-boards-beside.js boardReadBrowser: extension copy, launch, worker) on a real headless Chromium and the step's own CDP reading.
// Stood in: the app's server, the engine (queue, AI judge, outcome) and the boards (example names on a local https server). Nothing reaches the owner's app, a profile or a real site.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawn} from 'node:child_process';
import {test} from 'node:test';
import {chromium} from '../../e2e/lib/visit-page.mjs';
import {endBrowser} from '../../e2e/lib/browser-end.mjs';
import {CLOSE_MS, at, clocked, onHang} from '../../e2e/lib/test-clock.mjs';
import {boardReadBrowser, FOLDER} from '../../lib/headless-boards-beside.js';
import {boardsStep} from '../../lib/headless-boards.js';
import {POST_CORS, jsonBody, jsonHeaders, preflight} from '../../lib/server-http.js';

const TEST_MS = 90000;   // a hang guard: the start takes ~1-3 s, each board a second or two
const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OPEN = 'open.board.example.net', SHUT = 'shut.board.example.net';
// The list is drawn by the page's own script: a plain reader gets a 403, and even the page's bytes hold no job title.
const PAGE = `<!doctype html><html><head><title>Jobs</title></head><body><ul id="jobs"></ul><script>
for (const title of ['Nurse, day shift', 'Nurse, night shift']) { const li = document.createElement('li'); li.textContent = title; document.getElementById('jobs').append(li); }
</script></body></html>`;

test('a board that refuses plain reading is read in the headless Chrome, honestly and without cookies; one that refuses everything is a 403 with no AI asked', {timeout: TEST_MS + CLOSE_MS + 5000}, clocked(TEST_MS, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-board-read-')), root = path.join(folder, 'root'), certs = path.join(folder, 'certs');
  fs.mkdirSync(root); fs.mkdirSync(certs);
  fs.symlinkSync(DESKTOP, path.join(root, 'desktop'), 'junction');
  fs.cpSync(path.resolve(DESKTOP, '..', 'extension'), path.join(root, 'extension'), {recursive: true});   // a copy, never a link: the app rewrites its copy's port in place
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=jp-board', '-keyout', path.join(certs, 'key.pem'), '-out', path.join(certs, 'cert.pem')], {stdio: 'ignore'});
  const storage = {path: name => path.join(folder, 'home', name)};
  const seen = [];
  const boards = https.createServer({key: fs.readFileSync(path.join(certs, 'key.pem')), cert: fs.readFileSync(path.join(certs, 'cert.pem'))}, (request, response) => {
    const host = String(request.headers.host || '').split(':')[0];
    seen.push({host, path: request.url, agent: String(request.headers['user-agent'] || ''), cookie: request.headers.cookie || ''});
    const browser = request.headers['sec-fetch-mode'] === 'navigate';
    if (host === OPEN && browser) { response.writeHead(200, {'content-type': 'text/html', 'set-cookie': 'visit=1; Secure; Path=/'}); response.end(PAGE); return; }
    response.writeHead(host === OPEN || host === SHUT ? 403 : 404, {'content-type': 'text/plain'}); response.end('refused');
  });
  const app = http.createServer((request, response) => { if (preflight(request, response, POST_CORS)) return; request.resume(); request.on('end', () => { jsonHeaders(response, 200, POST_CORS); jsonBody(response, {ok: true, jobs: []}); }); });
  await new Promise(resolve => boards.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const rules = `MAP ${OPEN} 127.0.0.1:${boards.address().port}, MAP ${SHUT} 127.0.0.1:${boards.address().port}, MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost`;
  const env = {JOBADABRA_E2E: '1', JOBADABRA_E2E_BACKGROUND_BROWSER_ARGS: JSON.stringify([`--host-resolver-rules=${rules}`, '--ignore-certificate-errors', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])])};
  const kept = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const close = () => endBrowser({profile: path.join(storage.path(FOLDER), 'profile'), launched: true}).catch(error => console.log(`cleanup: endBrowser: ${error.message}`));
  onHang(close);
  try {
    at('the fixture refuses a plain reader (positive control)');
    const plain = await new Promise(resolve => https.get({host: '127.0.0.1', port: boards.address().port, path: '/jobs', headers: {host: OPEN}, rejectUnauthorized: false}, answer => { answer.resume(); resolve(answer.statusCode); }));
    assert.equal(plain, 403);
    seen.length = 0;
    at('the step reads both boards in the real headless browser');
    const browser = boardReadBrowser(storage, {root, find: () => chromium.executablePath(), reaper: () => {}, spawn: (file, args, options) => spawn(file, args, {...options, env: {...process.env, ...env}})});
    const judged = [], outcomes = [];
    const result = await boardsStep({browser, start: () => browser.start({port: app.address().port, token: 'stand-in-token'}),
      queue: async () => [{url: `https://${OPEN}/jobs?q=nurse`, name: 'Open board', kind: 'board'}, {url: `https://${SHUT}/jobs?q=nurse`, name: 'Shut board', kind: 'board'}],
      begin: async () => true, judge: async page => { judged.push(page.url); return 'page'; }, outcome: async page => { outcomes.push(page); return {ok: true, state: page.status === 200 ? 'read' : 'stopped', jobs: page.status === 200 ? 2 : 0}; },
      sleep: async () => {}});
    assert.equal(result.state, 'done');
    assert.equal(outcomes[0].status, 200);
    assert.match(outcomes[0].html, /Nurse, day shift.*Nurse, night shift/s, 'the jobs the page\'s own script drew reached the engine');
    assert.equal(outcomes[0].step, 'headless');
    assert.equal(outcomes[1].status, 403);
    assert.deepEqual(judged, [`https://${OPEN}/jobs?q=nurse`], 'the 403 board went to the engine with no AI asked');
    assert.ok(seen.length >= 2 && seen.every(row => /HeadlessChrome/.test(row.agent)), `the browser's own user agent on every request: ${JSON.stringify(seen.map(row => row.agent))}`);
    // A cookie the board set in this very load may come back on its own favicon request; the board's page itself must go out with an empty jar.
    const pages = seen.filter(row => row.path.startsWith('/jobs'));
    assert.equal(pages.length, 2);
    assert.ok(pages.every(row => !row.cookie), `each board's page went out with no cookie: ${JSON.stringify(pages.map(row => row.cookie))}`);
    assert.equal(await browser.dispose(), true);
    assert.equal(fs.existsSync(storage.path(FOLDER)), false, 'the read\'s folder is gone');
  } finally {
    await close();
    for (const [key, value] of Object.entries(kept)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await new Promise(resolve => boards.close(resolve));
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(folder, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  }
}));
