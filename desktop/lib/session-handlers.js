// Register the real session IPC flows with injected app services, so scenarios exercise the same handlers as Electron.
import fs from 'node:fs';
import path from 'node:path';
import {backgroundApplyFor} from './background-apply-controller.js';
import * as terminals from './terminals.js';
import * as sessionRuns from './session-runs.js';
import * as transcript from './transcript.js';
import * as quitDialog from './quit-dialog.js';
import {sessionIpc} from './session-contracts.js';
import {closeFormTab, openFormTab} from './form-tab.js';
import {sessionsNamedIn} from './session-tab.js';
import {keepForJob} from './ready-handoff.js';
import {readHandoff} from './live-view-handlers.js';

// Close a session's form tab and say whether it is closed. A tab the app already knows is gone needs no wait: asking its page
// to close costs the whole 6 s timeout when nobody answers (a cancel took 5-10 s with no sign of life, 3 Oct 2026).
export async function closeSessionTab({review, closeTab}, old) {
  if (review.tabOpen?.(old.id) === false) return true;
  return (await review.delivered(old.id, 6000)) || await closeTab({id: old.id, boundTab: review.tabOf(old.id)});
}

import {cleanUse} from './proposal-use.js';
import {boardName} from './control-events.js';
import {stopLiveForms} from './stop-all.js';
import {demoPath} from './demo.js';
import {SHOW_RESUME_CLAUDE} from '../renderer/claude-help.js';
import {beingSent, cancellable} from '../renderer/session-state.js';
import * as journal from './session-journal.js';

