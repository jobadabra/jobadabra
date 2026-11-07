// How the person wants to be told (Settings → Notifications, "Tell me by"): e-mail, app notifications, Telegram, any mix. Owns the choice (settings.notifyBy),
// the address kept on our site (GET/PUT /api/account/email, site/src/account-email.js), the env the engine reads (JOBADABRA_NOTIFY, src/notify.py), and the one e-mail the app itself sends.
// Guards: test/unit/main/notify-channel.test.js, test/unit/main/telegram-send.test.js.
import {notificationFailure} from '../i18n/notification-notices.js';
import {FREE_BASE, TRIAL_KEY} from './ai-free.js';
import {wordingOf} from '../renderer/email-consent-words.js';
import * as consent from './email-consent.js';
import {notificationLanguage} from './notification-language.js';
import {log as appLog} from './log.js';

const BASE = FREE_BASE.replace(/\/api\/ai$/, '');
export const CHANNELS = ['email', 'app', 'telegram'];

export const telegramReady = storage => !!(storage.secret('TELEGRAM_BOT_TOKEN') && storage.settings().telegramChatId);
export const installKey = storage => storage.secret(TRIAL_KEY) || (/^JPF1\./.test(storage.secret('ANTHROPIC_API_KEY') || '') ? storage.secret('ANTHROPIC_API_KEY') : '');
export const emailOf = storage => String(storage.settings().notifyEmail || '');

// The chosen channels. E-mail needs the person's consent (lib/email-consent.js) as well as an address. Unset = what the person already has: e-mail when an address was given, Telegram when it is connected, and the app always.
// An explicit choice wins, but a channel that is not set up (no address, no bot) is dropped: nothing is promised that cannot be sent.
export function channelsOf(storage) {
  const chosen = storage.settings().notifyBy;
  const wanted = Array.isArray(chosen) ? chosen.filter(name => CHANNELS.includes(name)) : [...(emailOf(storage) ? ['email'] : []), ...(telegramReady(storage) ? ['telegram'] : []), 'app'];
  return wanted.filter(name => (name === 'email' ? !!emailOf(storage) && consent.consented(storage) : name === 'telegram' ? telegramReady(storage) : true));
}

// A run is asked to deliver (--send) when it has somewhere to deliver to besides the app's own window.
export const deliveryReady = storage => channelsOf(storage).some(name => name === 'email' || name === 'telegram');

// What the engine and the Always on repo are told (src/notify.py reads JOBADABRA_NOTIFY; the key identifies the install to the site).
export function notifyEnv(storage) {
  const channels = channelsOf(storage);
  return {JOBADABRA_NOTIFY: channels.join(','), JOBADABRA_NOTIFICATION_LANGUAGE: notificationLanguage(storage), ...(channels.includes('email') && installKey(storage) ? {JOBADABRA_TRIAL_KEY: installKey(storage)} : {})};
}

// Only acknowledged delivery metadata is cached, privately and per storage; this is never another editable preference.
const languageRefreshes = new WeakMap();

/** Refresh derived service language on normal events; serialize changes, reuse acknowledgement, and leave the saved appearance choice unchanged. */
export function refreshLanguage(storage, fetcher = globalThis.fetch) {
  if (!emailOf(storage) || !installKey(storage)) return Promise.resolve({ok: false, skipped: true});
  let state = languageRefreshes.get(storage);
  if (!state) { state = {pending: Promise.resolve(), acknowledged: null}; languageRefreshes.set(storage, state); }
  const next = state.pending.then(async () => {
    const language = notificationLanguage(storage);
    const target = JSON.stringify([emailOf(storage), language]);
    if (state.acknowledged === target) return {ok: true, language};
    const answer = await call(storage, 'PUT', '/api/account/language', {language}, fetcher);
    if (answer.ok && answer.language === language) { state.acknowledged = target; return answer; }
    appLog('notify', 'language refresh not acknowledged', {language});
    return {...answer, ok: false};
  }).catch(() => ({ok: false, error: 'language_not_saved'}));
  state.pending = next;
  return next;
}

