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
