// The person's switch for each e-mail the app and its runs send (Settings → Notifications and Settings → Automation/Apply; spec jobadabra-web docs/superpowers/specs/2026-11-05-service-mail-rules-design.md §2, §4).
// One stored value per person and row, kept by the website (GET/POST /api/mail/choices); this file reads and writes it, never keeps a second copy except a mirror the engine's env needs synchronously.
// Owner, 5-6 Nov 2026: "each users sets his own emails" and "Only the person": the choice is final, and no Admin stop overrides it. The Mac never sends mail itself: it posts to our API (notify-channel.js).
// Invariants: a row the person never chose shows (and acts) as the suggested default of their mode; a row they chose is never reset by a mode change; a failed save leaves the switch where it was and says so.
// Guard: test/unit/main/mail-choices.test.js.
import {call, channelsOf, installKey, wantsNews} from './notify-channel.js';
import {rowLine} from '../renderer/email-consent-words.js';
import * as hosted from './hosted-search.js';

/** Why (6 Nov 2026, coordinator, spec §Order): a mail held on our server for the digest carries no row, so a switch shown before "app mail is not stored" (spec PR 5) would be a promise the digest breaks.
 *  The switches stay dark for people until PR 5 has shipped; its follow-up flips this one line. Demo mode and tests always show them. */
export const MAIL_SWITCHES_SHOWN = false;

export const ROWS = ['app-matches', 'app-needs-you', 'app-applied', 'app-weekly', 'app-stopped', 'app-nothing'];
const WHERE = {
  mac: 'From your Mac: only while your Mac is awake and the app is open. If it isn\'t, no e-mail is sent.',
  always: 'From Always on: on schedule, even with your Mac off.',
};
const WORDS = {not_saved: 'Could not save it just now. The switch is back where it was; try again in a minute.', app_only: 'Only this app can change it.', no_address: 'Add your e-mail address first.', need_address: 'Add your e-mail address in Settings → Notifications first, then turn it on.', unauthorized: 'This install could not be recognised by the website. Try again in a minute.'};

/** 'always' when Always on runs (our servers or the person's own GitHub), else 'mac'. The mode only picks which defaults show; it never changes a choice. */
export function modeOf(storage) {
  return storage.settings().cloud?.repo || hosted.state(storage).on ? 'always' : 'mac';
}

/** True when e-mail is on for this person (an address and their yes): only then does a row's mail go anywhere. */
export const emailing = storage => channelsOf(storage).includes('email');

/** The switch's state for a mode: shown (not 'hidden' there), on (the choice, else the suggested default: anything but 'no'), and the line saying where it comes from.
 *  Before e-mail is on (`emailing` false) every row shows off: the suggestion is a tag the person acts on ("Suggested"), never mail that starts by itself (owner, 6 Nov 2026). */
export function viewOf(row, mode, emailingNow = true) {
  const suggested = row.suggested?.[mode] || 'no';
  const likely = suggested !== 'no' && suggested !== 'hidden';
  return {id: row.id, name: row.name, when: row.when, choice: row.choice || '', shown: suggested !== 'hidden', on: emailingNow && (row.choice ? row.choice === 'on' : suggested !== 'no'), suggested: !emailingNow && likely, where: WHERE[mode]};
}

const mirror = (storage, rows) => storage.saveSettings({mailRows: rows.map(({id, choice, suggested}) => ({id, choice: choice || '', suggested}))});

/** Reads the rows from the website: -> {ok, mode, where, rows: [view]} or {ok: false, error}. Keeps the mirror the engine's env reads. Never throws.
 *  Until the website answers the rows for a person with no address (6 Nov 2026, coordinator: its next site PR), that person gets no rows. */
