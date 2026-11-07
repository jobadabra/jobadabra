// Register the static screen catalogs before page imports; page and helper workers register their own namespaces.
import {registerMessages} from './index.js';
import common from './catalogs/screens/common.js';
import welcome from './catalogs/screens/welcome.js';
import main from './catalogs/screens/main.js';
import profile from './catalogs/screens/profile.js';
import automation from './catalogs/screens/automation.js';
import connections from './catalogs/screens/connections.js';
import settings from './catalogs/screens/settings.js';
import dialogsOne from './catalogs/screens/dialogs-one.js';
import dialogsTwo from './catalogs/screens/dialogs-two.js';
import attributes from './catalogs/screens/attributes.js';
import external from './catalogs/screens/external.js';
import platform from './catalogs/screens/platform.js';
import './screens-pages.js';
import './screens-helpers.js';

// Catalog columns are explicitly ordered; locale identifiers never come from translated content.
const locales = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];
for (const {namespace, messages} of [common, welcome, main, profile, automation, connections, settings, dialogsOne, dialogsTwo, attributes, external]) {
  for (const [column, locale] of locales.entries()) {
    registerMessages(locale, namespace, Object.fromEntries(Object.entries(messages).map(([key, values]) => [key, values[column]])));
  }
}

// Only reviewed app-owned messages have platform variants; personal values never pass through these catalogs.
if (globalThis.window?.pilot?.platform === 'win32') {
  for (const [qualified, values] of Object.entries(platform.messages)) {
    const dot = qualified.indexOf('.'), namespace = qualified.slice(0, dot), key = qualified.slice(dot + 1);
    for (const [column, locale] of locales.entries()) registerMessages(locale, namespace, {[key]: values[column]});
  }
}
