// The owner's answer to feedback this install sent ("fixed in 0.9.12", "noted, not now"), shown once as a card in the app (renderer/pages/feedback-reply.js).
// The website keeps the answer (GET /api/feedback/replies, jobadabra-web api/feedback-replies.js). The app proves itself with the key it already holds, JPF1.<install>.<token> (the trial count's proof):
// the install id alone is not a credential. No key (demo, a site switched off for this user): no card.
// Asked at start and every few hours, like the trial count (lib/trial-server.js). Offline or refused: no card, nothing throws. Closing a card tells the website, which stops sending it.
// Guarded by test/unit/main/app-feedback-replies.test.js.
import {newer} from './updater.js';
import {ENDPOINT} from './app-feedback.js';
import {TRIAL_KEY} from './ai-free.js';

const BASE = ENDPOINT.replace(/\/feedback$/, '/feedback/replies');
const EVERY = 6 * 60 * 60 * 1000, RETRY = 15 * 60 * 1000;   // a failed ask (offline, key not minted yet) is tried again in 15 minutes, not 6 hours
const keyOf = storage => [storage.secret(TRIAL_KEY), storage.secret('ANTHROPIC_API_KEY')].find(key => /^JPF1\./.test(key || '')) || '';

/** What the card says about when the fix reaches this install. `fixedIn` is what the owner typed ("0.9.12", "0.9.12 (beta)") or "" for "the next update". */
export function arrival(reply, installed) {
  if (reply.kind !== 'fixed') return '';
  const version = String(reply.fixedIn || '').match(/\d+\.\d+\.\d+(?:-[\w.]+)?/)?.[0];
  if (!version) return 'It arrives with the next update.';
  const core = text => String(text).replace(/-.*$/, '');   // a test build of that version (0.9.12-alpha.5) has the fix as much as the release does
  return newer(core(version), core(installed || '0.0.0')) ? `It arrives in ${version}.` : `Fixed in ${version}: you have it.`;
}

/** The replies waiting for this install, each with its `arrival` line. -> [{ref, on, excerpt, kind, message, arrival}], [] when nothing waits; null when there was no answer (offline, refused, no key yet, a shape we do not expect), so the caller can try again soon. */
export async function fetchReplies(storage, {version, fetcher = globalThis.fetch, base = BASE} = {}) {
  try {
    const key = keyOf(storage);
    if (!key) return null;
    const response = await fetcher(base, {headers: {'x-api-key': key}});
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok || !Array.isArray(body.replies)) return null;
    return body.replies.filter(reply => reply && typeof reply.ref === 'string' && reply.ref).slice(0, 5).map(reply => ({
      ref: reply.ref, on: /^\d{4}-\d{2}-\d{2}$/.test(reply.on) ? reply.on : '', excerpt: String(reply.excerpt || '').slice(0, 80), kind: reply.kind === 'fixed' ? 'fixed' : 'deferred',
      message: String(reply.message || '').slice(0, 600), arrival: arrival(reply, version)}));
  } catch { return null; }
}

/** The person closed a card. -> true when the website took it; false leaves the card to come back at the next ask. */
export async function closeReply(storage, ref, {fetcher = globalThis.fetch, base = BASE} = {}) {
  try {
    const key = keyOf(storage);
    if (!key) return false;
    const response = await fetcher(`${base}/seen`, {method: 'POST', headers: {'Content-Type': 'application/json', 'x-api-key': key}, body: JSON.stringify({ref: String(ref)})});
    return response.ok;
  } catch { return false; }
}

/** IPC: `feedbackReplies()` -> the cards to show now; `feedbackReplyClose(ref)` closes one. Asks the website at the first call and every 6 hours after an answer (15 minutes after none);
 *  a card the person closed is never drawn again here, and its post is retried at each ask until the website took it. Demo mode has none. */
export function registerReplies({DEMO, app, ipcMain, storage, fetcher, now = Date.now}) {
  let cards = [], asked = -Infinity, retryAt = 0;
  const closed = new Map((storage.settings().feedbackRepliesClosed || []).map(ref => [ref, false]));   // ref -> true once the website took the close
  // Why (Gitar on #3044): a close that could not be posted must survive a restart, or the card returns after "Got it". Only the refs not yet taken are kept.
  const keep = () => storage.saveSettings({feedbackRepliesClosed: [...closed].filter(([, taken]) => !taken).map(([ref]) => ref).slice(-50)});
  ipcMain.handle('feedbackReplies', async () => {
    if (DEMO) return [];
    if (now() - asked >= EVERY && now() >= retryAt) {
      for (const [ref, posted] of closed) if (!posted) closed.set(ref, await closeReply(storage, ref, {fetcher}));
      keep();
      const got = await fetchReplies(storage, {version: app.getVersion(), fetcher});
      if (got === null) retryAt = now() + RETRY; else { cards = got; asked = now(); }
    }
    return cards.filter(card => !closed.has(card.ref));
  });
  ipcMain.handle('feedbackReplyClose', async (_, ref) => {
    closed.set(ref, false);   // closed for good on this screen; the post may fail and is retried
    if (DEMO) { closed.set(ref, true); return true; }
    keep();   // written before the post: a quit during it still hides the card next time
    const taken = await closeReply(storage, ref, {fetcher});
    closed.set(ref, taken);
    keep();
    return taken;
  });
}
