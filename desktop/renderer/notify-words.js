// What the window says about "Tell me by" (Settings → Notifications, the Actions header, Connections): why a switch does nothing (no address, no bot, our sender
// switched off, the person unsubscribed), and whether Telegram is still required. Pure (no DOM), so test/unit/renderer/notify-choice.test.js runs it in Node.

import {SETTINGS_LINE} from './email-consent-words.js';
const NAMES = {email: 'Email', telegram: 'Telegram'};

// The notes under the Email and Telegram switches and the card's message line. `error` is the last save's refusal: it stays until the next save (it was wiped by the refresh).
export function notes(state, error = '') {
  const email = !state.email ? `${SETTINGS_LINE} Add your address below, then switch it on.`
    : state.sending === false ? `To ${state.email}. Email is not switched on on our side yet: your choice is kept and mail starts when it is.`
      : state.serviceOff ? `You stopped these emails with the link in one of them. Turn them on again with "Email settings" at the bottom of any of our emails.`
        : state.confirmed ? `To ${state.email} (confirmed).`
          : state.unconfirmedStopped ? `To ${state.email}. Mail stopped: the address was not confirmed in 14 days. Press the confirm link in your first email to start it again.`
            : `To ${state.email}. Confirm it with the link in your first email.`;
  const telegram = state.telegram ? 'Your own bot: digests and reminders, with buttons.' : 'Your own bot. Connect it first:';
  const lostBot = (state.chosen || []).includes('telegram') && !state.telegram;   // chosen, then the bot was lost: said, never dropped in silence
  const message = error || (lostBot ? 'Telegram is chosen but not connected, so nothing goes there. Connect it, or turn it off.' : '')
    || (state.reached ? '' : 'Offline: your address is saved when the website is reachable.');
  return {email, telegram, message};
}

// Telegram is one way to be told; with e-mail chosen it is optional (Connections' alert and dot), unless the person chose it (`chosen`: settings.notifyBy, before unset-up channels are dropped).
export const telegramRequired = (by = [], chosen = null) => (Array.isArray(chosen) && chosen.includes('telegram')) || !by.includes('email');

// The Actions header: Telegram's delivery state when it is the only channel (a refused message is worth saying), else the chosen channels.
export function channelLine({by = [], chosen: picked = null, connected = false, blocked = false}) {
  const chosen = by.filter(name => NAMES[name]);
  if (chosen.includes('telegram') && blocked) return {text: 'Telegram not delivering', dot: 'is-warn'};
  if (Array.isArray(picked) && picked.includes('telegram') && !connected) return {text: 'Telegram not connected', dot: 'is-warn'};
  if (!chosen.length) return {text: connected ? 'Telegram connected, not chosen' : 'Tell me by: app notifications only', dot: ''};
  return {text: `Tell me by: ${chosen.map(name => NAMES[name]).join(', ')}`, dot: 'is-on'};
}

// The Email card in Settings → Overview "Your setup" (owner, 26 Oct 2026: next to AI, Gmail and the extension, with its state). Shown when e-mail is chosen,
// or when nothing else (Telegram) can tell the person anything; Telegram users are not nagged about it.
export function emailCard(state) {
  const by = state.by || [], chosen = state.chosen || [];
  const shown = by.includes('email') || chosen.includes('email') || !by.includes('telegram');
  if (!state.email) return {shown, on: false, text: 'Not set up'};
  if (!state.reached) return {shown, on: true, text: `Saved · ${state.email}`};
  if (state.sending === false) return {shown, on: false, text: 'Sending is off on our side'};
  if (state.serviceOff) return {shown, on: false, text: 'You unsubscribed'};
  if (!state.confirmed && state.unconfirmedStopped) return {shown, on: false, text: 'Mail stopped: confirm your email'};
  return state.confirmed ? {shown, on: true, text: `Confirmed · ${state.email}`} : {shown, on: false, text: 'Waiting for the confirm link'};
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
  const lost = state.automation ? ' Full automation keeps running, but nothing can tell you when an application needs you.' : '';   // 2/2: the card says it too (owner, 2 Nov 2026: stays on and says so)
  if (!state.email) return {state: 'none', title: 'Get a message when something needs you', detail: `An application that waits for you, a good match, a reply: by e-mail or Telegram.${lost}`, resend: false};
  if (state.serviceOff) return {state: 'unsubscribed', title: 'Your e-mails are stopped', detail: `You stopped them with the link in one of our e-mails. Turn them on again with "Email settings" at the bottom of any of them.${lost}`, resend: false};
  if (state.unconfirmedStopped) return {state: 'stopped', title: 'Mail stopped: confirm your e-mail', detail: `The address ${state.email} was not confirmed in 14 days. Press the link in the e-mail we send now to start it again.${lost}`, resend: true};
  return {state: 'pending', title: 'Check your inbox', detail: `Press the link in our e-mail to ${state.email}. Nothing is sent until you press it.${lost}`, resend: true};
}

