// A hidden-browser session's status words (sessions list, dock, nav badge, and the card's pill) from its own background state, not from a Chrome tab it never had. Guard: test/unit/renderer/background-status.test.js.

import {MODES} from './apply-settings-model.js';

// Why (5 Nov 2026, owner: "we need to have a distinguish about what session and mode does it have? Are they fully automated? are they manually triggered"; the
// sketch's chips, owner's yes): each session says at a glance where it runs and who presses Submit, in its Settings mode's own icon (MODES). [words, tone]
const MODE_CHIPS = {auto: ['Full automation · sends by itself', 'violet'], fill: ['Background · you submit', 'info'], check: ['In Chrome · you submit', 'neutral']};
// Why (5 Nov 2026, review of [ap] 4/7): a bot check, Stop, a mode change or a quit hands a Full automation job to the person and the store keeps mode 'auto'
// (lib/background-apply-store.js manual()), so its chip said "sends by itself" beside "Needs you".
const HANDED = new Set(['needs_user_handoff', 'manual_submit_required']);

// The mode saved on this session (check, fill, auto), independent of later settings changes. Anything without a hidden-browser record runs in the person's Chrome (check),
// a session from before modes and an assistant-run one too: the person submits it.
const sessionMode = item => item?.background?.mode || (item?.background ? 'fill' : 'check');

/** -> the session's mode chip: {glyph, text, tone, title}; title is the Settings mode's name and what it does (apply-settings-model.js MODES). */
export function sessionModeChip(item) {
  const id = sessionMode(item);
  const mode = MODES.find(entry => entry.id === id) || MODES.find(entry => entry.id === 'fill'), [text, tone] = MODE_CHIPS[mode.id];
  if (mode.id === 'auto' && HANDED.has(item?.background?.state)) return {glyph: mode.icon, text: 'Full automation · you submit now', tone: 'warn', title: 'Full automation handed this one to you: review and submit it yourself.'};
  return {glyph: mode.icon, text, tone, title: `${mode.title}: ${mode.text}`};
}

const WORDS = {
  queued: ['Queued', 'neutral'], preflight: ['Filling', 'info'], filling: ['Filling', 'info'], ready_for_review: ['Ready for review', 'warn'],
  needs_user_handoff: ['Needs you', 'warn'], manual_submit_required: ['Needs you', 'warn'], waiting_to_submit: ['Submitting soon', 'info'], submitting: ['Submitting…', 'info'],
};

/**
 * `ready` / `fields` are the card's page facts (all required fields filled; filled of total): the same table, only more exact. `linkOff`: the app's own connection for the extension is closed (`formsOpen.linkOff`), the reason a queued job waits. -> [label, tone] for a session running in Jobadabra's browser while it is queued, filling, waiting on the person or submitting; null for a Chrome session and for a finished one (the usual words).
 * Why (2026-10-28, owner screenshots: Air France queued behind GLOCK said "Filling" and "Tab not found", GLOCK filling said "Can't reach form"): the Chrome-tab words (tab lost, form closed) were
 * applied to sessions that have no Chrome tab; the one background state owns these words.
 */
export function backgroundStatus(item, {ready = false, fields = null, linkOff = false} = {}) {
  const state = item?.background?.state, words = WORDS[state];
  if (!words) return null;
  if (state === 'queued' && linkOff) return ['Connection off', 'warn'];   // the hidden browser's extension is told to start through the app's own socket: while it is closed the job cannot start, whatever turn it is
  if (state === 'ready_for_review' && ready) return ['Ready to submit', 'good'];   // the card knows the page has no required field left; the list does not read the page
  if (fields?.of && (state === 'filling' || state === 'preflight')) return [`Filling · ${fields.done} of ${fields.of} fields`, 'info'];
  return [...words];
}
