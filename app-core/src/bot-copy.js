// Explicit per-request end-user bot copy; context-free operator/CI callers always retain English.
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
export function botText(context, key, variables = {}) {
  const locale = botLocale(context), value = catalogs[locale][key] ?? en[key];
  const count = Number(variables.count), form = Number.isFinite(count) ? new Intl.PluralRules(locale).select(count) : 'other';
  const template = typeof value === 'string' ? value : value?.[form] ?? value?.other;
  if (typeof template !== 'string') return key;
  const shown = Number.isFinite(count) ? new Intl.NumberFormat(locale).format(count) : '';
  return template.replace(/\{([a-zA-Z][\w]*)\}/g, (placeholder, name) => name === 'shown' ? shown : Object.hasOwn(variables, name) ? String(variables[name]) : placeholder);
}
/** Name only known canonical stages for display; an unknown supplied stage remains byte-for-byte raw content. */
export const botStage = (context, stage) => stages[stage] ? botText(context, stages[stage]) : stage;
/** Assemble the six authored help sections for this request without changing command recognition. */
export const botHelp = context => Array.from({length: 6}, (_, index) => botText(context, `help${index}`)).join('\n\n');
