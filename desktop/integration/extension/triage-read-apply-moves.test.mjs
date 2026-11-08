// Integration test (extension layer): a Jobs-check read of a posting whose Apply opens the form on another page always ends in a report, never silence.
// Why (8 Nov 2026, owner: "we fixed this type of bugs tens of times. Why it's still there?"; picked "Local test first"): 4 of 4 XING reads on the owner's run ended
// with no report at the 150 s cap; Apply moved the tab and extension/triage-look.js returned null ("the page it moved to reports"), and nothing proved that page ever did.
// Real: the extension as the app copies it for its hidden browser (desktop/ready-fill/extension-copy.mjs, owned), the storage the app writes (extension-storage.mjs), a real
// headless Chromium, the fixture site's three ways an Apply press moves (same tab, a new tab by link, a new tab by script). Stood in: the app (poll, page kind, every other route
// answered {ok: true} and logged). The page-kind stand-in answers from the fixture's own truth (the posting is a posting, the form a form), as the AI does on these pages.
// Nothing here reaches the owner's app, profile or a real site: every host maps to the local fixture server, the app is a loopback stand-in.
/* global globalThis */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {chromium} from '../../e2e/lib/visit-page.mjs';
import {CHAIN, LATE, SCRIPTED, hostRules, startForms} from '../../e2e/lib/forms.mjs';
import {EXTENSION_DIR} from '../../e2e/lib/extension.mjs';
import {OWNED_WORKER} from '../../e2e/lib/own-worker.mjs';
import {at, capOf, clocked, onHang} from '../../e2e/lib/test-clock.mjs';
import {copyForNight} from '../../ready-fill/extension-copy.mjs';
import {setExtensionStorage} from '../../ready-fill/extension-storage.mjs';
import {POST_CORS} from '../../lib/server-http.js';
import {sessionTabUrl} from '../../lib/session-tab.js';

const READ_MS = 45000;   // hang guard only: a read that reports at all does so in seconds (the owner's direct forms: 3-20 s); the owner's hang was 150 s
const pathOf = url => { try { return new URL(url).pathname.replace(/(.)\/$/, '$1'); } catch { return ''; } };
const FORM_PATHS = new Set([LATE.formPath, CHAIN.formPath, SCRIPTED.formPath]);
// The button the page-kind AI names on each fixture page that is not the form (lib/forms.mjs *_PAGES), as it does on a real posting (its applyButton).
const BUTTONS = {[LATE.path]: 'Apply', [CHAIN.path]: 'Apply', [CHAIN.stepPath]: 'To apply', [SCRIPTED.path]: 'Apply now'};
const SHAPES = [
  {name: 'Apply opens the form in the same tab', url: LATE.url},
  {name: 'Apply opens a new tab by its link', url: CHAIN.url},
  {name: 'Apply opens the form by script (window.open)', url: SCRIPTED.url},
];

let forms, app, context, worker, dir;
const asked = [];   // every route the extension asked the stand-in app, in order: the evidence a red prints
const reports = new Map(), steps = new Map(), waiters = new Map();
let pending = [];

/** The stand-in app: hands out each queued read once on a poll, keeps every step and report by session, answers page kind from the fixture's truth. */
function startApp() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let sent = {};
      try { sent = body ? JSON.parse(body) : {}; } catch { sent = {}; }
      const route = new URL(req.url, 'http://x').pathname;
      asked.push(`${route}${sent.action ? ` ${sent.action}` : ''}${sent.step ? ` ${sent.step}` : ''}${sent.url ? ` ${pathOf(sent.url)}` : ''}`);
      const json = value => { res.writeHead(200, {'content-type': 'application/json', ...POST_CORS}); res.end(JSON.stringify(value)); };
      if (req.method === 'OPTIONS') { res.writeHead(204, POST_CORS); res.end(); return; }   // the extension's preflight, answered as the app's server does (lib/server-http.js)
      if (route === '/extension/background-apply' && sent.action === 'poll') { const jobs = pending; pending = []; return json({ok: true, jobs}); }
      if (route === '/extension/background-apply' && sent.action === 'triage-step') { (steps.get(sent.session) || steps.set(sent.session, []).get(sent.session)).push(sent.step); return json({ok: true}); }
      if (route === '/extension/background-apply' && sent.action === 'triage-read') { reports.set(sent.session, sent); waiters.get(sent.session)?.(sent); return json({ok: true}); }
      if (route === '/extension/page-kind') {
        const form = FORM_PATHS.has(pathOf(sent.url));
        return json(form ? {role: 'form', kind: 'form', botCheck: false, by: 'ai'} : {role: 'no-form', kind: 'posting', applyButton: BUTTONS[pathOf(sent.url)] || '', botCheck: false, by: 'ai'});
      }
      return json({ok: true});
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({port: server.address().port, close: () => new Promise(done => { server.close(done); server.closeAllConnections?.(); })})));
}

