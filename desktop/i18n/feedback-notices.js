// Register standalone feedback and waitlist display catalogs without changing shared runtime or request contracts.
import {registerMessages, t} from './index.js';
import en from './catalogs/feedback-notices/en.js';
import de from './catalogs/feedback-notices/de.js';
import fr from './catalogs/feedback-notices/fr.js';
import it from './catalogs/feedback-notices/it.js';
import es from './catalogs/feedback-notices/es.js';
import ro from './catalogs/feedback-notices/ro.js';
import ru from './catalogs/feedback-notices/ru.js';
for (const [locale, messages] of Object.entries({en, de, fr, it, es, ro, ru})) registerMessages(locale, 'feedbackNotice', messages);

/** Resolve an app-authored feedback/waitlist display message at invocation; interpolate raw values once as plain text. */
export function feedbackText(key, variables) { return t(`feedbackNotice.${key}`, variables); }
