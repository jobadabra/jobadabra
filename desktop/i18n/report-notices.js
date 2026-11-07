// Register UI report replies; English uses canonical source fallbacks and metadata never enters transport.
import {registerMessages} from './index.js';
import en from './catalogs/report-notices/en.js';
import de from './catalogs/report-notices/de.js';
import fr from './catalogs/report-notices/fr.js';
import it from './catalogs/report-notices/it.js';
import es from './catalogs/report-notices/es.js';
import ro from './catalogs/report-notices/ro.js';
import ru from './catalogs/report-notices/ru.js';

for (const [locale, messages] of Object.entries({en, de, fr, it, es, ro, ru})) registerMessages(locale, 'reportNotices', messages);
