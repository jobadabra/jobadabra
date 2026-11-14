// LinkedIn jobs on every Find jobs, PR 1/3 (spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the IPC the window uses for the switch and the
// routes the extension calls (the copied session, and "is the switch still on?"). The session is a credential: nothing here logs it or sends it back. Guard: test/unit/extension/linkedin-handlers.test.js.
import * as session from './linkedin-session.js';
import {refresh as realRefresh} from './linkedin-refresh.js';
import * as realKeychain from './keychain.js';
import {log as appLog} from './log.js';
import {easyApplyOn} from '../renderer/apply-settings-model.js';

/** The extension's three calls. session: {cookies} from the consent page -> saved or refused; pending: tells the extension whether to give up its LinkedIn permissions and whether a Find jobs press
 *  wants a fresh copy now; refresh: that fresh copy (or {held: false}), after which the waiting press goes on (lib/linkedin-refresh.js). */
export function linkedinRoutes(storage, deps = {}) {
  const note = deps.refresh || realRefresh;
  return {
    // Why (Gitar on #4276, #4283, #4358): a copy is taken only while the one sign-in state says so (lib/linkedin-session.js takesCopy: a Chrome way waiting, kept, or the switch on); it turns no switch on.
    session: payload => (session.takesCopy(storage, deps) ? session.saveSession(storage, payload?.cookies, deps) : {ok: false, error: 'Nobody asked for a LinkedIn sign-in'}),
    // Why (#4312, Gitar on #4358): the grants follow the same state, so LinkedIn jobs on after a Chrome sign-out keeps them and a Chrome sign-in again comes back; a Find jobs press asks for a fresh copy.
    pending: () => ({revoke: !session.keepsGrants(storage, deps), refresh: session.state(storage).on && note.look()}),
    refresh: payload => { const answer = session.refreshSession(storage, payload?.cookies, {...deps, held: payload?.held !== false}); note.delivered(); return answer; },
  };
}

/** What the window needs: the state, whether the ask is due on this Find jobs press, and whether a session is held (never its value). */
export function linkedinView(storage, deps = {}) {
  const mine = session.state(storage);
  return {...mine, signedIn: session.signedIn(storage), login: session.loginOf(storage, deps).state, ask: session.shouldAsk(mine), hasSession: !!session.readSession(deps), signin: session.signinView(storage)};   // signin: the one state (#3911)
}

/**
 * Register the window's seven LinkedIn-jobs channels and the extension's three routes. In demo mode no store, Keychain, window or Chrome is touched. `signIn` opens the sign-in window
 * (lib/linkedin-signin-window.js) and answers {ok, cookies} | {ok: false, reason}; `openPage` opens the extension's consent page (browser-handlers.js) and answers {opened}. `log` writes the
 * press lines (never a cookie value).
 */
export function registerLinkedinHandlers({DEMO, ipcMain, server, storage, signIn, openPage, deps = {}, log = appLog}) {
  const routes = linkedinRoutes(storage, deps);
  if (!DEMO) session.forgetUnused(storage, deps);   // Gitar on #4350, #4354: a sign-in no press can still turn on is not kept past a start
  server.setVisitRoute('/extension/linkedin-session', payload => routes.session(payload));
  server.setVisitRoute('/extension/linkedin-pending', () => routes.pending());
  server.setVisitRoute('/extension/linkedin-refresh', payload => routes.refresh(payload));
  ipcMain.handle('linkedinJobsState', () => (DEMO ? {on: false, signedIn: false, login: 'none', asked: 0, declined: 0, ask: true, hasSession: false, extension: false, signin: {state: 'ok', why: '', empties: 0}, easyApply: false} : {...linkedinView(storage, deps), extension: !!server.extensionSeen?.(), easyApply: easyApplyOn(storage.settings())}));
  ipcMain.handle('linkedinJobsAsked', () => { if (!DEMO) session.noteAsked(storage); return {ok: true}; });
  ipcMain.handle('linkedinJobsAnswer', (_, answer) => { if (!DEMO) session.noteAnswer(storage, answer); return {ok: true}; });
  ipcMain.handle('linkedinJobsConnect', async () => {
    if (DEMO) return {opened: true};
    const answer = await openPage();
    if (answer?.opened) session.openSignin(storage, deps);   // Gitar on #4337, #4340: only a page that opened waits for a copy (one that failed or threw never opens the way)
    return answer;
  });   // the shortcut: the extension's own consent page (browser-handlers.js), where Chrome asks for a permission on a click; no extension = {opened: null}
  // Why (#4301, owner 14 Nov 2026): the asking switch is local to this window press, never stored for a later Chrome copy. Complete it before replying so a renderer close cannot lose the press.
  ipcMain.handle('linkedinJobsSignIn', async (_, {turnOn} = {}) => {
    if (DEMO) return {ok: true};
    if (turnOn !== undefined && turnOn !== 'jobs') return {ok: false, reason: 'invalid-switch'};
    // Why (Gitar on #3080, 3 Nov 2026; 14 Nov 2026, owner: "Let's store them in Keychain/Credentials Manager (windows)"): the session is kept only in the Mac's Keychain or
    // Windows' Credential Manager (lib/keychain.js hasStore; an isolated run keeps its own file), never a file on disk, so a computer with neither (Linux) refuses before the window opens.
    if (!realKeychain.hasStore(deps.platform || process.platform) && !(deps.isolated ?? realKeychain.isolated())) {
      log('linkedin-jobs', 'press', {path: 'window', outcome: 'no-keychain'});
      return {ok: false, reason: 'no-keychain'};
    }
    const got = await signIn();
    const saved = got.ok ? session.saveSession(storage, got.cookies, deps) : got;
    // Gitar on #4317: the answer is the asking switch's own turn-on, so a refused turn-on never reads as "on" (the sign-in stays kept either way)
    const on = !saved.ok || !turnOn ? {ok: true} : session.turnOn(storage, deps);
    log('linkedin-jobs', 'press', {path: 'window', outcome: saved.ok ? (on.ok ? 'signed-in' : `signed-in, ${on.reason}`) : (got.ok ? 'not-kept' : got.reason)});
    if (!saved.ok) return {ok: false, reason: got.ok ? 'not-kept' : got.reason, error: saved.error};
    return on.ok ? {ok: true} : {ok: false, kept: true, reason: on.reason};
  });
  ipcMain.handle('linkedinJobsOn', () => (DEMO ? {ok: true} : session.turnOn(storage, deps)));   // the sign-in already kept (a Chrome copy that came after its window): nothing is asked
  ipcMain.handle('linkedinJobsOff', () => (DEMO ? {ok: true} : session.turnOff(storage, deps)));
}
