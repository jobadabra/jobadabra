// Register CV display notices separately from document content and resolve them at invocation time.
import {registerMessages, t} from './index.js';
import en from './catalogs/cv-notices/en.js';
import de from './catalogs/cv-notices/de.js';
import fr from './catalogs/cv-notices/fr.js';
import it from './catalogs/cv-notices/it.js';
import es from './catalogs/cv-notices/es.js';
import ro from './catalogs/cv-notices/ro.js';
import ru from './catalogs/cv-notices/ru.js';

for (const [locale, messages] of Object.entries({en, de, fr, it, es, ro, ru})) registerMessages(locale, 'cvNotices', messages);

/** Translate app-owned CV notice copy once; interpolated provider text and personal data stay unchanged. */
export const cvNotice = (key, variables = {}) => t(`cvNotices.${key}`, variables);
