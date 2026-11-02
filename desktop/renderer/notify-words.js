// What the window says about "Tell me by" (Settings → Automation → Notifications, the Actions header, Connections): why a switch does nothing (no address, no bot, our sender
// switched off, the person unsubscribed), and whether Telegram is still required. Pure (no DOM), so test/notify-choice.test.js runs it in Node.

const NAMES = {email: 'Email', telegram: 'Telegram'};

// The notes under the Email and Telegram switches and the card's message line. `error` is the last save's refusal: it stays until the next save (it was wiped by the refresh).
export function notes(state, error = '') {
  const email = !state.email ? 'New matches, reminders and answers in your inbox. Add your address below.'
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
  if (!state.email) return {state: 'none', title: 'Get a message when something needs you', detail: 'An application that waits for you, a good match, a reply: by e-mail or Telegram.', resend: false};
  if (state.serviceOff) return {state: 'unsubscribed', title: 'Your e-mails are stopped', detail: `You stopped them with the link in one of our e-mails. Turn them on again with "Email settings" at the bottom of any of them.`, resend: false};
  if (state.unconfirmedStopped) return {state: 'stopped', title: 'Mail stopped: confirm your e-mail', detail: `The address ${state.email} was not confirmed in 14 days. Press the link in the e-mail we send now to start it again.`, resend: true};
  return {state: 'pending', title: 'Check your inbox', detail: `Press the link in our e-mail to ${state.email}. Nothing is sent until you press it.`, resend: true};
}

/** The pop-up for an address that waits for its link: `moment` 'day3' | 'day10' | 'stopped' (lib/notify-moments.js), with the real day count and address. */
export function momentWords({moment, days = 0, email = ''}) {
  if (moment === 'stopped') return {title: 'Mail stopped: confirm your e-mail', body: `${email} was not confirmed in 14 days, so we stopped mailing it. Send the link again to start.`, go: 'Send the link again', later: 'Not now'};
  if (moment === 'day10') return {title: 'Your e-mail is still not confirmed', body: `${email} has waited ${days} days. On day 14 we stop mailing it. Press the link, or send it again.`, go: 'Send the link again', later: 'Not now'};
  return {title: 'Press the link in our e-mail', body: `We sent a link to ${email} ${days} days ago. Nothing is sent to you until you press it.`, go: 'Send the link again', later: 'Not now'};
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
