// Explicit per-request end-user bot copy; context-free operator/CI callers always retain English.
import {renderCopy} from './notification-copy.js';
import en from './bot-copy/en.js';
import de from './bot-copy/de.js';
import fr from './bot-copy/fr.js';
import it from './bot-copy/it.js';
import es from './bot-copy/es.js';
import ro from './bot-copy/ro.js';
import ru from './bot-copy/ru.js';
const catalogs = {en, de, fr, it, es, ro, ru};
const stages = {'Saved': 'stageSaved', 'Applied': 'stageApplied', 'Confirmation received': 'stageConfirmed', 'Screening': 'stageScreening',
  'Interview scheduled': 'stageScheduled', 'Interviewing': 'stageInterviewing', 'Offer': 'stageOffer', 'Rejected': 'stageRejected',
  'No response': 'stageNoResponse', 'Withdrawn': 'stageWithdrawn', 'Recruiter lead': 'stageLead'};
/** Resolve only an explicit canonical end-user context; global process/display language never affects another user or an operator. */
export const botLocale = context => Object.hasOwn(catalogs, context?.JOBADABRA_NOTIFICATION_LANGUAGE) ? context.JOBADABRA_NOTIFICATION_LANGUAGE : 'en';
/** Render trusted authored copy before interpolation; callers retain their existing escaping for raw HTML/text values. */
export const botText = (context, key, variables = {}) => renderCopy(catalogs, botLocale(context), key, variables);
/** Name only known canonical stages for display; an unknown supplied stage remains byte-for-byte raw content. */
export const botStage = (context, stage) => Object.hasOwn(stages, stage) ? botText(context, stages[stage]) : stage;
/** Assemble the six authored help sections for this request without changing command recognition. */
export const botHelp = context => Array.from({length: 6}, (_, index) => botText(context, `help${index}`)).join('\n\n');

const modes = {run: 'modeSearch', scheduled: 'modeSearch', first: 'modeSearch', today: 'modeSearch', scout: 'modeEmployers', mail: 'modeMail',
  weekly: 'modeWeekly', insight: 'modeInsight', interview: 'modeInterview', apply: 'modeApply', add: 'modeApply', prepare: 'modePrepare', visits: 'modeBrowser', more: 'modeMore', reminders: 'modeReminders'};
/** Project known run IDs for localized readers; legacy English and unknown supplied modes retain their exact display values. */
export const botMode = (context, mode) => botLocale(context) !== 'en' && Object.hasOwn(modes, mode) ? botText(context, modes[mode]) : mode;