// Why a person with no working channel can not be reached: the card's state word (the same four as offerCard).
const stateOf = state => (!state.email ? 'none' : state.serviceOff ? 'unsubscribed' : state.unconfirmedStopped ? 'stopped' : 'pending');
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const jobLine = ({title = '', company = ''}) => [title, company].filter(Boolean).join(' at ');
const clock = iso => new Date(iso).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
// What the pop-up's control is, from the card's state: the e-mail field (no address), send the link again (waiting or stopped), or the way to Notifications (the person unsubscribed).
const ASK = {none: 'email', pending: 'resend', stopped: 'resend', unsubscribed: 'notifications'};
const GO = {email: 'Send me the link', resend: 'Send the link again', notifications: 'Open Notifications'};
const WAYS = 'by e-mail or Telegram';

/**
 * The pop-ups (lib/notify-moments.js moments, renderer/notify-detect.js claims) as words: {title, body, go, later, ask}. `ask` is the control: 'email' (a field for the address), 'resend' or 'notifications' (from
 * `state` = notifyState's answer). Spec docs/superpowers/specs/2026-11-02-notify-moments-design.md: every line is a delivery fact of today (matches: an e-mail per run or the Telegram digest; interview invites
 * at once, other Gmail results in the daily digest; a recruiter reminder on Telegram at once and by e-mail in the digest) and none says "reply" for Gmail (the check cannot tell). Guard: test/unit/renderer/notify-moment-words.test.js.
 */
export function momentWords(moment, state = null) {
  const ask = ASK[stateOf(state || {})];
  const base = {later: 'Not now', ask, go: GO[ask]};
  const {moment: name, days = 0, email = ''} = moment;
  if (name === 'stopped') return {...base, title: 'Mail stopped: confirm your e-mail', body: `${email} was not confirmed in 14 days, so we stopped mailing it. Send the link again to start.`};
  if (name === 'day10') return {...base, title: 'Your e-mail is still not confirmed', body: `${email} has waited ${days} days. On day 14 we stop mailing it. Press the link, or send it again.`};
  if (name === 'day3') return {...base, title: 'Press the link in our e-mail', body: `We sent a link to ${email} ${days} days ago. Nothing is sent to you until you press it.`};
  if (name === 'waited') {
    const one = moment.count === 1;
    return {...base, title: one ? `An application waited ${plural(moment.hours, 'hour')} for you` : `${plural(moment.count, 'application')} waited up to ${plural(moment.hours, 'hour')} for you`,
      body: `${one ? jobLine(moment) || 'An application' : `${jobLine(moment) || 'One of them'} and ${moment.count - 1} more`} needed you while nobody could tell you. Get a message ${WAYS} the next time.`};
  }
  if (name === 'match') return {...base, title: `A ${moment.fit}% match arrived`, body: `Your check at ${clock(moment.endedAt)} found ${jobLine(moment) || 'a job'} while you were away. Get the matches of each check ${WAYS}.`};
  if (name === 'reply') return {...base, title: `Gmail found ${plural(moment.count, 'application update')}`, body: `Your Gmail check found ${plural(moment.count, 'update')} while you were away. An interview invite reaches you at once by message; other updates come in your daily digest.`};
  if (name === 'recruiter') return {...base, title: 'A recruiter is waiting for your answer', body: `${moment.company ? `${moment.company} is` : 'Someone is'} waiting. Get a reminder by message: on Telegram at once, by e-mail in your digest.`};
  return {...base, title: 'Nothing can reach you now', body: 'Full automation is on and keeps running. But when an application needs you, we have no way to tell you. Add an e-mail address or connect Telegram.'};   // lost
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
