// LinkedIn Easy Apply in Background and Full automation, plan 4a-2b (spec docs/superpowers/specs/2026-11-13-linkedin-easy-apply-design.md): LinkedIn jobs fill in today's hidden
// browser like any other site; the person's LinkedIn sign-in is the only LinkedIn part.
// Why (13 Nov 2026, owner, asked via AskUserQuestion: "Today's browser (Recommended)", replacing "LinkedIn-only hidden browser"; earlier "It should just support all 3 apply modes.
// like any other website. nothing custom/special here"): no second browser or controller. The sign-in goes into the hidden browser when a LinkedIn job is about to open, and leaves it
// as soon as no LinkedIn job is open there (expired in the browser's cookie store, which Chrome writes to its file within about 30 s). A browser killed before that write is
// cleaned at the next app start, before any browser starts (lib/linkedin-browser.js sweepBeforeAnyStart: every LinkedIn row deleted with secure_delete), as for the read (#3711).
// D3: a LinkedIn job handed to the person at a check or a sign-in page stops all LinkedIn work for 24 h (lib/easy-apply-limits.js noteStop, the one shared pause); while paused,
// or with Easy Apply off or no sign-in kept, a LinkedIn job that has not opened yet goes to the person instead of opening. A form already open for the person keeps the sign-in.
// Invariant: the session value is only in lib/linkedin-jar.js's Storage.setCookies call: never in a log, a result, the store or a thrown error.
import * as realSession from './linkedin-session.js';
import {state as easyApplyState} from './easy-apply-switch.js';
import {noteCounted, noteStop, stopNotedAt, turn as limitsTurn} from './easy-apply-limits.js';
import {clearJar, jar} from './linkedin-jar.js';
import {notRunning} from './background-browser.js';
import {sweepLinkedinLeftovers} from './linkedin-browser.js';
import {linkedinAddress} from './submit-proof.js';

const STOPPING = new Set(['captcha_runtime', 'captcha_preflight', 'sign_in_required']);   // words-ok: our own hand-off reason ids (extension/background-session.mjs observe), not page knowledge
const NOT_OPENED = new Set(['queued', 'preflight']);
/** What the card and the live step log say for each hand-over this file makes (merged into the controller's NOTICES). */
export const LINKEDIN_NOTICES = {
  linkedin_paused: 'LinkedIn asked for a check or a sign-in, so Jobadabra leaves LinkedIn alone for 24 hours. Open the job and apply on LinkedIn yourself, or try again later.',
  linkedin_off: 'LinkedIn Easy Apply is off, so this job was not opened. Turn it on in Settings → Connections, or open the job and apply on LinkedIn yourself.',
  linkedin_signin: 'Jobadabra has no LinkedIn sign-in, so this job was not opened. Renew it with ⌘K → Renew LinkedIn sign-in, or apply on LinkedIn yourself.',
};   // words-ok: our own hand-off reason ids and user-facing words, not page knowledge
/** What the card says when the Mac's Submit gate hands a filled LinkedIn form to the person (lib/easy-apply-limits.js sendTurn); the form stays open, so these are not LINKEDIN_NOTICES. */
export const LINKEDIN_SEND_NOTICES = {
  linkedin_not_confirmed: 'This LinkedIn application is filled, but sending on LinkedIn was not confirmed for this batch. Check it and press Submit yourself, or pick Full automation again (Apply to jobs or Settings → Apply) and confirm sending on LinkedIn.',
  linkedin_send_off: 'This LinkedIn application is filled, but LinkedIn Easy Apply was turned off before it was sent. Check it and press Submit yourself.',
  linkedin_send_paused: 'LinkedIn asked for a check or a sign-in, so Jobadabra sends nothing on LinkedIn for 24 hours. This application is filled: check it and press Submit yourself, or try again later.',
};   // words-ok: our own hand-off reason ids and user-facing words, not page knowledge

/**
 * One controller's LinkedIn side. `send(method, params)`: a CDP call to the hidden browser (lib/background-browser.js send). `log(area, message, fields)`. `sweep()`: delete the
 * LinkedIn rows from the closed kept browser's cookie files (lib/linkedin-browser.js sweepLinkedinLeftovers; -> {keptRunning?}).
 * -> {settle(found, handOver)}. A poll with no LinkedIn job makes no browser call and reads no setting.
 */
