// The notification card in Suggestions (Focus and the Jobs bar): "Get a message when something needs you" while no channel works (owner, 2 Nov 2026, the Always on card's pattern: always
// present, Not now hides it 14 days). Words and states: renderer/notify-words.js offerCard. Spec docs/superpowers/specs/2026-11-02-notify-moments-design.md. Guard: test/notify-suggestion.test.js.
import {offerCard} from './notify-words.js';

export const KEY = 'notify:channel';

/** The card from notifyState's answer (null = not read yet, nothing is drawn). One entry or none; `held` = answered just now, `hidden` = answered within 14 days. */
export function notifyEntries({state, hidden = new Set(), held = new Set()} = {}) {
  const card = offerCard(state);
  if (!card || hidden.has(KEY) || held.has(KEY)) return [];
  const actions = card.state === 'none' ? [{label: 'Send me the link', do: 'add_email'}, {label: 'Use Telegram', do: 'open_notifications'}]
    : card.resend ? [{label: 'Resend', do: 'resend_confirm'}, {label: 'Change address', do: 'open_notifications'}] : [{label: 'Open Notifications', do: 'open_notifications'}];
  return [{kind: 'notify', home: 'focus', topic: 'profile', key: KEY, title: card.title, source: '', detail: card.detail, email: '', state: card.state, evidence: [],
    answers: ['Not now'], alsoJobs: true, actions}];
}

/** What Save sends for an address typed on the card: the channels the person already chose, plus e-mail. */
export function saveChoice(state, email) {
  const kept = state?.chosen || state?.by || ['app'];
  return {by: kept.includes('email') ? [...kept] : [...kept, 'email'], email};
}
