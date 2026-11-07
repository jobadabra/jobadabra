// Register bundled Focus and Jobs display messages without changing canonical producer values or stored records.
import {registerMessages} from './index.js';
import {messages as en} from './catalogs/focus-cards/en.js';
import {messages as de} from './catalogs/focus-cards/de.js';
import {messages as fr} from './catalogs/focus-cards/fr.js';
import {messages as it} from './catalogs/focus-cards/it.js';
import {messages as es} from './catalogs/focus-cards/es.js';
import {messages as ro} from './catalogs/focus-cards/ro.js';
import {messages as ru} from './catalogs/focus-cards/ru.js';

/** Bundled display catalogs for all seven supported Focus and Jobs locales. */
export const catalogs = Object.freeze({en, de, fr, it, es, ro, ru});
for (const [locale, messages] of Object.entries(catalogs)) registerMessages(locale, 'focusCards', messages);
