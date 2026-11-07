// What the window says about "Tell me by" (Settings → Notifications, the Actions header, Connections): why a switch does nothing (no address, no bot, our sender
// switched off, the person unsubscribed), and whether Telegram is still required. Pure (no DOM), so test/unit/renderer/notify-choice.test.js runs it in Node.

import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {date} from '../i18n/format.js';
const NAMES = {email: 'Email', telegram: 'Telegram'};

// The notes under the Email and Telegram switches and the card's message line. `error` is the last save's refusal: it stays until the next save (it was wiped by the refresh).
export function notes(state, error = '') {
  const email = !state.email ? t('helperState.notifyAdd')
    : state.sending === false ? t('helperState.notifySendingOff', {email: state.email})
      : state.serviceOff ? t('helperState.notifyUnsubscribed')
        : state.confirmed ? t('helperState.notifyConfirmed', {email: state.email})
          : state.unconfirmedStopped ? t('helperState.notifyStopped', {email: state.email})
            : t('helperState.notifyConfirm', {email: state.email});
  const telegram = state.telegram ? t('helperState.botDigests') : t('helperState.botConnect');
  const lostBot = (state.chosen || []).includes('telegram') && !state.telegram;   // chosen, then the bot was lost: said, never dropped in silence
  const message = error || (lostBot ? t('helperState.botLost') : '')
    || (state.reached ? '' : t('helperState.notifyOffline'));
  return {email, telegram, message};
}

// Telegram is one way to be told; with e-mail chosen it is optional (Connections' alert and dot), unless the person chose it (`chosen`: settings.notifyBy, before unset-up channels are dropped).
export const telegramRequired = (by = [], chosen = null) => (Array.isArray(chosen) && chosen.includes('telegram')) || !by.includes('email');

// The Actions header: Telegram's delivery state when it is the only channel (a refused message is worth saying), else the chosen channels.
export function channelLine({by = [], chosen: picked = null, connected = false, blocked = false}) {
  const chosen = by.filter(name => NAMES[name]);
  if (chosen.includes('telegram') && blocked) return {text: t('helperState.telegramNotDelivering'), dot: 'is-warn'};
  if (Array.isArray(picked) && picked.includes('telegram') && !connected) return {text: t('helperState.telegramNotConnected'), dot: 'is-warn'};
  if (!chosen.length) return {text: connected ? t('helperState.telegramNotChosen') : t('helperState.appOnly'), dot: ''};
  return {text: t('helperState.channelLine', {channels: chosen.map(name => name === 'email' ? t('helpers.email') : NAMES[name]).join(', ')}), dot: 'is-on'};
}

// The Email card in Settings → Overview "Your setup" (owner, 26 Oct 2026: next to AI, Gmail and the extension, with its state). Shown when e-mail is chosen,
// or when nothing else (Telegram) can tell the person anything; Telegram users are not nagged about it.
export function emailCard(state) {
  const by = state.by || [], chosen = state.chosen || [];
  const shown = by.includes('email') || chosen.includes('email') || !by.includes('telegram');
  if (!state.email) return {shown, on: false, text: t('helperState.notSetUp')};
  if (!state.reached) return {shown, on: true, text: t('helperState.savedEmail', {email: state.email})};
  if (state.sending === false) return {shown, on: false, text: t('helperState.senderOff')};
  if (state.serviceOff) return {shown, on: false, text: t('helperState.youUnsubscribed')};
  if (!state.confirmed && state.unconfirmedStopped) return {shown, on: false, text: t('helperState.mailConfirm')};
  return state.confirmed ? {shown, on: true, text: t('helperState.confirmedEmail', {email: state.email})} : {shown, on: false, text: t('helperState.waitingLink')};
}

/**
 * The one answer to "can we reach you?" (spec docs/superpowers/specs/2026-11-02-notify-moments-design.md): 'email' (an address the site confirmed, not unsubscribed, not stopped, our sender on),
 * 'telegram' (a connected bot among the chosen channels) or '' (none). An address typed but never confirmed is not a channel: the site sends it one mail a day, then holds it.
 * `state` is notifyState's answer (lib/notify-channel.js state); null (the site was not asked yet) is '' and draws nothing.
 */
export function workingChannel(state) {
  if (!state) return '';
  const by = state.by || [];
  if (by.includes('email') && state.email && state.confirmed && !state.serviceOff && !state.unconfirmedStopped && state.sending !== false) return 'email';
  return by.includes('telegram') && state.telegram ? 'telegram' : '';
}

/**
 * The Suggestions card's state and words while no channel works, else null. `state`: 'none' (no address), 'pending' (typed, not confirmed: Resend), 'stopped' (the site held the mail after 14
 * days: Resend), 'unsubscribed' (the person's own stop: no Resend, only the link in one of our e-mails). Every line is true today: it promises what "Tell me by" sends, never an interview alert.
 */
