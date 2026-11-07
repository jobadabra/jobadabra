// Register standalone LinkedIn import display catalogs without changing provider parsing, consent or control contracts.
import {registerMessages, t} from './index.js';
import en from './catalogs/linkedin-notices/en.js';
import de from './catalogs/linkedin-notices/de.js';
import fr from './catalogs/linkedin-notices/fr.js';
import it from './catalogs/linkedin-notices/it.js';
import es from './catalogs/linkedin-notices/es.js';
import ro from './catalogs/linkedin-notices/ro.js';
import ru from './catalogs/linkedin-notices/ru.js';
for (const [locale, messages] of Object.entries({en, de, fr, it, es, ro, ru})) registerMessages(locale, 'linkedinNotice', messages);

/** Resolve only an app-authored LinkedIn display wrapper at invocation, preserving raw interpolated values once. */
export function linkedinText(key, variables) { return t(`linkedinNotice.${key}`, variables); }
