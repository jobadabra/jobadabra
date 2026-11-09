// The "Next: employer sites (561 left to read), then job boards" line of a finished Find jobs run's card (plan P3; renderer/pages/next-step-line.js).
import {registerMessages} from './index.js';
import en from './catalogs/next-step/en.js';
import de from './catalogs/next-step/de.js';
import fr from './catalogs/next-step/fr.js';
import it from './catalogs/next-step/it.js';
import es from './catalogs/next-step/es.js';
import ro from './catalogs/next-step/ro.js';
import ru from './catalogs/next-step/ru.js';
for (const [locale, messages] of Object.entries({en, de, fr, it, es, ro, ru})) registerMessages(locale, 'nextStep', messages);
