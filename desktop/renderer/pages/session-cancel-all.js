// The sessions page's "Cancel all applications" (owner, 5 Nov 2026, in place of the header's Stop): one question, then every unfinished application is cancelled
// the way its own Cancel application does it (lib/session-handlers.js sessionsCancelAll). Submitted ones are never touched. Guard: test/unit/main/session-cancel-all.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {$} from './core.js';
import {jobsChanged} from './jobs.js';
import {refreshSessions} from './sessions.js';
import {toastMessage} from './startup.js';

/** Wires the header's Cancel all applications button: asks the app (which asks the person once), then says what happened and redraws the list. */
export function init() {
  $('ss-cancel-all').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await window.pilot.sessionsCancelAll();
      if (result?.cancelled) return;   // the person kept them
      const count = result?.count || 0;
      if (count) jobsChanged();   // their jobs went back to Kit ready: the Jobs list reads them again
      toastMessage(result?.ok === false ? t('pagesSessionStates.notAllCancelled') : t('pagesSessionStates.allCancelled'), result?.ok === false ? result.error
        : t('pagesDynamicSessionReports.m335', {"count": count}), {view: 'sessions'}, result?.ok === false ? 'bad' : 'good');
      await refreshSessions();
    } finally { button.disabled = false; }
  });
}
