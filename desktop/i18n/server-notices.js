// Register only extension-facing desktop notices without changing the shared locale runtime.
import {registerMessages} from './index.js';
import {messages as en} from './catalogs/server-notices/en.js';
import {messages as de} from './catalogs/server-notices/de.js';
import {messages as fr} from './catalogs/server-notices/fr.js';
import {messages as it} from './catalogs/server-notices/it.js';
import {messages as es} from './catalogs/server-notices/es.js';
import {messages as ro} from './catalogs/server-notices/ro.js';
import {messages as ru} from './catalogs/server-notices/ru.js';
export const catalogs = Object.freeze({en,de,fr,it,es,ro,ru});
for (const [locale,messages] of Object.entries(catalogs)) registerMessages(locale,'serverNotice',messages);
export {t} from './index.js';
