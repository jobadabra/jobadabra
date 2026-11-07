// Explicit saved-language presentation for desktop completion notices and scrubbed private-user error framing.
import {renderCopy} from '../shared/app-core/notification-copy.js';
import en from './catalogs/completion-notices/en.js';
import de from './catalogs/completion-notices/de.js';
import fr from './catalogs/completion-notices/fr.js';
import it from './catalogs/completion-notices/it.js';
import es from './catalogs/completion-notices/es.js';
import ro from './catalogs/completion-notices/ro.js';
import ru from './catalogs/completion-notices/ru.js';
const catalogs = {en, de, fr, it, es, ro, ru};
/** Format a trusted authored template with explicit context, never completed run/result/error prose. */
export const completionText = (locale, key, variables = {}) => renderCopy(catalogs, locale, key, variables);
/** Preserve canonical default callers; only an explicit user locale opts into display framing. */
export const completionWords = (locale, key, variables, canonical) => locale === undefined ? canonical : completionText(locale, key, variables);
/** Surround already-scrubbed values with private-user framing without reading credentials, changing reports or rewriting values. */
export function privateErrorNotice(locale, found) {
  const text = (key, variables) => completionText(locale, key, variables);
  return text('error', {host: found.host ? text('host', {host: found.host}) : '',
    version: found.extVersion ? text('version', {version: found.extVersion}) : '', message: found.message});
}
