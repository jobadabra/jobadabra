// The pop-ups for an e-mail address that waits for its confirm link (spec docs/superpowers/specs/2026-11-02-notify-moments-design.md): a reminder on day 3 and day 10 after the address was saved,
// and one when the site stopped the mail on day 14. Each opens once for the address; a new address starts over. The window asks (pages/notify-moment.js) and shows what it is told.
// State: `settings.notifyOffer = {emailAt, moments: {day3, day10, stopped: ISO}}`, written only here. Guard: test/notify-moments.test.js.
import {workingChannel} from '../renderer/notify-words.js';

const DAY = 24 * 60 * 60 * 1000;
export const REMINDER_DAYS = {day3: 3, day10: 10};

/**
 * -> {next(state, now), shown(moment, now)}. `state` is notifyState's answer (lib/notify-channel.js). next() -> {moment, days, email} or null. Invariants: never while a channel works, the
 * person unsubscribed or there is no address; only the latest due reminder (the app opened first on day 11 shows day 10, never the stale day 3 afterwards); the site's stop needs no count.
 */
export function createNotifyMoments(storage) {
  const mine = () => {
    const kept = storage.settings().notifyOffer || {};
    return kept.emailAt === (storage.settings().notifyEmailAt || '') ? kept : {};   // a new address: the record of the old one is void
  };
  return {
    next(state, now = Date.now()) {
      if (!storage.settings().setupDone || !state?.reached || !state.email || state.serviceOff || workingChannel(state)) return null;   // never in setup (owner, 2 Nov 2026: the wizard stays AI, CV, Strategy)
      const done = mine().moments || {};
      if (state.unconfirmedStopped) return done.stopped ? null : {moment: 'stopped', days: 14, email: state.email};
      const saved = Date.parse(state.emailAt);
      if (!saved) return null;
      const days = Math.floor((now - saved) / DAY);
      const due = days >= REMINDER_DAYS.day10 ? 'day10' : days >= REMINDER_DAYS.day3 ? 'day3' : '';
      if (!due || done.day10 || (due === 'day3' && done.day3)) return null;
      return {moment: due, days, email: state.email};
    },
    shown(moment, now = Date.now()) {
      const kept = mine(), at = new Date(now).toISOString();
      const earlier = moment === 'day10' ? {day3: kept.moments?.day3 || at} : {};   // day 10 shown: the stale day 3 is not shown afterwards
      storage.saveSettings({notifyOffer: {emailAt: storage.settings().notifyEmailAt || '', moments: {...kept.moments, ...earlier, [moment]: at}}});
    },
  };
}