export function offerCard(state) {
  if (!state?.reached || workingChannel(state)) return null;   // `reached`: the website answered; offline we know nothing about the confirmation and draw nothing on a guess
  const lost = state.automation ? t('helperState.automationLost') : '';   // 2/2: the card says it too (owner, 2 Nov 2026: stays on and says so)
  if (!state.email) return {state: 'none', title: t('helperState.getMessage'), detail: t('helperState.offerDetails', {lost}), resend: false};
  if (state.serviceOff) return {state: 'unsubscribed', title: t('helperState.emailsStopped'), detail: t('helperState.offerUnsubscribed', {lost}), resend: false};
  if (state.unconfirmedStopped) return {state: 'stopped', title: t('helperState.mailConfirmHyphen'), detail: t('helperState.offerStopped', {email: state.email, lost}), resend: true};
  return {state: 'pending', title: t('helperState.checkInbox'), detail: t('helperState.offerPending', {email: state.email, lost}), resend: true};
}

// Why a person with no working channel can not be reached: the card's state word (the same four as offerCard).
const stateOf = state => (!state.email ? 'none' : state.serviceOff ? 'unsubscribed' : state.unconfirmedStopped ? 'stopped' : 'pending');
const jobLine = ({title = '', company = ''}) => title && company ? t('helperState.jobAt', {title, company}) : title || company;
const clock = iso => date(iso, {hour: 'numeric', minute: '2-digit'});
// What the pop-up's control is, from the card's state: the e-mail field (no address), send the link again (waiting or stopped), or the way to Notifications (the person unsubscribed).
const ASK = {none: 'email', pending: 'resend', stopped: 'resend', unsubscribed: 'notifications'};
const GO = {email: 'helperState.sendLink', resend: 'helperState.sendLinkAgain', notifications: 'helperState.openNotifications'};

/**
 * The pop-ups (lib/notify-moments.js moments, renderer/notify-detect.js claims) as words: {title, body, go, later, ask}. `ask` is the control: 'email' (a field for the address), 'resend' or 'notifications' (from
 * `state` = notifyState's answer). Spec docs/superpowers/specs/2026-11-02-notify-moments-design.md: every line is a delivery fact of today (matches: an e-mail per run or the Telegram digest; interview invites
 * at once, other Gmail results in the daily digest; a recruiter reminder on Telegram at once and by e-mail in the digest) and none says "reply" for Gmail (the check cannot tell). Guard: test/unit/renderer/notify-moment-words.test.js.
 */
export function momentWords(moment, state = null) {
  const ask = ASK[stateOf(state || {})];
  const base = {later: t('helperState.notNow'), ask, go: t(GO[ask])};
  const {moment: name, days = 0, email = ''} = moment;
  if (name === 'stopped') return {...base, title: t('helperState.mailConfirmHyphen'), body: t('helperState.momentStopped', {email})};
  if (name === 'day10') return {...base, title: t('helperState.stillUnconfirmed'), body: t('helperState.momentDay10', {email, days})};
  if (name === 'day3') return {...base, title: t('helperState.pressLink'), body: t('helperState.momentDay3', {email, days})};
  if (name === 'waited') {
    const one = moment.count === 1;
    return {...base, title: one ? t('helperState.waitedOne', {hours: t('helperState.hours', {count: moment.hours})}) : t('helperState.waitedMany', {count: moment.count, hours: t('helperState.hours', {count: moment.hours})}),
      body: t('helperState.waitedBody', {jobs: one ? jobLine(moment) || t('helperState.oneApplication') : t('helperState.andMore', {job: jobLine(moment) || t('helperState.oneOfThem'), count: moment.count - 1})})};
  }
  if (name === 'match') return {...base, title: t('helperState.matchArrived', {fit: moment.fit}), body: t('helperState.matchWhileAway', {time: clock(moment.endedAt), job: jobLine(moment) || t('helperState.oneJob')})};
  if (name === 'reply') return {...base, title: t('helperState.updatesTitle', {count: moment.count}), body: t('helperState.updatesBody', {updates: t('helperState.updates', {count: moment.count})})};
  if (name === 'recruiter') return {...base, title: t('helperState.recruiterWaiting'), body: t('helperState.recruiterBody', {who: moment.company ? t('helperState.companyIs', {company: moment.company}) : t('helperState.someone')})};
  return {...base, title: t('helperState.nothingReach'), body: t('helperState.nothingReachBody')};   // lost
}

/**
 * Whether Full automation's confirmation must also ask where to tell the person (owner, 2 Nov 2026: "the email/telegram notifications should be obligatory"): true when the website's state is known and the
 * person has given NO channel yet (no address, no connected chosen bot). An address typed in that step counts as given at once; it works when its link is pressed (workingChannel), which the card then says.
 * Why (2 Nov 2026): a state the website did not answer (offline, no install key yet) asks nothing; a gate that cannot judge must not lock the person out of the setting they chose.
 */
export const automationNeedsChannel = state => Boolean(state?.reached) && !state.email && !((state.by || []).includes('telegram') && state.telegram);

/**
 * `promise`'s answer, or null when it fails or is not there within `ms`: a read of the website's state that must never hold a dialog (Gitar on #3011: Full automation's confirmation waited on it).
 * `setTimer` is injectable for the test.
 */
export const answeredWithin = (promise, ms, setTimer = setTimeout) => Promise.race([Promise.resolve(promise).catch(() => null), new Promise(resolve => { setTimer(() => resolve(null), ms); })]);
