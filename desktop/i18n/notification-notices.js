// Notification Settings projections keep diagnostics, provider values, stored notes and outgoing mail canonical.
import {withDisplay, displayText} from './display-values.js';
import {hostPlatform, osText} from './platform.js';
import {registerMessages} from './index.js';
import en from './catalogs/notification-notices/en.js';
import de from './catalogs/notification-notices/de.js';
import fr from './catalogs/notification-notices/fr.js';
import it from './catalogs/notification-notices/it.js';
import es from './catalogs/notification-notices/es.js';
import ro from './catalogs/notification-notices/ro.js';
import ru from './catalogs/notification-notices/ru.js';
for (const [locale, messages] of Object.entries({en, de, fr, it, es, ro, ru})) registerMessages(locale, 'notificationNotices', messages);

/** Tag only an authored error field; the original result and its canonical values remain unchanged. */
export const notificationFailure = (value, key) => withDisplay(value, `notificationNotices.${key}`);

/** Clone an error reply at the Settings UI boundary; unknown provider errors retain the exact fallback. */
export const notificationReply = value => value?.ok === false && Object.hasOwn(value, 'error') ? {...value, error: displayText(value, value.error)} : value;

/** Project trusted app-owned delivery guidance by mode/platform IDs, never by parsing personal or upstream text. */
export function deliveryText(mode, fallback, platform = hostPlatform()) {
  const pc = platform === 'win32';
  const key = mode === 'mac' ? (pc ? 'wherePc' : 'whereMac') : mode === 'always' ? (pc ? 'whereAlwaysPc' : 'whereAlwaysMac') : '';
  if (!key) return fallback;
  // Why (7 Nov 2026): only canonical app-owned WHERE text reaches this fallback; translated device labels use explicit catalog variants.
  return displayText(withDisplay({}, `notificationNotices.${key}`), osText(fallback, platform));
}

/** Clone only owned delivery fields for Settings; cached notes and website row names/schedules stay original. */
export function mailChoicesReply(value) {
  if (!value?.ok || !Object.hasOwn(value, 'where')) return notificationReply(value);
  return {...value, where: deliveryText(value.mode, value.where), macWhere: deliveryText('mac', value.macWhere),
    rows: value.rows.map(row => ({...row, where: deliveryText(value.mode, row.where)}))};
}