export function easyApplyBatch({storage, send, readSession = realSession.readSession, now = Date.now, log = () => {}, sweep = () => sweepLinkedinLeftovers(storage)}) {
  let inside = false;
  const browser = {send};
  async function put(session) {
    const first = !inside;
    inside = true;   // before the call: a put that throws may still have written the cookies, so a later poll must expire them (Gitar on #4096)
    await send('Storage.setCookies', {cookies: jar(Object.entries(session), now(), false)});
    if (first) log('easy-apply', 'LinkedIn sign-in put into the hidden browser for this batch', {});
  }
  async function out() {
    try {
      await clearJar(browser, realSession.COOKIE_NAMES.map(name => [name, '']), now());   // the names are the floor; every LinkedIn cookie held is expired too
    } catch (error) {
      if (!notRunning(error)) throw error;
      // Why (Gitar on #4109): the browser closed with the sign-in in it (a quit or a crash mid-batch): no live browser holds it, but its cookie file may, so the rows go now,
      // not at the next app start; a browser that came back in the meantime is cleared through itself on the next poll.
      if ((await sweep())?.keptRunning) throw error;
    }
    if (inside) log('easy-apply', 'LinkedIn sign-in taken out of the hidden browser: no LinkedIn job open', {});
    inside = false;
  }
  // Whether a LinkedIn job may open: the switch, the shared 24 h pause, then a sign-in in the Keychain (read only here, never kept past this poll). -> {reason} | {session}.
  function turn() {
    if (!easyApplyState(storage).on) return {reason: 'linkedin_off'};
    if (realSession.pausedUntil(storage) > now()) return {reason: 'linkedin_paused'};
    const session = readSession();
    return session ? {session} : {reason: 'linkedin_signin'};
  }
  /**
   * One poll's look at the open background jobs, before any job is opened. `found`: [[item, {state} | null]] (the controller's poll); `handOver(item, reason)` -> the new state.
   * Notes a D3 stop once per hand-off, hands every LinkedIn job not opened yet to the person when it may not open (its entry's state is replaced, so no launch goes out),
   * puts the sign-in in when a LinkedIn job will open, and takes it out when none is open. -> nothing; never throws.
   */
  async function settle(found, handOver) {
    const mine = found.filter(([item, each]) => each && linkedinAddress(item.url));
    if (!mine.length && !inside) return;   // no LinkedIn job and no sign-in in the browser: nothing to read or do
    // Why (Gitar on #4109): counted by the store's own hand-off times, never the poll's clock. A hand-off while LinkedIn is already paused is the same stop (a job that was open
    // when the first check came), so a burst of checks is one stop, and the next check after the pause ends is the second (D3: it turns Easy Apply off).
    const counted = stopNotedAt(storage), pausedTo = realSession.pausedUntil(storage);
    const fresh = mine.filter(([, each]) => STOPPING.has(each.state.reason) && (Number(each.state.handoffAt) || 0) > counted);
    if (fresh.length) {
      const newest = Math.max(...fresh.map(([, each]) => Number(each.state.handoffAt) || 0));
      const first = fresh.find(([, each]) => !(pausedTo > (Number(each.state.handoffAt) || 0)));
      const {until, off} = first ? noteStop(storage, new Date(now()), newest) : noteCounted(storage, newest);
      if (first) log('easy-apply', 'LinkedIn showed a check or a sign-in page: all LinkedIn work stops for 24 h', {session: first[0].id, reason: first[1].state.reason, until: new Date(until).toISOString(), off});
    }
    const notOpened = mine.filter(([, each]) => NOT_OPENED.has(each.state.state));
    // Why (14 Nov 2026, plan 4b-1; spec "waits in the queue as queued"): at the day's 15 sends, a Full automation job that would send on LinkedIn stays queued, not opened (its entry
    // skipped this poll), until the next local date; a job that only fills still opens. A switch that is off or a pause is turn()'s, below.
    const capped = notOpened.length > 0 && limitsTurn(storage, new Date(now())).wait === 'cap';
    for (const entry of notOpened) if (capped && entry[1].state.mode === 'auto' && entry[1].state.linkedinConfirmedAt) entry[1] = null;
    const waiting = notOpened.filter(entry => entry[1]);
    const {reason, session} = waiting.length ? turn() : {};
    // A hand-over write that throws or is refused skips only that job this poll (never opened: the next poll tries again), like the controller's other per-job reads.
    if (reason) for (const entry of waiting) entry[1] = await Promise.resolve().then(() => handOver(entry[0], reason)).then(state => {
      if (!state || state.ok === false) throw new Error('the store refused the hand-over');   // a refusal is no hand-over: skipped and tried again, like a throw (Gitar on #4096)
      return {...entry[1], state};
    }).then(entry1 => entry1, error => { log('easy-apply', 'a LinkedIn job could not be handed to the person: tried again next poll', {session: entry[0].id, error: String(error?.message || error)}); return null; });
    // Open = a LinkedIn page in the hidden browser: filling, ready, waiting, or handed to the person on its own page; a job this file handed over never opened one.
    const open = mine.some(([, each]) => each && !NOT_OPENED.has(each.state.state) && !LINKEDIN_NOTICES[each.state.reason]);   // a skipped job (null) opened nothing
    // Why (13 Nov 2026, plan 4a-2b): set again on every poll a LinkedIn job waits, never only once: a hidden browser restarted mid-batch has lost it, and a job opened signed out
    // would meet LinkedIn's sign-in page, a D3 stop of 24 h that the person never caused.
    // A browser call that fails is logged and never fails the poll (other sites' jobs still open): the LinkedIn jobs wait for the next poll, never open signed out.
    if (session) await put(session).catch(error => { log('easy-apply', 'LinkedIn sign-in could not be put in: its jobs wait', {error: String(error?.message || error)}); for (const entry of waiting) entry[1] = null; });
    else if (!open && inside) await out().catch(error => log('easy-apply', 'LinkedIn sign-in could not be taken out yet: tried again next poll', {error: String(error?.message || error)}));
  }
  return {settle};
}
