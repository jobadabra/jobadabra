// Register the static screen catalogs before page imports; page and helper workers register their own namespaces.
import {registerMessages} from './index.js';
import common from './catalogs/screens/common.js';
import welcome from './catalogs/screens/welcome.js';
import './screens-pages.js';
import './screens-helpers.js';

// Catalog columns are explicitly ordered; locale identifiers never come from translated content.
const locales = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];
for (const {namespace, messages} of [common, welcome]) {
  for (const [column, locale] of locales.entries()) {
    registerMessages(locale, namespace, Object.fromEntries(Object.entries(messages).map(([key, values]) => [key, values[column]])));
  }
}
