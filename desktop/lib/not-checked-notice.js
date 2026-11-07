// The notification for a Gmail check that read nothing (not connected, sign-in revoked): "not checked", never "had problems". Guarded by test/unit/main/gmail-not-checked-one-state.test.js.
import {completionWords} from '../i18n/completion-notices.js';
import {notChecked} from '../renderer/run-status.js';

/** Present the existing not-checked verdict; only explicit user locale changes authored framing, never the target or reason. */
export function notCheckedNotice(run, locale) {
  if (!notChecked(run)) return null;
  const text = (key, canonical) => completionWords(locale, key, {}, canonical);
  const where = run.where === 'github' ? text('where', ' (on GitHub)') : '';
  return {title: text('gmailNotChecked', 'Gmail check not checked') + where, body: run.off ? text('gmailDisconnected', 'Gmail is not connected: open Jobadabra to connect it.') : text('gmailWhy', 'Open Jobadabra to see why and what to do.'),
    ...(run.id == null ? {} : {target: {run: run.id}})};   // a click opens that run's result, as for every notice
}
