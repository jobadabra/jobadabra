// Electron main script for signin-popup.test.js: the app's real sign-in window (lib/linkedin-signin-window.js) in a throwaway Electron, on stand-in pages that no network ever reaches.
// Why (owner, 5 Nov 2026: "When I try to enable LInkedin jobs. And I click login with Google, it doesn't really work"): a provider's popup needs window.opener; the old window sent every popup to Chrome, where it stayed blank.
// Every https request of the window's private partition is answered here (session.protocol.handle), so the "LinkedIn" page, the "provider" page and a "help" link are stand-ins and nothing real is reached;
// the cookie is a fake value. Never the owner's session, Chrome profile or Keychain (a throwaway userData folder).
import {BrowserWindow, app, session} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {PARTITION, createSignIn} from '../../lib/linkedin-signin-window.js';

const folder = process.env.JOBADABRA_POPUP_PROBE_DIR, out = process.env.JOBADABRA_POPUP_PROBE_OUT;
if (!folder || !out) throw new Error('JOBADABRA_POPUP_PROBE_DIR and JOBADABRA_POPUP_PROBE_OUT are required');
app.setPath('userData', path.join(folder, 'user-data'));
app.dock?.hide();
const HANG_MS = 10000;   // a hang guard: every wait below names the last state it saw

const LOGIN = `<!doctype html><title>stand-in sign-in</title>
<button id="sso" onclick="window.open('https://sso.standin.example/choose', 'sso', 'width=480,height=640')">Continue with a provider</button>
<a id="help" target="_blank" href="https://help.standin.example/">Help</a>
<script>addEventListener('message', e => { if (e.origin === 'https://sso.standin.example' && e.data && e.data.done) location.href = '/feed/'; });</script>`;
// The provider's page: reports whether it has an opener, answers the page that opened it, and closes itself.
const CHOOSE = `<!doctype html><title>stand-in provider</title>
<script>(async () => { await fetch('/report?opener=' + (window.opener ? 'yes' : 'no')); if (window.opener) window.opener.postMessage({done: true}, 'https://www.linkedin.com'); window.close(); })();</script>`;

const seen = {requests: [], opener: null};
const created = new Set();   // every window the app made, the popup too (BrowserWindow.getAllWindows() did not list them all)
const open = () => [...created].filter(win => !win.isDestroyed());
app.on('browser-window-created', (_, win) => created.add(win));
// Why (6 Nov 2026, #3345 app (Linux) run 42192378854, flaky): Electron quits by itself when the last window closes; this probe waits for exactly that moment (every window closed) and then
// writes its answer, so under load the process exited (0) before the write and the test saw "the probe wrote no answer". It quits only at the end, below (app.quit()).
app.on('window-all-closed', () => {});
let ses;
const serve = () => ses.protocol.handle('https', async request => {
  const url = new URL(request.url);
  seen.requests.push(`${url.hostname}${url.pathname}`);
  const page = body => new Response(body, {headers: {'content-type': 'text/html; charset=utf-8'}});
  if (url.hostname === 'www.linkedin.com' && url.pathname === '/login') return page(LOGIN);
  if (url.hostname === 'www.linkedin.com' && url.pathname === '/feed/') {
    await ses.cookies.set({url: 'https://www.linkedin.com/', domain: '.linkedin.com', name: 'li_at', value: 'FAKE-LI-AT-popup-probe', secure: true});
    return page('<!doctype html><title>stand-in feed</title>');
  }
  if (url.hostname === 'sso.standin.example' && url.pathname === '/choose') return page(CHOOSE);
  if (url.hostname === 'sso.standin.example' && url.pathname === '/report') { seen.opener = url.searchParams.get('opener'); return new Response('ok'); }
  return new Response('stand-in: not found', {status: 404});
});

/** Polls until `read()` is truthy; on the hang guard throws what was last seen. */
async function until(read, what) {
  const end = Date.now() + HANG_MS;
  for (;;) {
    const got = await read();
    if (got) return got;
    if (Date.now() > end) throw new Error(`hung waiting for ${what}`);
    await new Promise(done => setTimeout(done, 25));
  }
}

app.whenReady().then(async () => {
  ses = session.fromPartition(PARTITION);
  serve();
  const answer = {};
  const made = [], external = [];
  class Captured extends BrowserWindow { constructor(options) { super(options); made.push(this); } }
  try {
    const pending = createSignIn({BrowserWindow: Captured, shell: {openExternal: url => external.push(url)}, hidden: true, timeoutMs: 20000})();
    const parent = await until(() => made[0], 'the sign-in window');
    const web = parent.webContents;
    await until(() => web.getURL() === 'https://www.linkedin.com/login' && !web.isLoading(), `the stand-in sign-in page (at ${web.getURL()})`);
    // A plain link (target=_blank) goes to the person's browser: no window.
    await web.executeJavaScript("document.getElementById('help').click()", true);
    await until(() => external.length, 'the help link to reach the browser');
    answer.afterLink = {external: [...external], windows: open().length};
    // The provider's popup (window.open with a size) opens as a window of the app, shares the partition and has its opener.
    await web.executeJavaScript("document.getElementById('sso').click()", true);
    await until(() => seen.opener !== null || external.length > 1, `the provider popup (external opens: ${JSON.stringify(external)}, windows: ${open().length})`);
    answer.popup = {opener: seen.opener, externalAfter: [...external]};
    answer.result = await Promise.race([pending, new Promise((_, no) => setTimeout(() => no(new Error(`no sign-in answer (opener: ${seen.opener}, at ${web.isDestroyed() ? 'destroyed' : web.getURL()}, requests: ${seen.requests.join(', ')})`)), HANG_MS))]);
    answer.result = {ok: answer.result.ok, reason: answer.result.reason, cookieNames: (answer.result.cookies || []).map(c => c.name)};
    await until(() => open().length === 0, `every window to close (${open().length} open)`);
    answer.windowsAfter = open().length;
    answer.popupsMade = created.size - 1;
    answer.cookiesAfter = (await ses.cookies.get({})).length;
  } catch (error) { answer.error = String(error?.stack || error); }
  answer.requests = seen.requests;
  for (const win of open()) win.destroy();
  fs.writeFileSync(out, JSON.stringify(answer));
  app.quit();
});
