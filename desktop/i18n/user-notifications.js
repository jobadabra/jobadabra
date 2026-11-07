// Explicit per-profile notification copy; no global mutable delivery language or finished-message rewriting.
import {renderCopy} from '../shared/app-core/notification-copy.js';
import en from './catalogs/user-notifications/en.js';
import de from './catalogs/user-notifications/de.js';
import fr from './catalogs/user-notifications/fr.js';
import it from './catalogs/user-notifications/it.js';
import es from './catalogs/user-notifications/es.js';
import ro from './catalogs/user-notifications/ro.js';
import ru from './catalogs/user-notifications/ru.js';
const catalogs = {en, de, fr, it, es, ro, ru};
/** Select a trusted per-message template before inserting raw values; numeric count selects plurals and shown formats that count. */
export const notificationText = (locale, key, variables = {}) => renderCopy(catalogs, locale, key, variables);