const WORDS = {
  taken: 'That address already has a Jobadabra account. Use another address, or sign in with it once Pro is out.',
  pro: 'That account is a Pro account; its address changes through Pro sign-in.',
  unauthorized: 'This install could not be recognised by the website. Try again in a minute.',
};
// Why (#3011, Gitar, 2 Nov 2026): a hanging connection kept this call, and so the Full automation confirmation that waits on the state, open for minutes: no call to the site outlasts SLOW_MS.
export const SLOW_MS = 8000;
export async function call(storage, method, path, body, fetcher) {   // exported for lib/mail-choices.js: one way to the site, one key, one time limit
  const key = installKey(storage);
  if (!key) return notificationFailure({ok: false, error: 'No install key yet: open the app online once, then try again.'}, 'keyMissing');
  const limit = new AbortController(), timer = setTimeout(() => limit.abort(), SLOW_MS);
  try {
    const response = await fetcher(`${BASE}${path}`, {method, signal: limit.signal, headers: {'x-api-key': key, ...(body ? {'content-type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
    const answer = await response.json().catch(() => ({}));
    if (answer.ok) return answer;
    const result = {ok: false, error: WORDS[answer.error] || answer.error || 'The website did not accept it.', ...(answer.reason ? {reason: answer.reason} : {})};
    return Object.hasOwn(WORDS, answer.error) ? notificationFailure(result, answer.error) : answer.error ? result : notificationFailure(result, 'notAccepted');
  } catch { return notificationFailure({ok: false, error: 'The website could not be reached. Try again when you are online.'}, 'unreachable'); } finally { clearTimeout(timer); }
}

// What the window shows: the choice, the address and whether it is confirmed (asked of the site; the cached address when offline).
// unconfirmedStopped: the site stopped mail after 14 days without the confirm link (site api/mail-held.js); the confirm link starts it again.
export async function state(storage, fetcher = globalThis.fetch) {
  const settings = storage.settings(), site = await call(storage, 'GET', '/api/account/email', null, fetcher);
  if (site.ok && site.email && site.email !== settings.notifyEmail) storage.saveSettings({notifyEmail: site.email});
  return {by: channelsOf(storage), chosen: Array.isArray(settings.notifyBy) ? settings.notifyBy : null, telegram: telegramReady(storage), email: site.ok ? site.email || '' : emailOf(storage),
    confirmed: !!site.confirmed, sending: site.ok && typeof site.sending === 'boolean' ? site.sending : null, serviceOff: !!site.serviceOff, unconfirmedStopped: !!site.unconfirmedStopped, emailAt: String(settings.notifyEmailAt || ''), cadence: site.ok ? site.cadence || 'daily' : settings.notifyCadence || 'daily', reached: !!site.ok,
    automation: settings.apply?.mode === 'auto' && !!settings.apply?.autoConfirmedAt};   // Full automation on and confirmed (the pop-up "nothing can reach you", notify-moments)
}

// Saves the choice. A changed address or cadence goes to the site first; the choice is kept only if it was accepted. Choosing e-mail with an address is the consent (stored with the date and
// the sentence shown: `consentVia` = where it was given, 'settings' when omitted; `consentGiven` = 'default' when a switch that started on was left on); turning e-mail off withdraws it.
export async function save(storage, {by, email, cadence, consentVia, consentGiven, consentWording}, fetcher = globalThis.fetch, now = new Date()) {
  const clean = String(email || '').trim().toLowerCase();
  const wasOn = channelsOf(storage).includes('email');   // before keepAddress: an address typed in this save is not e-mail having been on
  if (Array.isArray(by) && by.includes('email') && !clean && !emailOf(storage)) return notificationFailure({ok: false, error: 'Enter your email address to be told by email.'}, 'needEmail');
  const digest = ['daily', 'weekly'].includes(cadence) ? cadence : null;   // how often the digest of everything but new matches comes
  if (clean && (clean !== emailOf(storage) || digest)) {
    const site = await call(storage, 'PUT', '/api/account/email', {email: clean, language: notificationLanguage(storage), ...(digest ? {cadence: digest} : {})}, fetcher);
    if (!site.ok) return site;
    keepAddress(storage, {clean, digest, consentVia, consentGiven, consentWording}, now);
  }
  if (Array.isArray(by)) {
    storage.saveSettings({notifyBy: by.filter(name => CHANNELS.includes(name))});
    followConsent(storage, by, wasOn, {consentVia, consentGiven, consentWording}, now);
  }
  return {ok: true};
}

// The site took the address: kept here. A new address with no consent stored records one (typing it and saving is the act; the CV step passes how it was given).
function keepAddress(storage, {clean, digest, consentVia, consentGiven, consentWording}, now) {
  const changed = clean !== emailOf(storage);   // the day count of the unconfirmed reminders (lib/notify-moments.js) starts with a new address, not with a new news choice
  if (changed && !storage.settings().emailConsent?.at) consent.record(storage, consentVia || 'settings', consentWording || wordingOf(consentVia || 'settings'), now, consentGiven || 'switched');
  storage.saveSettings({notifyEmail: clean, ...(changed ? {notifyEmailAt: now.toISOString()} : {}), ...(digest ? {notifyCadence: digest} : {})});
}

// A saved choice moves the consent (lib/email-consent.js): e-mail chosen with an address and none stored yet records it; e-mail left out withdraws it.
// Why (5 Nov 2026, #3282): Settings saves on every switch, so only e-mail going from on to off is a withdrawal; a save by someone never asked still leaves them askable (the rule is unchanged in hr 4/8, 6 Nov 2026; a caller may now name the sentence its own switch showed, `consentWording`).
function followConsent(storage, by, wasOn, {consentVia, consentGiven, consentWording}, now) {
  if (!by.includes('email')) { if (wasOn) consent.clear(storage); }
  else if (emailOf(storage) && !storage.settings().emailConsent?.at) consent.record(storage, consentVia || 'settings', consentWording || wordingOf(consentVia || 'settings'), now, consentGiven || 'switched');
}

// One message the app itself sends (not an engine run): by the chosen channels' e-mail form. Plain text in, never throws. It joins the digest (kind 'activity'), never a mail of its own,
// unless `urgent` (an application waits for the person: lib/waiting-message.js): then it goes at once. `mail` names its row (lib/mail-choices.js ROWS). -> true when the site took it.
export async function sendEmail(storage, {subject, text, urgent = false, buttons, mail = ''}, fetcher = globalThis.fetch) {
  if (!channelsOf(storage).includes('email')) return false;
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const answer = await call(storage, 'POST', '/api/notify/email', {subject, language: notificationLanguage(storage), html: buttons?.length ? escape(text) : `<b>${escape(subject)}</b>\n${escape(text)}`, ...(buttons ? {buttons} : {}), kind: urgent ? 'urgent' : 'activity', ...(mail ? {mail} : {})}, fetcher);   // `mail`: the row the person's switch holds it by (lib/mail-choices.js; the site refuses a row they turned off)
  void refreshLanguage(storage, fetcher);
  return answer.ok === true;
}

const TEST_WHY = {no_address: 'No address is saved yet.', off: 'E-mail is switched off on our side for now.', rate: 'Too many e-mails today. Try again tomorrow.', suppressed: 'Your address bounced or marked us as spam. Check it in Settings → Notifications.', unsubscribed: 'You stopped our e-mails. Turn them back on in Settings → Notifications.', empty: 'Nothing to send.', unconfirmed_stopped: 'Confirm your address first: press "Send the confirm link again" in Settings → Notifications.'};

/** One test e-mail, at once (not held for the digest): Always on's Test on your own GitHub. The site limits it to once a day per address and answers `earlier: true` when today's went already.
 *  -> {ok, earlier} or {ok: false, error: words}. */
export async function sendTest(storage, {subject, text}, fetcher = globalThis.fetch) {
  const done = await call(storage, 'POST', '/api/notify/email', {subject, language: notificationLanguage(storage), html: `<b>${subject}</b>\n${text}`, kind: 'test'}, fetcher);
  return done.ok ? {ok: true, earlier: done.earlier === true} : {ok: false, error: TEST_WHY[done.reason] || done.error || 'The e-mail could not be sent just now. Try again in a minute.'};
}

// What the site says when it will not send the confirm mail again (jobadabra-web POST /api/account/email/resend, #333), in the person's words.
const RESEND_WORDS = {
  wait: 'We just sent it. Check your inbox and your spam folder; you can ask again in an hour.',
  confirmed: 'Your address is already confirmed.',
  stopped: 'You stopped these emails with the link in one of them. Turn them on again with "Email settings" at the bottom of any of our emails.',
  no_address: 'Add your e-mail address first.',
  off: 'E-mail is switched off on our side for now.',
  not_sent: 'The e-mail could not be sent just now. Try again in a minute.',
};

/** Sends the confirm mail again to the saved address (at most 1 an hour and 3 a day, the site decides). -> {ok} or {ok: false, error: words, code?: the site's reason} */
export async function resend(storage, fetcher = globalThis.fetch) {
  if (!emailOf(storage)) return notificationFailure({ok: false, error: RESEND_WORDS.no_address, code: 'no_address'}, 'noAddress');
  const done = await call(storage, 'POST', '/api/account/email/resend', null, fetcher);
  if (done.ok) return {ok: true};
  const keys = {wait: 'resendWait', confirmed: 'resendConfirmed', stopped: 'resendStopped', no_address: 'noAddress', off: 'serviceOff', not_sent: 'notSent'};
  if (!RESEND_WORDS[done.error]) return done;
  const result = {ok: false, error: RESEND_WORDS[done.error], code: done.error};
  return Object.hasOwn(keys, done.error) ? notificationFailure(result, keys[done.error]) : result;
}