export async function read(storage, fetcher = globalThis.fetch) {
  const answer = await call(storage, 'GET', '/api/mail/choices', null, fetcher);
  const none = !answer.ok && answer.reason === 'no_address';
  if (!answer.ok && !none) return {ok: false, error: WORDS[answer.reason] || answer.error || 'The website could not be reached.', reason: answer.reason || ''};
  const rows = none || !Array.isArray(answer.rows) ? [] : answer.rows, mode = modeOf(storage), going = emailing(storage);
  mirror(storage, rows);   // no address = no rows: the engine's off-list must not keep honouring an earlier address's choices
  return {ok: true, mode, where: WHERE[mode], macWhere: WHERE.mac, emailing: going, rows: rows.map(row => viewOf(row, mode, going)).filter(row => row.shown)};
}

/** One press: stores the person's choice for a row, with the app's own key (the website refuses a repo's key). -> {ok} or {ok: false, error: words}. The mirror follows only a saved choice. */
export async function set(storage, row, on, fetcher = globalThis.fetch) {
  if (!ROWS.includes(row) || typeof on !== 'boolean') return {ok: false, error: 'That e-mail is not one of the switches.'};
  if (!/^JPF1\./.test(installKey(storage))) return {ok: false, error: 'No install key yet: open the app online once, then try again.'};
  const answer = await call(storage, 'POST', '/api/mail/choices', {mail: row, on}, fetcher);
  if (!answer.ok) return {ok: false, error: WORDS[answer.reason] || answer.error};
  mirror(storage, (storage.settings().mailRows || []).map(entry => (entry.id === row ? {...entry, choice: on ? 'on' : 'off'} : entry)));
  return {ok: true};
}

/** The rows that are off for the person now (their choice, else the suggested default of the current mode): what the engine's env and the app's own senders honour. Empty while the switches are dark
 *  or the rows were never read (then today's behaviour holds, and the website still holds a row the person turned off). */
export function mailOff(storage, shown = MAIL_SWITCHES_SHOWN) {
  if (!shown) return [];
  const mode = modeOf(storage);
  return (storage.settings().mailRows || []).filter(row => ROWS.includes(row.id) && !viewOf(row, mode, true).on).map(row => row.id);
}

/** The engine's env for the rows that are off: {JOBADABRA_MAIL_OFF: 'a,b'}, or {} when none (always {} while the switches are dark). */
export const mailOffEnv = (storage, shown = MAIL_SWITCHES_SHOWN) => { const off = mailOff(storage, shown); return off.length ? {JOBADABRA_MAIL_OFF: off.join(',')} : {}; };

/** True when the app may send this row's mail: the person has it on (or never chose and the default is on). */
export const allowed = (storage, row, shown = MAIL_SWITCHES_SHOWN) => !mailOff(storage, shown).includes(row);

const likelyOn = (row, mode) => ['digest', 'mail'].includes(row.suggested?.[mode]);

/**
 * Writes, once, every row this mode shows that the person never chose: `wantOn(row, mode)` says on, the rest are stored OFF. Why (6 Nov 2026, coordinator): the website holds only an explicit "off", so a row nobody
 * wrote would still be sent once the engine names it, whatever the screen showed. Rows the person chose are left alone, and rows hidden in this mode are not written (an Always-on-only row must still follow
 * its default when Always on is turned on later). `except`: a row the caller stores itself. -> {ok, written: [ids]} or {ok: false, error, written}.
 */
async function writeUnchosen(storage, wantOn, fetcher, except = '') {
  const answer = await call(storage, 'GET', '/api/mail/choices', null, fetcher);
  if (!answer.ok) return {ok: false, error: answer.error || WORDS[answer.reason] || 'The website could not be reached.', written: []};
  const mode = modeOf(storage), rows = Array.isArray(answer.rows) ? answer.rows : [];
  mirror(storage, rows);
  const todo = rows.filter(row => !row.choice && row.id !== except && ROWS.includes(row.id) && row.suggested?.[mode] !== 'hidden');
  // Why (6 Nov 2026, review): one POST per row in turn could hold a press for ~50 s on a slow site (8 s cap each); the writes are independent, so they go together.
  const results = await Promise.all(todo.map(async row => ({id: row.id, done: await set(storage, row.id, wantOn(row, mode), fetcher)})));
  const written = results.filter(result => result.done.ok).map(result => result.id), failed = results.find(result => !result.done.ok);
  if (failed) return {...failed.done, written};
  storage.saveSettings({mailRowsSettled: new Date().toISOString()});
  return {ok: true, written};
}

