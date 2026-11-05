// The words of the invitation to tell us what went wrong, and what its two buttons do (drawn by pages/ask-card.js). Pure, so a test reads it without a window.

/** The one place a kind of ask is named (lib/asks.js takes its kinds from here, so the gate never opens an ask the window cannot draw). */
export const ASK_FAILED_APPLICATION = 'failed-application';

/** The words of each kind of ask: {title, body}. */
export const ASK_WORDS = {[ASK_FAILED_APPLICATION]: {title: 'Something went wrong with an application', body: 'Tell us what happened. We read every report and write back within a day.'}};

/** A button was pressed on ask `kind`: tell the main process (which owns the quiet time) and, for "Tell us" only, open the Send feedback dialog. An unknown kind does nothing. */
export function answerAsk(kind, how, {pilot, openFeedback}) {
  if (!ASK_WORDS[kind] || !['tell', 'later'].includes(how)) return;
  Promise.resolve(pilot.asksAnswer(kind, how)).catch(() => {});
  if (how === 'tell') openFeedback();
}
