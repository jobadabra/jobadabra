// The words and states of Always on "on our servers" (owner, 17 Oct 2026: one name everywhere; ON by default for a trial install until it presses Skip). Pure: renderer/pages/hosted.js draws it.
// States: on with an e-mail, on without one (asks for it first), off (Skip or turned off), paused (14 days idle, budget, limit), trial over. Guard: test/unit/renderer/hosted-words.test.js.
import '../i18n/screens-helpers.js';
import {t, getLocale} from '../i18n/index.js';
import {date} from '../i18n/format.js';
import {promise} from './pro-promise.js';
export const NAME = t('helperMore.hostedName');
export const SUBTITLE = t('helperMore.hostedSubtitle');
export const STORED = t('helperMore.hostedStored');
export const HELPER = t('helperMore.hostedHelper');

const two = n => String(n).padStart(2, '0');
// "today ~7:00" / "tomorrow ~7:00" / "Mon ~7:00" in the person's own time.
export function when(iso, now = new Date()) {
  const at = new Date(iso);
  if (!(at.getTime() > 0)) return '';
  const day = d => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);
  const gap = day(at) - day(now), clock = `${at.getHours()}:${two(at.getMinutes())}`;
  return `${gap <= 0 ? t('helperMore.hostedToday') : gap === 1 ? t('helperMore.hostedTomorrow') : date(at, {weekday: 'short'})} ~${clock}`;
}

// "today at 9:14" / "26 Oct at 10:02": when the profile was last copied to our servers, or deleted from them.
export function stamp(iso, now = new Date()) {
  const at = new Date(iso);
  if (!(at.getTime() > 0)) return '';
  const same = at.toDateString() === now.toDateString(), clock = `${at.getHours()}:${two(at.getMinutes())}`;
  return t('helperMore.hostedStamp', {day: same ? t('helperMore.hostedToday') : getLocale() === 'en' ? at.toLocaleDateString('en-GB', {day: 'numeric', month: 'short'}) : date(at, {day: 'numeric', month: 'short'}), clock});
}
// What our servers hold, in one line: the last copy while it is on, the deletion once it is off, or a copy still there after a delete that failed (owner, 27 Oct 2026).
function heldLine(mine, now) {
  if (mine.copiedAt) return mine.on ? t('helperMore.hostedCopied', {stamp: stamp(mine.copiedAt, now)}) : t('helperMore.hostedCopyRemains', {stamp: stamp(mine.copiedAt, now)});
  return !mine.on && mine.deletedAt ? t('helperMore.hostedDeleted', {stamp: stamp(mine.deletedAt, now)}) : '';
}

// -> {state, pill: [text, tone], line, held, asksEmail, button: 'on' | 'email' | 'resume' | null, off, download, erase, note}
//   held: when the profile was last copied to our servers, or deleted from them. erase: "Delete our copy of your data" shows while off and only when this Mac
//   copied the profile to us and it is not deleted yet, whatever the store (SQLite or Notion: their data stays theirs; owner, 27 Oct 2026: "That is in his control.
//   not in our control"). While on, "Turn off and delete" does it.
//   mine: the app's own record {on, skipped, email}; schedule: the server's {state, pause_reason, next_run_at, email_channel} or null;
//   shared: the address Settings → Notifications keeps, the one Always on uses (#1711, owner 27 Oct 2026: one shared e-mail). asksEmail: there is none yet,
//   and the button goes to Notifications to add it.
export function model(mine = {}, schedule = null, now = new Date(), shared = '', mail = null) {
  return {...view(mine, schedule, now, shared, mail), held: heldLine(mine, now), erase: !mine.on && !!mine.copiedAt};
}
function view(mine, schedule, now, shared, mail) {
  const email = mine.email || shared || '', skipped = !!mine.skipped && !mine.on;
  // Why (5 Nov 2026, owner: "What should a not-yet-turned-on servers card say?" -> "Off"): a green On for a service that is not running told a screen-reader user it was on. Same for 'ready' below; the translated Off label preserves this service-state distinction.
  if (!email && (skipped || !mine.on)) return {state: 'needs-email', pill: [t('helperMore.off'), 'neutral'], line: t('helperMore.hostedNeedsEmail'), asksEmail: true, button: 'email', off: false, download: false};
  if (skipped) return {state: 'off', pill: [t('helperMore.off'), 'neutral'], line: t('helperMore.hostedOffLine', {email}), asksEmail: false, button: 'on', off: false, download: false};
  if (!mine.on) return {state: 'ready', pill: [t('helperMore.off'), 'neutral'], line: t('helperMore.hostedReady', {email}), asksEmail: false, button: 'on', off: false, download: false};
  if (schedule?.state === 'paused') {
    const why = {
      'inactive': [t('helperMore.hostedInactive'), 'resume'],
      'trial-over': [t('helperMore.hostedTrialOver', {promise: promise()}), null],
      'budget': [t('helperMore.hostedBudget', {promise: promise()}), null],
      'guard': [t('helperMore.hostedGuard'), null],
    }[schedule.pause_reason] || [t('helperMore.hostedPaused'), 'resume'];
    return {state: `paused-${schedule.pause_reason || 'other'}`, pill: [t('helperMore.hostedPausedPill'), 'warn'], line: why[0], asksEmail: false, button: why[1], off: true, download: true};
  }
  const next = schedule?.next_run_at ? t('helperMore.hostedNext', {when: when(schedule.next_run_at, now)}) : '';
  const mailOff = schedule && schedule.email_channel === 0 ? t('helperMore.hostedMailOff') : '';
  const unconfirmed = mail?.reached && !mail.confirmed;   // `mail`: notifyState's answer; the site holds an unconfirmed address's mail, so the matches would not arrive
  if (unconfirmed) return {state: 'on', pill: [t('helperMore.hostedOnPill'), 'good'], line: t('helperMore.hostedConfirm', {email, next}), asksEmail: false, button: null, off: true, download: true};
  return {state: 'on', pill: [t('helperMore.hostedOnPill'), 'good'], line: t('helperMore.hostedDaily', {email, next, mailOff}), asksEmail: false, button: null, off: true, download: true};
}

// The dialog after a scheduled check did not run (lib/always-on-moments.js): the due time on the person's own clock. The app cannot tell asleep from off, so it says both.
export function missedWords(iso) {
  const at = new Date(iso);
  return {title: t('helperMore.hostedMissed', {clock: `${at.getHours()}:${two(at.getMinutes())}`}),
    body: t('helperMore.hostedMissedBody')};
}

/** The line after Always on was turned on: matches go out only to a confirmed address (the site holds the mail of one nobody confirmed), so an unconfirmed one is told to press its link. */
export const turnedOnLine = (email, confirmed) => (confirmed ? t('helperMore.hostedTurnedOn', {email}) : t('helperMore.hostedTurnedConfirm', {email}));