before(async () => {
  forms = await startForms();
  app = await startApp();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-triage-moves-'));
  const extension = path.join(dir, 'extension');
  copyForNight(app.port, EXTENSION_DIR, extension, {owned: true});   // the app's own copy for its hidden browser (lib/background-browser.js)
  context = await chromium.launchPersistentContext(path.join(dir, 'profile'), {
    headless: false, ignoreHTTPSErrors: true, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--headless=new', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, `--host-resolver-rules=${hostRules(forms.port)}`, '--ignore-certificate-errors', '--no-first-run', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  });
  worker = context.serviceWorkers().find(each => OWNED_WORKER.test(each.url())) || await context.waitForEvent('serviceworker', {predicate: each => OWNED_WORKER.test(each.url()), timeout: 30000});
  await setExtensionStorage(worker, {workerUrl: `http://127.0.0.1:${app.port}`, token: 'stand-in-token', backgroundOwner: 'stand-in-owner'});
  console.log(`owned flag in the copied worker: ${await worker.evaluate(() => typeof globalThis.__jobadabraBackgroundOwned)}`);
});

after(async () => {
  await context?.close();
  await app?.close();
  await forms?.close();
  if (dir) fs.rmSync(dir, {recursive: true, force: true});
});

// A hang closes what the file opened, so the red names the stage instead of node's bare timeout (e2e-harness rule 1/7; Gitar on #3615).
const closeOnHang = () => { onHang(() => context?.close()); onHang(() => app?.close()); onHang(() => forms?.close()); };
/** The report of a read, or null at the cap; the cap's timer is cleared when the race settles so a passed test leaves nothing running (Gitar on #3615). */
async function reportOf(reported) {
  let cap;
  const none = new Promise(resolve => { cap = setTimeout(() => resolve(null), capOf(READ_MS)); });
  try { return await Promise.race([reported, none]); } finally { clearTimeout(cap); }
}

for (const [index, shape] of SHAPES.entries()) {
  test(`a read where ${shape.name} ends in a report`, {timeout: READ_MS + 30000}, clocked(READ_MS + 15000, async () => {
    closeOnHang();
    const session = `tr0000000${index}`;   // the reader's own id shape (lib/triage-reader.js: tr + 8)
    const reported = new Promise(resolve => waiters.set(session, resolve));
    pending.push({session, url: sessionTabUrl(shape.url, session), mode: 'read'});
    at('the poll that hands the read over');
    await worker.evaluate(() => globalThis.__jobPilottoBackgroundSessions.poll());
    at('the read\'s report');
    const from = asked.length;
    const report = await reportOf(reported);
    assert.ok(report, `no report within ${READ_MS / 1000} s (the owner's hang). Steps told: ${JSON.stringify(steps.get(session) || [])}. The extension asked the app: ${JSON.stringify(asked.slice(from - 2))}`);
    assert.equal(report.unreadable === true ? report.why : 'read', 'read', `the read ended unreadable (${report.why}); steps ${JSON.stringify(steps.get(session) || [])}`);
    assert.equal(report.look?.role, 'form', `the report is not the form Apply opened: ${JSON.stringify(report)}`);
  }));
}

// The twin's hidden browser on 8 Nov 2026 held 4 old sessions handed to the person (28 Oct, 5 Nov: modes fill and auto, manualRequired, their tabs long gone) and none of its 11 reads opened a window.
test('a read still opens beside old sessions handed to the person', {timeout: READ_MS + 30000}, clocked(READ_MS + 15000, async () => {
  closeOnHang();
  await worker.evaluate(rows => globalThis.chrome.storage.local.set({backgroundApplySessions: rows}), Object.fromEntries(['a1b2c3d4-0001', 'a1b2c3d4-0002', 'a1b2c3d4-0003', 'a1b2c3d4-0004'].map((id, i) => [id,
    {session: id, mode: i < 2 ? 'auto' : 'fill', window: 900 + i, tab: 175744000 + i, url: sessionTabUrl(LATE.url, id), manualRequired: true, manualReason: 'needs_user', startedAt: Date.UTC(2026, 10, 5) + i}])));
  const session = 'tr0000000s';
  const reported = new Promise(resolve => waiters.set(session, resolve));
  pending.push({session, url: sessionTabUrl(LATE.url, session), mode: 'read'});
  at('the poll that hands the read over');
  await worker.evaluate(() => globalThis.__jobPilottoBackgroundSessions.poll());
  at('the read\'s report');
  const from = asked.length;
  const report = await reportOf(reported);
  assert.ok(report, `no report within ${READ_MS / 1000} s beside old sessions. Steps told: ${JSON.stringify(steps.get(session) || [])}. The extension asked the app: ${JSON.stringify(asked.slice(from - 2))}`);
  assert.equal(report.look?.role, 'form', `the report is not the form Apply opened: ${JSON.stringify(report)}`);
}));
