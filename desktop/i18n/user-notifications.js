// Explicit per-profile notification copy; no global mutable delivery language or finished-message rewriting.
import {getLocale, resolveLocale, SUPPORTED_LOCALES} from './index.js';
import en from './catalogs/user-notifications/en.js';
import de from './catalogs/user-notifications/de.js';
import fr from './catalogs/user-notifications/fr.js';
import it from './catalogs/user-notifications/it.js';
import es from './catalogs/user-notifications/es.js';
import ro from './catalogs/user-notifications/ro.js';
import ru from './catalogs/user-notifications/ru.js';
const catalogs = {en, de, fr, it, es, ro, ru};
/** Resolve the existing desktop preference; only the explicit system choice uses main's current OS resolution. */
export const notificationLocale = settings => settings?.displayLanguage === 'system' ? getLocale() : resolveLocale(settings?.displayLanguage || 'en');
/** Select a trusted per-message template before inserting raw values; numeric count selects plurals and shown formats that count. */
export function notificationText(locale, key, variables = {}) {
  const language = SUPPORTED_LOCALES.includes(locale) ? locale : 'en';
  const value = catalogs[language][key] ?? en[key];
  const count = Number(variables.count);
  const form = Number.isFinite(count) ? new Intl.PluralRules(language).select(count) : 'other';
  const template = typeof value === 'string' ? value : value?.[form] ?? value?.other;
  if (typeof template !== 'string') return key;
  const shown = Number.isFinite(count) ? new Intl.NumberFormat(language).format(count) : '';
  return template.replace(/\{([a-zA-Z][\w]*)\}/g, (placeholder, name) => name === 'shown' ? shown : Object.hasOwn(variables, name) ? String(variables[name]) : placeholder);
}
