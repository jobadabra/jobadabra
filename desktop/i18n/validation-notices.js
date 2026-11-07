// Register validation display notices independently of license rules, review dispatch and native notices.
import {registerMessages, t} from './index.js';
import en from './catalogs/validation-notices/en.js';
import de from './catalogs/validation-notices/de.js';
import fr from './catalogs/validation-notices/fr.js';
import it from './catalogs/validation-notices/it.js';
import es from './catalogs/validation-notices/es.js';
import ro from './catalogs/validation-notices/ro.js';
import ru from './catalogs/validation-notices/ru.js';

for (const [locale, messages] of Object.entries({en, de, fr, it, es, ro, ru})) registerMessages(locale, 'validationNotices', messages);

/** Resolve app-authored validation copy at invocation; raw dates and provider text interpolate once. */
export const validationNotice = (key, variables = {}) => t(`validationNotices.${key}`, variables);
