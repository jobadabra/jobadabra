// Register detail and location display instructions without altering shared localization or stored values.
import {registerMessages} from './index.js';
import {messages as en} from './catalogs/detail-notices/en.js';
import {messages as de} from './catalogs/detail-notices/de.js';
import {messages as fr} from './catalogs/detail-notices/fr.js';
import {messages as it} from './catalogs/detail-notices/it.js';
import {messages as es} from './catalogs/detail-notices/es.js';
import {messages as ro} from './catalogs/detail-notices/ro.js';
import {messages as ru} from './catalogs/detail-notices/ru.js';
/** Bundled display-only catalogs for the seven supported locales. */
export const catalogs = Object.freeze({en,de,fr,it,es,ro,ru});
for (const [locale,messages] of Object.entries(catalogs)) registerMessages(locale,'detailNotice',messages);
export {t} from './index.js';
