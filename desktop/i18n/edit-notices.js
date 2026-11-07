// Register editing display notices without changing document content, store contracts or diagnostic identities.
import {registerMessages, t} from './index.js';
import en from './catalogs/edit-notices/en.js';
import de from './catalogs/edit-notices/de.js';
import fr from './catalogs/edit-notices/fr.js';
import it from './catalogs/edit-notices/it.js';
import es from './catalogs/edit-notices/es.js';
import ro from './catalogs/edit-notices/ro.js';
import ru from './catalogs/edit-notices/ru.js';

for (const [locale, messages] of Object.entries({en, de, fr, it, es, ro, ru})) registerMessages(locale, 'editNotices', messages);

/** Resolve app-owned editing guidance at invocation; raw values interpolate exactly once. */
export const editNotice = (key, variables = {}) => t(`editNotices.${key}`, variables);
