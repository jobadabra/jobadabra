// The extension's word for a session's page as it happens (extension/page-mark.js) -> the card's line (lib/review.js notePage), logged once per change. One function for the app
// (ext-server-handlers.js) and the journey tests' offline app (e2e/lib/offline-app-child.mjs), so the card moves the same way in both. Guard: desktop/test/unit/extension/page-steps.test.js.
import * as journal from './session-journal.js';
import {pageLine} from '../renderer/page-lines.js';

// Each new page is also a step of the session's live log (lib/session-journal.js), in the card's own words (renderer/session-state.js pageLine).
export const pageStepHandler = ({terminals, review, appLog}) => ({session, page} = {}) => {
  if (!session || !terminals.get(String(session)) || !review.notePage(String(session), String(page || ''))) return;
  appLog('review', `page ${session}: ${page}`);
  if (page !== 'form') journal.note(String(session), {text: pageLine(String(page || ''))});   // the form's own line is its fill count (session-flow.js)
};
