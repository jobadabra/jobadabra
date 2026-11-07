// The live card's pure parts (renderer/pages/session-live.js draws them): what a hidden-browser session's Applying card says in each of its four
// states, and how a press or a key on the page's picture becomes the page's own. No DOM here. Guard: test/unit/renderer/session-live.test.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {date} from '../i18n/format.js';
import {backgroundStatus} from './background-status.js';
import {linkOffLine} from './session-state.js';
const FILLING = new Set(['preflight', 'filling']);
const HANDOFF = new Set(['needs_user_handoff', 'manual_submit_required']);
const clock = ms => (ms ? date(ms, {hour: '2-digit', minute: '2-digit'}) : '');

/** "9:41" for the time left until `dueAt` (a started second counts); '' when there is no due time or it has passed. */
export function countdownLabel(dueAt, now) {
  const left = Math.ceil((dueAt - now) / 1000);
  if (!dueAt || left <= 0) return '';
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

/** The card of a job that has not started: waiting for its turn, or (connection closed) waiting on the connection. Pure. */
function waitingCard(background, linkOff) {
  const base = {kind: 'waiting', live: false, meta: t('helperFlow.liveBrowserHidden'), frame: '', input: false, filling: '', submit: null, marks: false};
  if (linkOff) return {...base, title: t('helperFlow.liveBrowserUnheard'), pill: backgroundStatus({background}, {linkOff}), tone: 'warn', note: linkOffLine(linkOff, t('helperFlow.liveHiddenBrowser'))};
  return {...base, title: t('helperFlow.waitingTurn'), pill: backgroundStatus({background}), tone: 'neutral', note: t('helperFlow.waitingTen')};
}

/**
 * Pure: what the card says for a session's background state and the page's latest facts (null until read).
 * `linkOff`: `formsOpen.linkOff` ({port, code}) when the app's own connection for the extension is closed. -> {kind: waiting|filling|countdown|check|review|ready, live (the page exists: draw its picture), title, meta, pill: [text, tone], tone, frame: ''|'warn'|'good', note, input, filling, submit: {on, hint}|null, marks}
 * Invariant: Submit is on only in Ready to submit: the form judge's ready stands AND the page has no required field empty (main checks both again at the press).
 */
export function liveCard(background = {}, facts = null, {note = '', at = clock, now = Date.now, linkOff = null} = {}) {
  const left = facts ? facts.left.length : null, filled = at(background.readyAt);
  // Why (2026-10-28, owner screenshot: Air France, queued behind GLOCK, drew "Filling" and a broken picture): a queued job has no page yet, so no picture is asked for (waitingCard: live false).
  // Why (30 Oct 2026, owner's demo: cards stuck with no reason): with the app's connection closed (`formsOpen.linkOff`) the hidden browser's extension is never told to start, so a queued job waits on the connection, not on the job before it.
  if (background.state === 'queued') return waitingCard(background, linkOff);
  // Why (2026-10-28, owner: "Finish the 'Full automation' flow"; project safety rule): Full automation waits before it presses Submit; the person sees the clock and can Stop. Stop keeps the filled form for them (a hand-off), it never discards it.
  if (background.state === 'waiting_to_submit') {
    const left = countdownLabel(background.dueAt, now() + (background.waitClockOffset || 0));
    return {kind: 'countdown', live: true, title: left ? t('helperFlow.submittingIn', {left}) : t('helperFlow.submittingNow'), meta: t('helperFlow.everyCheckPassed'), pill: backgroundStatus({background}), tone: 'info', frame: '', stop: true,
      note: t('helperFlow.submitTimerNote'), input: false, filling: '', submit: null, marks: false};
  }
  if (FILLING.has(background.state)) {
    return {kind: 'filling', live: true, title: t('helperFlow.fillingApplication'), meta: t('helperFlow.liveBrowserHidden'), pill: backgroundStatus({background}, {fields: facts?.fields ? {done: facts.filled, of: facts.fields} : null}),
      tone: 'info', frame: '', note: t('helperFlow.watchWhileFilling'), input: false, filling: facts?.active || '', submit: null, marks: false};
  }
  if (HANDOFF.has(background.state) && /^captcha_/.test(background.reason || '')) {   // words-ok: our own hand-off reason id, not page knowledge
    return {kind: 'check', live: true, title: t('helperFlow.botNeedsYou'), meta: filled ? t('helperFlow.filledThenAsked', {time: filled}) : t('helperFlow.pageAsked'), pill: backgroundStatus({background}), tone: 'warn', frame: 'warn',
      note: t('helperFlow.solveBotYourself'), input: true, filling: '', submit: {on: false, hint: t('helperFlow.afterBotSubmit')}, marks: true};
  }
  if (background.state === 'ready_for_review' && left === 0) {
    return {kind: 'ready', live: true, title: t('helperState.readySubmit'), meta: t('helperFlow.requiredFilled'), pill: backgroundStatus({background}, {ready: true}), tone: 'good', frame: 'good',
      note: t('helperFlow.submitIsYou'), input: true, filling: '', submit: {on: true, hint: ''}, marks: false};
  }
  const judged = background.state === 'ready_for_review';
  return {kind: 'review', live: true, title: t('helperFlow.reviewFilled'), meta: filled ? t('helperFlow.filledBrowser', {time: filled}) : t('helperFlow.inBrowser'), pill: backgroundStatus({background}) || [t('helperState.needsYou'), 'warn'],
    tone: 'warn', frame: '', note: judged ? t('helperFlow.livePageEdit') : note || t('helperFlow.applicationNeedsYou'),
    input: true, filling: '', marks: true, submit: {on: false, hint: !judged ? t('helperFlow.usePageSubmit') : left === null ? t('helperFlow.readingPage') : t('helperFlow.requiredLeft', {count: left})}};
}

/** Pure: a press at (x, y) on a picture drawn at `box` ({left, top, width, height}) -> the page's own CSS pixels, for a viewport of w × h. */
export const toPage = (x, y, box, w, h) => ({x: Math.round(((x - box.left) / box.width) * w), y: Math.round(((y - box.top) / box.height) * h)});
/** Pure: a key event -> the live view's key message ({t: 'key', key, text, code, up}); text only for what types a character. */
export const keyMessage = (event, up = false) => ({t: 'key', key: event.key, code: event.keyCode || undefined, up,
  text: up ? undefined : event.key === 'Enter' ? '\r' : event.key.length === 1 ? event.key : undefined});
