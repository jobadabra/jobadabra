// The controller's side of the cloud hand-over (cloud browser runner cs 4/4, model A, spec docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md "cs 4/4 Design"): which Full automation items can go,
// the move of one to the cloud, and the site's outcome written back as the item's own end. The store (lib/background-apply-store.js) is the item's one owner; this only moves the Sessions record, the window and the mails with it.
// Invariants: an item sent is never acted on by the Mac again (the store refuses its claims, `ready` and `reserve`); an outcome never overwrites a receipt; a refused or failed send puts the item back where it was.
// Guard: test/unit/main/background-apply-cloud.test.js.
import {activityText, activityHandoff} from '../i18n/activity-notices.js';

const RETRY = Object.freeze({ok: false, retry: true});   // take(): the store write failed, the outcome is still owed
const BEFORE_PRESS = new Set(['queued', 'preflight', 'filling', 'ready_for_review', 'waiting_to_submit']);   // the store's states before a press (background-apply-store.js)

/**
 * deps: {store, terminals, serial, cache(item, state), closeSession(id), itemFor(session), notify, tellAway(item, note), applied() -> the applied-mail sender, log, now}.
 * -> {candidates(), send(session), unsend(session), take(session, outcome)}; each never throws.
 */
export function createCloudSide({store, terminals, serial, cache, closeSession, itemFor, notify, tellAway, applied, log, now}) {
  const going = state => !!state && state.mode === 'auto' && !state.manualOverride && (BEFORE_PRESS.has(state.state) || state.state === 'cloud');
  return {
    /** The Full automation items the cloud may hold: every one of this run's sessions still before its press, or already sent. -> [{session, url, title, company, state}] (state: the store's own record, the item's stamp). */
    async candidates() {
      const found = [];
      for (const item of terminals.list().filter(entry => entry.background && !entry.outcome && entry.background.mode === 'auto')) {
        const state = await store.read(item.url).catch(() => null);
        if (state?.session === item.id && going(state)) found.push({session: item.id, url: item.url, title: item.title, company: item.company, state});
      }
      return found;
    },
    /** Marks the item sent in the store: from here the Mac never presses it. The hidden tab stays until the site took the batch (`closeLocal`). -> the saved state, or null (cannot press any more). */
    send: session => serial(async () => {
      const item = itemFor(session);
      if (!item) return null;
      const state = await store.sendToCloud(item.url, session).catch(() => null);
      if (!state) return null;
      cache(item, state);
      return state;
    }),
    /** The site did not take it: back to where it was. */
    unsend: session => serial(async () => {
      const item = itemFor(session);
      const state = item ? await store.unsend(item.url, session).catch(() => null) : null;
      if (state) cache(item, state);
      return state;
    }),
    /** The site took it and started: the local hidden tab closes (nothing there will press it). */
    closeLocal: session => closeSession(session).catch(() => false),
    /** One outcome of the cloud written as the item's end: a receipt (the "applied" mail and notice, as the Mac's own send), or a hand-off to the person with the reason in plain words. -> the saved state, `{ok: false, retry: true}` (the store write failed: the caller keeps the outcome and tries again), or null (not a cloud item any more: the caller drops it). */
    take: (session, outcome) => serial(async () => {
      const item = itemFor(session);
      if (!item) return null;
      // Why (#3815): the site deleted its copy when it handed the outcome over, so a failed write must not look like "no such item" (null): cloud-auto drops an outcome on null and keeps it on a retry answer.
      let failed = false;
      const state = await store.fromCloud(item.url, session, outcome).catch(error => { failed = true; log('apply', 'cloud outcome not written', {error: String(error?.message || error).slice(0, 120)}); return null; });
      if (failed) return RETRY;
      if (!state || state.ok === false) return null;
      cache(item, state);
      if (state.state === 'receipt_confirmed') {
        // Why (8 Nov 2026, owner: "an e-mail for every automation"): the cloud's send is Full automation sending too; its attempt is the site's own reservation (store.fromCloud keeps it).
        try { applied().add({id: item.id, title: item.title, company: item.company, at: now()}); } catch (error) { log('apply', `applied message not queued: ${error.message}`); }
      } else {
        notify(activityText('needsYou'), activityHandoff(state.reason, state.reason === 'submission_outcome_unknown' ? 'outcomeUnknown' : 'reviewSelf'), {view: 'sessions', session: item.id}, 'warn');
        tellAway(item, activityHandoff(state.reason, state.reason === 'submission_outcome_unknown' ? 'outcomeUnknown' : 'reviewSelf'));
      }
      log('apply', 'cloud outcome written', {session: item.id, state: state.state, reason: state.reason || ''});
      return state;
    }),
  };
}
