// The mail to the person's e-mail when Full automation has sent applications for them (owner, 8 Nov 2026, "an e-mail for every automation"; plan docs/superpowers/plans/2026-11-08-mw-automation-mails.md 5/5):
// until now the person who was away learned nothing. One mail lists the applications of a burst (a 60 s window groups them); it goes under the row `app-applied`, so the person's switch holds it.
// Invariants: only an application the app itself pressed Submit on (an attempt the site confirmed) is added; the person's own Submit press never is (they know); each application once; no working e-mail = nothing sent and nothing kept;
// a failed send is logged and dropped (the app's own notification already showed it). The window is lib/mail-batch.js, shared with the waiting message. Guard: test/unit/main/applied-message.test.js.
import {notificationText} from '../i18n/user-notifications.js';
import {notificationLanguage} from './notification-language.js';
import * as notifyChannel from './notify-channel.js';
import {allowed} from './mail-choices.js';
import {log as appLog} from './log.js';
import {createBatchWindow, defaultTimer, perStorage} from './mail-batch.js';

export const ROW = 'app-applied';
export const WINDOW_MS = 60 * 1000;   // Why (8 Nov 2026): the first sent application opens a window so a Full automation batch goes out as one mail

/** The one applied-message sender of this app profile (the apply controller shares it). */
export const appliedMessageFor = perStorage(storage => createAppliedMessage(storage));

/**
 * -> {add({id, title, company, at?})}. `add` queues an application Full automation sent; after WINDOW_MS the one mail lists every application queued meanwhile. Everything else is injectable for tests.
 * `at` is the send time (ms); the mail shows it as the hour of day in the person's notification language. `fetcher` reaches the site (tests pass a fake: nothing here reaches a real inbox).
 */
export function createAppliedMessage(storage, {now = Date.now, setTimer = defaultTimer, channels = () => notifyChannel.channelsOf(storage), fetcher = globalThis.fetch,
  sendEmail = mail => allowed(storage, ROW) && notifyChannel.sendEmail(storage, {...mail, urgent: true, mail: ROW}, fetcher), log = appLog} = {}) {
  const seen = new Set();
  async function send(items) {
    if (!channels().includes('email')) { log('apply', 'applied message not sent: no e-mail works', {count: items.length}); return; }
    const locale = notificationLanguage(storage), textOf = (key, variables) => notificationText(locale, key, variables);
    const clock = new Intl.DateTimeFormat(locale, {hour: '2-digit', minute: '2-digit', hour12: false});
    const lines = items.map(item => {
      const name = item.title && item.company ? `${item.title} · ${item.company}` : item.title || item.company || textOf('application');
      return Number.isFinite(item.at) ? `${name}, ${clock.format(item.at)}` : name;
    });
    const text = [textOf('appliedIntro'), lines.join('\n'), textOf('appliedSaved')].join('\n\n');
    const buttons = [{text: textOf('appliedButton'), url: 'https://www.jobadabra.top/open?view=jobs'}];   // Why (8 Nov 2026): /open reaches only Jobs and Sessions; the sent jobs are Applied in Jobs
    const sent = await Promise.resolve().then(() => sendEmail({subject: textOf('applied', {count: items.length}), text, buttons})).catch(() => false);   // a send that throws at once is dropped like a failed one
    log('apply', 'applied message', {count: items.length, email: !!sent});
  }
  const batch = createBatchWindow({delay: () => WINDOW_MS, send, log, setTimer});
  return {
    add(item) {
      if (!item?.id || seen.has(item.id)) return;
      seen.add(item.id);
      batch.add({...item, at: item.at ?? now()});
    },
  };
}