/**
 * A row turned ON. When e-mail is not on yet this press is the act: the address (the typed one, else the one kept for e-mail, else the CV's: `address`) goes to our site, the Email channel turns on
 * (`save` = the handler's saver, which also moves Always on) and the consent stores this row's own line; every other row the person never chose is stored off, then this row on. -> {ok, addressSaved?} or
 * {ok: false, error: words}: a refusal anywhere puts the switch back. Owner, 6 Nov 2026: "When they turn a mail on" is when the address reaches our server.
 */
export function turnOn(storage, row, options = {}) {
  // Why (6 Nov 2026, Gitar on #3335): two first presses on different rows both saw "e-mail not on", both wrote the unchosen rows, and each stored the other's row off after it had been turned on. One press at a time: the second sees e-mail on and writes only its own row.
  const run = turning.then(() => turnOnNow(storage, row, options));
  turning = run.catch(() => {});
  return run;
}
let turning = Promise.resolve();

async function turnOnNow(storage, row, {address = '', name = '', save, fetcher = globalThis.fetch} = {}) {
  let addressSaved = false;
  if (!emailing(storage)) {
    if (!address) return {ok: false, error: WORDS.need_address};
    const saved = await save({by: [...new Set([...channelsOf(storage), 'email'])], email: address, marketing: wantsNews(storage), consentVia: 'settings', consentGiven: 'switched', consentWording: rowLine(name || row)});
    if (!saved.ok) return {ok: false, error: saved.error || WORDS.not_saved};
    addressSaved = true;
    const others = await writeUnchosen(storage, () => false, fetcher, row);
    if (!others.ok) {   // Why (6 Nov 2026, review): a press that fails must leave nothing half-done: e-mail goes back off (and its consent is withdrawn), so a retry starts the whole block again
      await save({by: channelsOf(storage).filter(name => name !== 'email')}).catch(() => {});
      return {ok: false, error: others.error || WORDS.not_saved};
    }
  }
  const done = await set(storage, row, true, fetcher);
  return done.ok ? {ok: true, addressSaved} : done;
}

/** The CV step's switch left on: the mode's suggested rows turn on and every other row is stored off (writeUnchosen). While the switches are dark nothing is written: the person cannot see the rows, and a row
 *  stored off would stop its mail on the site (settle() writes them when the switches arrive). -> {ok, turned: [ids]} or {ok: false, error}. */
export async function turnOnSuggested(storage, fetcher = globalThis.fetch, shown = MAIL_SWITCHES_SHOWN) {
  if (!shown) return {ok: true, turned: []};
  const done = await writeUnchosen(storage, likelyOn, fetcher);
  if (!done.ok) return {ok: false, error: done.error, turned: []};
  const mode = modeOf(storage), rows = storage.settings().mailRows || [];
  return {ok: true, turned: done.written.filter(id => likelyOn(rows.find(row => row.id === id) || {}, mode))};
}

/** Once, for someone who already has e-mail on when the switches arrive: the same writes as the CV step (suggested on, the rest off), so what they see is what is sent. Needs the switches shown (the gate),
 *  an install key and e-mail on; a failure leaves the flag unset and the next start tries again. -> true when it wrote. Never throws. */
export async function settle(storage, fetcher = globalThis.fetch, shown = MAIL_SWITCHES_SHOWN) {
  try {
    if (!shown || !emailing(storage) || storage.settings().mailRowsSettled || !/^JPF1\./.test(installKey(storage))) return false;
    return (await writeUnchosen(storage, likelyOn, fetcher)).ok;
  } catch { return false; }
}