/** -> the session listener for terminals.onChange: each change also writes the live step log, and a new step of the log tells the window ('journal': the Sessions page redraws if shown). */
export function watchSessions(toWindow) {
  journal.onChange(() => toWindow('session', 'journal', {}));
  return (event, payload) => {
    if (event === 'update') journal.observe(payload);
    toWindow('session', event, payload);
  };
}
const REOPEN_MS = 15 * 1000;
export function registerSessionHandlers({ipcMain, appLog, storage, getWindow, dialog, nativeImage, here,
  DEMO, extensionGate = () => null, apply, pipeline, review, server, claudeConsent, getRecipeReporter = () => null, version = '',
  closeTab = closeFormTab, focusTab = openFormTab, background = () => backgroundApplyFor(storage), keepHandoff = keepForJob}) {
  const reopenedAt = new Map();   // session id -> when Reopen last opened its form: a second press inside REOPEN_MS opens nothing
  const checkedSessions = sessionIpc(ipcMain, appLog);
  // Store writes one at a time: each is its own engine process, and Cancel all closes many tabs at once (SQLite locks, Notion's rate limit).
  let storeTail = Promise.resolve();
  const storeTurn = work => { const result = storeTail.then(work); storeTail = result.catch(() => {}); return result; };
  // One application cancelled, the person already asked: its fill stops, its tab (Chrome's or the hidden browser's) closes, the job goes back to Kit ready, the session leaves.
  // Read again here: while the question was open it may have been submitted, or started sending (session-state.js cancellable); then it is left alone ({ok: true, skipped}).
  async function cancelOne(id) {
    const old = terminals.get(id);
    if (!old || !cancellable([old]).length) return {ok: true, skipped: true};
    const started = Date.now();
    terminals.stop(old.id);
    review.queueClose(old.id);
    const closed = old.background ? (await background().cancel(old.id)).closed : await closeSessionTab({review, closeTab}, old);
    const reset = DEMO ? {ok: true} : await storeTurn(() => pipeline.unapply(storage, old.url)).catch(error => ({ok: false, error: error.message}));
    if (!reset.ok) return {ok: false, error: `Notion: ${reset.error || 'not updated'}. The session stays; try again.`, closed};
    appLog('sessions', 'cancelled by the user: job back to Kit ready, session removed', {id: old.id, closed: !!closed, ms: Date.now() - started});
    terminals.setOutcome(old.id, 'cancelled');
    terminals.remove(old.id);
    return {ok: true, closed};
  }
  const ask = async ({message, detail, buttons}) => (await dialog.showMessageBox(getWindow() && !getWindow().isDestroyed() ? getWindow() : undefined,
    {type: 'none', icon: nativeImage.createFromPath(path.join(here, 'assets', 'icon.png')), buttons, defaultId: 1, cancelId: 1, message, detail})).response === 0;
  checkedSessions.handle('sessionCancel', async (_, id) => {
    const old = terminals.get(String(id));
    if (!old) return {ok: false, error: 'This session is no longer in the list.'};
    if (beingSent(old)) return {ok: false, error: `${old.company || 'This application'} is being sent right now. Its reply from the site settles it; wait a moment.`};
    if (!await ask(quitDialog.cancel(old.company))) return {ok: false, cancelled: true};
    return cancelOne(old.id);
  });
  // Why (5 Nov 2026, owner: "remove the "Stop extension" button. And we should add another button isntead which woudl be … "Cancel all applications""): every
  // application not finished yet (filling, queued, waiting on the person, ready) is cancelled the one way Cancel application does it, after one question. The Stop
  // switch is not pressed: closing each tab ends its work, and a Stop would hold the next batch for STOP_ASK_MS (lib/server-hooks.js). Stop stays in ⌘K and ⋯.
  checkedSessions.handle('sessionsCancelAll', async () => {
    const open = cancellable(terminals.list()).filter(item => !item.cancelling);   // a second press while the first works asks and cancels nothing twice
    if (!open.length) return {ok: true, count: 0};
    if (!await ask(quitDialog.cancelAll(open))) return {ok: false, cancelled: true};
    // Why (7 Nov 2026, owner: "Cancel all gives no feedback while it works… only a greyed button and the old list still showing"): the store is written one job at a time, so the last
    // row leaves seconds after the yes. Every row says "Cancelling…" from the yes (the window reads it in the session list) and leaves, or goes back to its state, at its own end.
    for (const old of open) terminals.setCancelling(old.id, true);
    // All at once: a tab that does not answer costs its own wait, not every later one's (review of [ap] 3/7). A throw is that application's failure only.
    const results = await Promise.all(open.map(old => cancelOne(old.id).catch(error => ({ok: false, error: String(error?.message || error)}))
      .then(result => { if (!result.ok || result.skipped) terminals.setCancelling(old.id, false); return result; })));   // a refused or skipped one stops saying "Cancelling…" at its own end
    const failed = open.filter((_, i) => !results[i].ok).map(old => old.company || old.id);
    const count = results.filter(result => result.ok && !result.skipped).length;
    appLog('sessions', 'Cancel all applications', {asked: open.length, cancelled: count, failed: failed.length});
    return failed.length ? {ok: false, count, error: `Not cancelled: ${failed.join(', ')}. Try again.`} : {ok: true, count};
  });
  // Skip this role: give up on the job. Claude stops, the form tab closes, the job is Dismissed in Notion (hidden from the
  // list, as Dismiss in its menu), the session goes. No question: the button says it.
  checkedSessions.handle('sessionSkip', async (_, id) => {
    const old = terminals.get(String(id));
    if (!old) return {ok: false, error: 'This session is no longer in the list.'};
    const started = Date.now();
    terminals.stop(old.id);
    review.queueClose(old.id);
    const closed = old.background ? (await background().cancel(old.id)).closed : await closeSessionTab({review, closeTab}, old);
    // Applying is undone first (back to what it was: Kit ready), then the job is dismissed.
    const reset = DEMO ? {ok: true} : await pipeline.unapply(storage, old.url).catch(error => ({ok: false, error: error.message}));
    if (!reset.ok) return {ok: false, error: `Notion: ${reset.error || 'not updated'}. The session stays; try again.`, closed};
    const dismissed = DEMO ? {ok: true} : await pipeline.setStatus(storage, old.url, 'dismissed').catch(error => ({ok: false, error: error.message}));
    if (dismissed.ok === false) return {ok: false, error: `Notion: ${dismissed.error || 'could not dismiss the job'}. Dismiss it from its menu.`, closed};
    appLog('sessions', `skipped by the user: job dismissed, session removed`, {id: old.id, closed: !!closed, ms: Date.now() - started});
    terminals.setOutcome(old.id, 'cancelled');
    terminals.remove(old.id);
    return {ok: true, closed};
  });
  // A new session on the same job, this one closed (its statistics are kept in Notion): in Chrome (a form session, the
  // extension fills it) or with Claude, as the person chose. Start again never starts Claude by itself.
  const details = old => ({title: old.title, company: old.company, location: old.location, workMode: old.workMode});
  const restartAs = async (old, how) => {
    if (how === 'claude' && !SHOW_RESUME_CLAUDE) return {ok: false, error: 'Applying by session is not available in this version. Use Fill in Chrome.'};
    if (how === 'claude' && !(await claudeConsent())) return {ok: false, error: 'Apply with Claude is off. Allow it in Settings.'};
    const missing = how === 'claude' || DEMO ? null : extensionGate();   // a Chrome form with no extension to fill it: install it first
    if (missing) return missing;
    terminals.setOutcome(old.id, 'restarted');
    // The new session first, then the old one goes: removed first, the page fell to another session for a moment (owner, 8 Oct 2026).
    const started = how === 'claude' ? await apply.claudeOne(storage, old.url, undefined, undefined, undefined, details(old))
      : DEMO ? apply.openOne(old.url, {session: old.id}) : await apply.applyOne(storage, old.url, details(old));
    appLog('sessions', `started again by the user: ${how}`, {id: old.id, kind: old.kind, ok: !!started?.ok, next: started?.session?.id || ''});
    if (started?.session?.id) terminals.show(started.session.id);
    if (started?.ok) terminals.remove(old.id); else terminals.setOutcome(old.id, '');
    return started;
  };
  // "Open in my browser" on a hidden-browser session (owner's live view design, 28 Oct 2026): a hidden browser has no window to show, so the held page's
  // hand-off (its address, cookies, storage and filled fields: Ready to send's ready-handoff.js) is kept for the job's addresses, the hidden tab closes, and
  // the same job opens in the person's Chrome, where the extension puts the page back and its normal fill takes over. Nothing is submitted.
  const openInChrome = async old => {
    const handed = await background().handOver(old.id, readHandoff);
    if (!handed?.ok) return {ok: false, error: 'This application\'s hidden form could not be handed over. Try again.'};
    if (handed.handoff) keepHandoff(handed.handoff, old.url);
    return restartAs(old, 'chrome');
  };
  checkedSessions.handle('sessionRestart', async (_, id) => {
    const old = terminals.get(String(id));
    if (!old) return {ok: false, error: 'This session is no longer in the list.'};
    // Always in Chrome, no question (owner, 9 Oct 2026: "start with Chrome always; Claude should be only a safety net"): the extension fills the
    // form; where it can't finish, the card and the panel offer Claude as they already do.
    return old.background ? openInChrome(old) : restartAs(old, 'chrome');
  });
  // The session's form tab was closed (a button looked for it and Chrome has none): the form opens again in a new tab with
  // the fill mark, so the extension's panel follows it. What the page held from the closed tab (`stale`: answers, form
  // progress, the stuck flag) is cleared.
  // "Use" on a Needs your attention row: the form's panel fills that one field through the extension (lib/review.js queueFill).
  // Logged: which session and field, never the value. The row checks the next report to see that it took.
  checkedSessions.handle('sessionFillField', (_, id, label, value) => {
    if (!String(value).trim()) return {ok: false, error: 'Write an answer first.'};
    if (DEMO) return {ok: true};   // the demo's sessions have no tab: its rows show the answer as filled (27 Oct 2026, Fill it in goes through here)
    if (!terminals.get(String(id))) return {ok: false, error: 'This session is no longer in the list.'};
    review.queueFill(String(id), label, value.trim());
    appLog('review', `fill one field asked from the session page`, {id, field: String(label).slice(0, 60)});
    return {ok: true};
  });
  // What the person did with a proposed answer (lib/proposal-use.js): fixed words, counted by the form's board and this app's version.
  checkedSessions.handle('sessionProposalUse', (_, id, source, act) => {
    const state = review.allStates().find(item => item.id === String(id));
    let host = '';
    try { host = new URL(String(state?.url || terminals.get(String(id))?.url || '')).hostname; } catch { /* no address */ }
    const use = cleanUse({board: boardName(host), source, act, v: version});
    if (!use) return {ok: false};
    if (act !== 'shown') appLog('review', `proposed answer ${act}`, {id, source, board: use.board});   // the decision, never the value
    getRecipeReporter()?.proposalUse(use);
    return {ok: true};
  });
  // The Stop button (owner, 13 Oct 2026): the extension is asked to stop everything it does (it hears it in the answer to its next report, extension/stop.js), and the live forms say
  // "Stopped" at once; the extension's own word that it stopped (its popup, its page button, Chrome's Cancel on the debugging bar) marks them the same way. Reopen form starts one again.
  checkedSessions.handle('sessionsStopExtension', () => {
    const request = server.requestStop();
    const marked = stopLiveForms(terminals);
    appLog('extension', 'Stop pressed in the app: the extension is asked to stop, live forms say Stopped', {request, marked});
    return {ok: true};
  });
  checkedSessions.handle('sessionReopen', async (_, id, stale) => {
    const old = terminals.get(String(id));
    if (!old) return {ok: false, error: 'This session is no longer in the list.'};
    if (old.background) return openInChrome(old);
    // No question (owner, 8 Oct 2026): the card already says Reopen fills the form again from your kit, so what the page held
    // from the closed tab is cleared and the form opens in a new tab. Claude is never started here; Start again is for that.
    // The tab may still be open under another address (redirected to the employer's own site, 15 Oct 2026: two presses opened two new tabs): its fill mark
    // names it on any host in any window (lib/session-tab.js), so it is focused instead, and a form is opened only when no tab carries the mark.
    // A stopped session opens a NEW tab, as its card says ("the form already open in Chrome is left as it is"): focusing the stopped tab started nothing (owner, 27 Oct 2026).
    const stopped = old.stuck === 'stopped';
    const live = stopped ? 'none' : await focusTab({id: old.id, boundTab: review.tabOf(old.id)}).catch(() => 'none');
    if (live === 'tab') { appLog('review', `tab gone ${old.id}: its tab is open (marked), focused it instead of reopening`, {kind: old.kind}); return {ok: true, reset: false, focused: true}; }
    if (Date.now() - (reopenedAt.get(old.id) || 0) < REOPEN_MS) { appLog('review', `tab gone ${old.id}: reopen pressed again while the form opens, nothing more opened`); return {ok: true, reset: false, focused: false}; }
    const reset = !!stale || stopped;
    if (reset) { review.forget(old.id); terminals.clearStuck(old.id); }
    appLog('review', `tab gone ${old.id}: ${reset ? 'cleared the closed tab\'s state, reopening' : 'nothing to clear, reopening'}`, {kind: old.kind});
    reopenedAt.set(old.id, Date.now());
    // From the first step, the job posting (owner, 16 Oct 2026: a form's saved address lost its site session and showed an error): its Apply leads to the form again.
    const opened = apply.openOne(old.url, {session: old.id, reuse: true});   // the same session: its new tab carries its id
    appLog('review', `tab gone ${old.id}: ${opened.ok ? 'reopened the form with the fill mark' : 'could not reopen'}`, {reset, error: opened.error || ''});
    return opened.ok ? {ok: true, reset} : {ok: false, error: opened.error};
  });
  // Apply with Claude sessions inside the app (lib/terminals.js): the dock, the session page and its terminal.
  // Demo mode: fictional sessions (demo/sessions.json) for screenshots; nothing runs.
  const demoSessions = () => JSON.parse(fs.readFileSync(demoPath(here, 'sessions.json'), 'utf8'));
  checkedSessions.handle('sessions', () => {
    const started = Date.now();
    const list = DEMO ? demoSessions() : terminals.list().map(item => (item.background ? {...item, journal: journal.journalOf(item.id)} : item));
    const ms = Date.now() - started;
    if (ms >= 50) appLog('sessions', 'list was slow', {count: list.length, ms});
    return list;
  });
  const demoOutput = () => (process.env.JOBADABRA_DEMO_OUTPUT ? fs.readFileSync(process.env.JOBADABRA_DEMO_OUTPUT, 'utf8')  // a recorded session
    : '\x1b[2m19:10:02\x1b[0m \x1b[32m✓\x1b[0m Loaded your application, Profile and answers from Notion\r\n\x1b[2m19:10:06\x1b[0m \x1b[32m✓\x1b[0m Opened the posting in Chrome\r\n' +   // about Notion
      '\x1b[2m19:10:09\x1b[0m \x1b[33m!\x1b[0m Location: San Francisco, CA · On-site\r\n\x1b[2m19:10:11\x1b[0m \x1b[35m⏸\x1b[0m Paused before opening the form. Waiting for your reply…\r\n\r\n\x1b[1m>\x1b[0m ');
  checkedSessions.handle('sessionOutput', (_, id) => (DEMO ? demoOutput() : terminals.output(String(id))));
  // The log's screen when it opens (see terminals.snapshot); JOBADABRA_DEMO_OUTPUT replays a recorded session in demo mode.
  // A finished session as a conversation (its Claude Code transcript), for the log's page-text view.
  checkedSessions.handle('sessionTranscript', (_, id) => {
    const record = DEMO ? null : terminals.record(String(id));
    const file = DEMO ? demoPath(here, 'transcript.jsonl') : record?.transcript;
    const talk = file ? transcript.conversation(file) : null;
    if (talk?.length || DEMO || !record?.runPage) return talk;
    // The Mac's transcript is gone (Claude Code deletes old ones): the copy on the session's Agent Runs row.
    return sessionRuns.loadConversation(storage, record.runPage).catch(() => null);
  });
  checkedSessions.handle('sessionSnapshot', (_, id) => (DEMO ? terminals.snapshotOf(demoOutput()) : terminals.snapshot(String(id))));
  checkedSessions.handle('sessionWrite', (_, id, data) => terminals.write(String(id), data));
  checkedSessions.handle('sessionResize', (_, id, cols, rows) => terminals.resize(String(id), Number(cols), Number(rows)));
  checkedSessions.handle('sessionStop', (_, id) => terminals.stop(String(id)));
  checkedSessions.handle('sessionResume', async (_, id) => (await claudeConsent()) ? apply.resumeSession(storage, String(id)) : {ok: false, error: 'Cancelled.'});
  checkedSessions.handle('sessionRemove', async (_, id) => {
    const old = terminals.get(String(id));
    if (old?.background) {
      const retired = await background().cancel(old.id);
      if (!retired.ok) throw new Error(retired.error || 'The background application could not be stopped.');
    }
    terminals.remove(String(id));
  });
  // Its job is already Applied: the form was submitted, so the session ends (recorded as submitted, then gone).
  checkedSessions.handle('sessionSubmitted', (_, url) => (DEMO ? null : server.sessionSubmitted(String(url))));
  // Removing a session whose job is still Applying: was it submitted? Notion first; the session goes only if that worked.
  checkedSessions.handle('sessionFinish', async (_, id) => {
    const found = terminals.get(String(id));
    if (!found) return {ok: true};
    if (found.background) return {ok: false, error: 'Open the same form to review it. Jobadabra marks it Applied only when the site confirms submission.'};
    const {message, detail, buttons} = quitDialog.submitted(found.company);
    const {response} = await dialog.showMessageBox(getWindow() && !getWindow().isDestroyed() ? getWindow() : undefined,
      {type: 'none', icon: nativeImage.createFromPath(path.join(here, 'assets', 'icon.png')), buttons, defaultId: 0, cancelId: 2, message, detail});
    if (response === 2) return {ok: false, cancelled: true};
    const result = DEMO ? {ok: true} : response === 0 ? await pipeline.setStatus(storage, found.url, 'applied') : await pipeline.unapply(storage, found.url);
    if (result.ok) terminals.setOutcome(String(id), response === 0 ? 'submitted' : 'not submitted');  // its statistics, before it goes
    if (!result.ok) return {ok: false, error: result.error || 'It could not be saved.'};
    terminals.remove(String(id));
    return {ok: true, submitted: response === 0};
  });
  // At start: sessions left open (the app closed, or was killed) whose jobs are still Applying. They are all kept, with no
  // question: a session's state is preserved, so it waits in Application sessions (Resume Claude) and the job's own
  // "I submitted it" / Cancel handle the rest. `kept` counts the ones whose form is still open in Chrome (for the toast).
  checkedSessions.handle('sessionsLeftOpen', async (_, ids) => {
    const all = (Array.isArray(ids) ? ids : []).map(id => terminals.get(String(id))).filter(Boolean);
    // What is open comes from the extension's report first (every browser it runs in), with Chrome's own scripting
    // added when it can see anything: a stray background Chrome made that scripting list empty, and sessions whose
    // forms were open looked closed (1 Oct 2026).
    const open = DEMO ? new Set() : sessionsNamedIn(all, server.openTabs());
    terminals.markAsked(all.map(session => session.id));
    return {choice: 'keep', kept: open.size};
  });
}
