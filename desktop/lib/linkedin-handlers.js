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
    // Why (Gitar on #4276, #4283): a copy is kept only while a Chrome way the window opened still waits (WANTED_MS), or as a refresh of a kept sign-in; it turns no switch on (owner, 14 Nov 2026).
    session: payload => {
      if (!session.signinOpen(storage) && !session.signedIn(storage)) return {ok: false, error: 'Nobody asked for a LinkedIn sign-in'};
      const saved = session.saveSession(storage, payload?.cookies, deps);
      if (saved.ok) session.closeSignin(storage);
      return saved;
    },
    pending: () => ({revoke: !session.signedIn(storage), refresh: (session.state(storage).on && note.look()) || session.copyIsOld(storage)}),   // a Find jobs press, or a kept copy 12 h old (Easy Apply alone); the permissions stay while a sign-in is kept
    refresh: payload => { const answer = session.refreshSession(storage, payload?.cookies, {...deps, held: payload?.held !== false}); note.delivered(); return answer; },
  };
}

/** What the window needs: the state, whether the ask is due on this Find jobs press, and whether a session is held (never its value). */
export function linkedinView(storage, deps = {}) {
  const mine = session.state(storage);
  return {...mine, signedIn: session.signedIn(storage), ask: session.shouldAsk(mine), hasSession: !!session.readSession(deps), signin: session.signinView(storage)};   // signin: the one state (#3911)
}

/**
 * Register the window's seven LinkedIn-jobs channels and the extension's three routes. In demo mode no store, Keychain, window or Chrome is touched. `signIn` opens the sign-in window
 * (lib/linkedin-signin-window.js) and answers {ok, cookies} | {ok: false, reason}; `openPage` opens the extension's consent page (browser-handlers.js) and answers {opened}. `log` writes the
 * press lines (never a cookie value).
 */
export function registerLinkedinHandlers({DEMO, ipcMain, server, storage, signIn, openPage, deps = {}, log = appLog}) {
  const routes = linkedinRoutes(storage, deps);
  server.setVisitRoute('/extension/linkedin-session', payload => routes.session(payload));
  server.setVisitRoute('/extension/linkedin-pending', () => routes.pending());
  server.setVisitRoute('/extension/linkedin-refresh', payload => routes.refresh(payload));
  ipcMain.handle('linkedinJobsState', () => (DEMO ? {on: false, signedIn: false, asked: 0, declined: 0, ask: true, hasSession: false, extension: false, signin: {state: 'ok', why: '', empties: 0}, easyApply: false} : {...linkedinView(storage, deps), extension: !!server.extensionSeen?.(), easyApply: easyApplyOn(storage.settings())}));
  ipcMain.handle('linkedinJobsAsked', () => { if (!DEMO) session.noteAsked(storage); return {ok: true}; });
  ipcMain.handle('linkedinJobsAnswer', (_, answer) => { if (!DEMO) session.noteAnswer(storage, answer); return {ok: true}; });
  if (!DEMO) session.forgetUnused(storage, deps);   // a sign-in no switch uses is not kept past a start (Gitar on #4297)
  ipcMain.handle('linkedinJobsConnect', () => { if (DEMO) return {opened: true}; session.openSignin(storage); return openPage(); });   // the shortcut: the extension's own consent page (browser-handlers.js), where Chrome asks for a permission on a click; no extension = {opened: null}
  // The sign-in window: the person types their password on LinkedIn's own page; the two session cookies LinkedIn then sets go to the Keychain; the window then turns on the switch that asked (linkedinJobsOn, easyApplyOn). One line per press, never a value.
  ipcMain.handle('linkedinJobsSignIn', async () => {
    if (DEMO) return {ok: true};
    // Why (Gitar on #3080, 3 Nov 2026; 14 Nov 2026, owner: "Let's store them in Keychain/Credentials Manager (windows)"): the session is kept only in the Mac's Keychain or
    // Windows' Credential Manager (lib/keychain.js hasStore; an isolated run keeps its own file), never a file on disk, so a computer with neither (Linux) refuses before the window opens.
    if (!realKeychain.hasStore(deps.platform || process.platform) && !(deps.isolated ?? realKeychain.isolated())) {
      log('linkedin-jobs', 'press', {path: 'window', outcome: 'no-keychain'});
      return {ok: false, reason: 'no-keychain'};
    }
    const got = await signIn();
    const saved = got.ok ? session.saveSession(storage, got.cookies, deps) : got;
    log('linkedin-jobs', 'press', {path: 'window', outcome: saved.ok ? 'signed-in' : (got.ok ? 'not-kept' : got.reason)});
    return saved.ok ? {ok: true} : {ok: false, reason: got.ok ? 'not-kept' : got.reason, error: saved.error};
  });
  ipcMain.handle('linkedinJobsOn', () => (DEMO ? {ok: true} : session.turnOn(storage)));   // the sign-in already kept (signed in for Easy Apply): nothing is asked
  ipcMain.handle('linkedinJobsOff', () => (DEMO ? {ok: true} : session.turnOff(storage, deps)));
}
