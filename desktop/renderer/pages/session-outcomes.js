// Translate only renderer-owned completion receipts, preserving the stored identifiers and applicant answers.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';

const RECEIPTS = {'Filled in the form': 'pagesFinalLabels.filledForm', 'Ticked in the form': 'pagesFinalLabels.tickedForm', Checked: 'pagesSession.checked'};
const PREFIXES = [['To send: ', 'pagesSessionOutcomes.toSend'], ['Agreed: ', 'pagesSessionOutcomes.agreed'], ['Filled in the form: ', 'pagesSessionOutcomes.filled']];

/** Display a known completion receipt without changing its stored value or interpreting the applicant's answer. */
export function outcomeLabel(outcome) {
  if (Object.hasOwn(RECEIPTS, outcome)) return t(RECEIPTS[outcome]);
  for (const [prefix, key] of PREFIXES) if (typeof outcome === 'string' && outcome.startsWith(prefix)) return t(key, {answer: outcome.slice(prefix.length)});
  return outcome;
}
