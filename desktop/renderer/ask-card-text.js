// The words of the invitation to tell us what went wrong, and what its two buttons do (drawn by pages/ask-card.js). Pure, so a test reads it without a window.

/** The one place a kind of ask is named (lib/asks.js takes its kinds from here, so the gate never opens an ask the window cannot draw). */
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
export const ASK_FAILED_APPLICATION = 'failed-application', ASK_FAILED_RUN = 'failed-run', ASK_CRASHED = 'crashed', ASK_THIN_SEARCH = 'thin-search';

/** The words of each kind of ask: {title, body}. */
const BODY = t('helperFlow.askBody');
export const ASK_WORDS = {
  [ASK_FAILED_APPLICATION]: {title: t('helperFlow.askApplication'), body: BODY},
  [ASK_FAILED_RUN]: {title: t('helperFlow.askSearch'), body: BODY},
  [ASK_CRASHED]: {title: t('helperFlow.askCrash'), body: BODY},
  [ASK_THIN_SEARCH]: {title: t('helperFlow.askMore'), body: t('helperFlow.askMoreBody')},
};

/** A button was pressed on ask `kind`: tell the main process (which owns the quiet time) and, for "Tell us" only, open the Send feedback dialog. An unknown kind does nothing. */
export function answerAsk(kind, how, {pilot, openFeedback}) {
  if (!ASK_WORDS[kind] || !['tell', 'later'].includes(how)) return;
  Promise.resolve(pilot.asksAnswer(kind, how)).catch(() => {});
  if (how === 'tell') openFeedback();
}
