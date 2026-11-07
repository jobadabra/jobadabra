// Register helper catalogs before importing renderer modules with module-level display strings.
import {registerMessages} from './index.js';
import {messages as en} from './catalogs/helpers/en.js';
import {messages as de} from './catalogs/helpers/de.js';
import {messages as fr} from './catalogs/helpers/fr.js';
import {messages as it} from './catalogs/helpers/it.js';
import {messages as es} from './catalogs/helpers/es.js';
import {messages as ro} from './catalogs/helpers/ro.js';
import {messages as ru} from './catalogs/helpers/ru.js';

for (const [locale, messages] of Object.entries({en, de, fr, it, es, ro, ru})) registerMessages(locale, 'helpers', messages);












// State catalogs stay separate to keep each bundled catalog below 500 lines.
import {messages as enState} from './catalogs/helpers/en-state.js';
import {messages as deState} from './catalogs/helpers/de-state.js';
import {messages as frState} from './catalogs/helpers/fr-state.js';
import {messages as itState} from './catalogs/helpers/it-state.js';
import {messages as esState} from './catalogs/helpers/es-state.js';
import {messages as roState} from './catalogs/helpers/ro-state.js';
import {messages as ruState} from './catalogs/helpers/ru-state.js';
for (const [locale, messages] of Object.entries({en: enState, de: deState, fr: frState, it: itState, es: esState, ro: roState, ru: ruState})) registerMessages(locale, 'helperState', messages);

// Other helper copy is registered separately from state and plural messages.
import {messages as enMore} from './catalogs/helpers/en-more.js';
import {messages as deMore} from './catalogs/helpers/de-more.js';
import {messages as frMore} from './catalogs/helpers/fr-more.js';
import {messages as itMore} from './catalogs/helpers/it-more.js';
import {messages as esMore} from './catalogs/helpers/es-more.js';
import {messages as roMore} from './catalogs/helpers/ro-more.js';
import {messages as ruMore} from './catalogs/helpers/ru-more.js';
for (const [locale, messages] of Object.entries({en: enMore, de: deMore, fr: frMore, it: itMore, es: esMore, ro: roMore, ru: ruMore})) registerMessages(locale, 'helperMore', messages);
