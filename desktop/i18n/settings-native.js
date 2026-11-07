// Register the bounded Settings/wizard/native/update display namespace independently of shared runtime and Focus/Jobs recipes.
import {registerMessages, t} from './index.js';
import en from './catalogs/settings-native/en.js';
import de from './catalogs/settings-native/de.js';
import fr from './catalogs/settings-native/fr.js';
import it from './catalogs/settings-native/it.js';
import es from './catalogs/settings-native/es.js';
import ro from './catalogs/settings-native/ro.js';
import ru from './catalogs/settings-native/ru.js';
for (const [locale, messages] of Object.entries({en, de, fr, it, es, ro, ru})) registerMessages(locale, 'settingsNative', messages);

/** Resolve an explicitly authored display message at invocation; interpolation values are inserted once and remain raw. */
export function settingsText(key, variables = {}) { return t(`settingsNative.${key}`, variables); }

const UPDATE_STEPS = new Set(['updateDownloading', 'updateReady', 'updateInstalling', 'updateUnpacking', 'updateRestarting']);
/** Project only the updater's explicit known step keys; unknown/untagged progress keeps its exact canonical text. */
export function updateStepText(canonical, key) { return UPDATE_STEPS.has(key) ? settingsText(key) : canonical; }
