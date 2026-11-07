// Register setup-only failure guidance without translating diagnostic errors, provider content, keys or account values.
import {registerMessages, t} from './index.js';
import en from './catalogs/setup-notices/en.js';
import de from './catalogs/setup-notices/de.js';
import fr from './catalogs/setup-notices/fr.js';
import it from './catalogs/setup-notices/it.js';
import es from './catalogs/setup-notices/es.js';
import ro from './catalogs/setup-notices/ro.js';
import ru from './catalogs/setup-notices/ru.js';
for (const [locale, messages] of Object.entries({en, de, fr, it, es, ro, ru})) registerMessages(locale, 'setupNotice', messages);

/** Resolve UI-only setup guidance at invocation; tagged diagnostic failures are projected separately through displayText. */
export function setupText(key) { return t(`setupNotice.${key}`); }
