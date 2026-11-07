// Register kit and tailored-CV display messages without changing the shared runtime or canonical flow text.
import {registerMessages} from './index.js';
import {messages as en} from './catalogs/kit-notices/en.js';
import {messages as de} from './catalogs/kit-notices/de.js';
import {messages as fr} from './catalogs/kit-notices/fr.js';
import {messages as it} from './catalogs/kit-notices/it.js';
import {messages as es} from './catalogs/kit-notices/es.js';
import {messages as ro} from './catalogs/kit-notices/ro.js';
import {messages as ru} from './catalogs/kit-notices/ru.js';
export const catalogs = Object.freeze({en,de,fr,it,es,ro,ru});
for (const [locale,messages] of Object.entries(catalogs)) registerMessages(locale,'kitNotice',messages);
export {t} from './index.js';
