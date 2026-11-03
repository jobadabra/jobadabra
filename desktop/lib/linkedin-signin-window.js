// "Turn on LinkedIn" sign-in window (owner, 3 Nov 2026: "Both: window first"; spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md "Sign-in window"): a Jobadabra window on
// LinkedIn's own sign-in page. The person types their password THERE; this module never sees it, only the two session cookies LinkedIn sets once they are in. It disguises nothing (Electron's
// own honest user agent), solves no check (a checkpoint page is the person's to finish, or to close), and keeps nothing: the window's storage is its own in-memory partition, cleared when it
// ends. The cookies go back to the caller (lib/linkedin-handlers.js -> linkedin-session.js -> Keychain); they are never logged. Guard: test/linkedin-signin-window.test.js.
export const PARTITION = 'linkedin-signin';   // no "persist:" prefix = in memory only
export const TIMEOUT_MS = 10 * 60 * 1000;
export const START_URL = 'https://www.linkedin.com/login';
// LinkedIn pages that are part of signing in. li_at can exist while one of them is still on screen, so "signed in" needs the page to have left them too.
const SIGN_IN_PAGE = /^\/(login|uas|checkpoint|check|authwall|signup|add-phone)(\/|$)/;   // /check/add-phone is the phone interstitial

const onLinkedin = host => host === 'linkedin.com' || host.endsWith('.linkedin.com');
const hostOf = url => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };

/** The ONE verdict for "this person is now signed in": the window is on a LinkedIn page that is not a sign-in page, and LinkedIn set li_at. -> boolean. */
export function signedIn({url, cookies = []}) {
  let page;
  try { page = new URL(url); } catch { return false; }
  if (page.protocol !== 'https:' || !onLinkedin(page.hostname.toLowerCase()) || SIGN_IN_PAGE.test(page.pathname)) return false;
  return cookies.some(c => c?.name === 'li_at' && c.value && onLinkedin(String(c.domain || '').replace(/^\./, '').toLowerCase()));
}

/**
 * The window opener. `BrowserWindow`, `shell` and `hidden` come from the app (an e2e run never shows a window); `timeoutMs` is a test hook.
 * -> signIn(): Promise<{ok: true, cookies} | {ok: false, reason: 'cancelled' | 'timeout' | 'load-failed'}>. Invariants: one window at a time (a second press brings it forward and shares its answer);
 * closing the window or 10 minutes is a cancel; the window's storage is cleared on every end.
 */
export function createSignIn({BrowserWindow, shell, hidden = false, timeoutMs = TIMEOUT_MS}) {
  let current = null;
  return function signIn() {
    if (current) { current.win.show?.(); current.win.focus?.(); return current.promise; }
    const win = new BrowserWindow({width: 520, height: 760, title: 'Sign in to LinkedIn · Jobadabra', show: !hidden,
      webPreferences: {partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false}});
    const web = win.webContents, jar = web.session;
    let finish;
    const promise = new Promise(resolve => {
      let over = false;
      const timer = setTimeout(() => finish({ok: false, reason: 'timeout'}), timeoutMs);
      finish = async answer => {
        if (over) return;
        over = true; clearTimeout(timer);
        // Why (independent review, 3 Nov 2026): `current` is released only after the storage is cleared, so a new press cannot open a window on the same partition that this clear then wipes.
        await Promise.resolve(jar.clearStorageData()).catch(() => {});
        current = null;
        if (!win.isDestroyed()) win.destroy();
        resolve(answer);
      };
    });
    current = {win, promise};
    // Why (independent review, 3 Nov 2026): did-navigate and did-stop-loading fire together, and the person may close the window mid-read; the window is checked again after the await.
    const look = async () => {
      if (win.isDestroyed()) return;
      const cookies = await jar.cookies.get({domain: 'linkedin.com'}).catch(() => []);
      if (!win.isDestroyed() && signedIn({url: web.getURL(), cookies})) finish({ok: true, cookies});
    };
    for (const event of ['did-navigate', 'did-navigate-in-page', 'did-stop-loading']) web.on(event, look);
    // Only LinkedIn's own pages load here; any other link (a help page, a terms page) opens in the person's browser.
    const outside = url => { if (/^https:/.test(url)) shell.openExternal(url); };
    web.setWindowOpenHandler(({url}) => { outside(url); return {action: 'deny'}; });
    // will-redirect: a server 302 is not a will-navigate. The window grants no permission (camera, notifications, ...): it only signs in.
    for (const event of ['will-navigate', 'will-redirect']) web.on(event, (e, url) => { if (!onLinkedin(hostOf(url))) { e.preventDefault(); outside(url); } });
    jar.setPermissionRequestHandler?.((_, __, answer) => answer(false));
    win.on('closed', () => finish({ok: false, reason: 'cancelled'}));
    Promise.resolve(win.loadURL(START_URL)).catch(error => { if (error?.code !== 'ERR_ABORTED') finish({ok: false, reason: 'load-failed'}); });
    return promise;
  };
}
