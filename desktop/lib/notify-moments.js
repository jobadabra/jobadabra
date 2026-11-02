// The pop-ups for an e-mail address that waits for its confirm link (spec docs/superpowers/specs/2026-11-02-notify-moments-design.md): a reminder on day 3 and day 10 after the address was saved,
// and one when the site stopped the mail on day 14; with 2/2 also an application that waited over an hour (waited) and Full automation with nobody who can be told (lost). The moments the window itself
// detects (match, reply, recruiter: renderer/notify-detect.js) are recorded here too. Each opens once for the address; a new address starts over. The window asks (pages/notify-moment.js) and shows what it is told.
// State: `settings.notifyOffer = {emailAt, moments: {day3, day10, stopped, waited, lost, match, reply, recruiter: ISO}}`, written only here. Guard: test/notify-moments.test.js.
import {workingChannel} from '../renderer/notify-words.js';

const DAY = 24 * 60 * 60 * 1000;
export const REMINDER_DAYS = {day3: 3, day10: 10};

/**
 * -> {next(state, now, {waited}), shown(moment, now), done()}. `state` is notifyState's answer (lib/notify-channel.js); `waited` is waitingMessage.waitedFor(). next() -> {moment, ...} or null, in order:
 * waited, the address reminders (day3, day10, stopped), lost. Invariants: never while a channel works, never in setup, never when the site did not answer; reminders need an address and the person
 * not unsubscribed; only the latest due reminder (the app opened first on day 11 shows day 10, never the stale day 3 afterwards); the site's stop needs no count; waited and lost need no address
 * (they offer the way to be told); lost only for Full automation that is on AND confirmed (state.automation).
 */
export function createNotifyMoments(storage) {
  const mine = () => {
    const kept = storage.settings().notifyOffer || {};
    return kept.emailAt === (storage.settings().notifyEmailAt || '') ? kept : {};   // a new address: the record of the old one is void
  };
  function reminder(state, now, done) {
    if (!state.email || state.serviceOff) return null;
    if (state.unconfirmedStopped) return done.stopped ? null : {moment: 'stopped', days: 14, email: state.email};
    const saved = Date.parse(state.emailAt);
    if (!saved) return null;
    const days = Math.floor((now - saved) / DAY);
    const due = days >= REMINDER_DAYS.day10 ? 'day10' : days >= REMINDER_DAYS.day3 ? 'day3' : '';
    if (!due || done.day10 || (due === 'day3' && done.day3)) return null;
    return {moment: due, days, email: state.email};
  }
  return {
    /** Whether any connection pop-up may show now: set up, the website answered, no channel works (never in setup: owner, 2 Nov 2026, the wizard stays AI, CV, Strategy). The window's own detections ask this too. */
    allowed: state => !!storage.settings().setupDone && !!state?.reached && !workingChannel(state),
    next(state, now = Date.now(), {waited = null} = {}) {
      if (!this.allowed(state)) return null;
      const done = mine().moments || {};
      if (waited && !done.waited) return {moment: 'waited', hours: waited.hours, count: waited.count, title: waited.title, company: waited.company};
      return reminder(state, now, done) || (state.automation && !done.lost ? {moment: 'lost'} : null);
    },
    shown(moment, now = Date.now()) {
      const kept = mine(), at = new Date(now).toISOString();
      const earlier = moment === 'day10' ? {day3: kept.moments?.day3 || at} : {};   // day 10 shown: the stale day 3 is not shown afterwards
      storage.saveSettings({notifyOffer: {emailAt: storage.settings().notifyEmailAt || '', moments: {...kept.moments, ...earlier, [moment]: at}}});
    },
    /** The moments already shown for this address: {name: ISO}. */
    done: () => ({...mine().moments}),
  };
}
