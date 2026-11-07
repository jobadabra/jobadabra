// Shared desktop message catalogs: explicit keys, English fallback and language-specific plural selection.
import {common} from './catalogs/common.js';
import {osText} from './platform.js';

export const SUPPORTED_LOCALES = Object.freeze(['en', 'de', 'fr', 'it', 'es', 'ro', 'ru']);
export const LANGUAGE_NAMES = Object.freeze({en: 'English', de: 'Deutsch', fr: 'Français', it: 'Italiano', es: 'Español', ro: 'Română', ru: 'Русский'});
const catalogs = new Map(SUPPORTED_LOCALES.map(locale => [locale, new Map()]));
let active = 'en';
const base = value => typeof value === 'string' ? value.toLowerCase().split(/[-_]/)[0] : '';

/** Resolve a saved display choice or the first supported operating-system preference. */
export function resolveLocale(choice, preferred = []) {
  if (choice && choice !== 'system' && SUPPORTED_LOCALES.includes(base(choice))) return base(choice);
  for (const value of Array.isArray(preferred) ? preferred : [preferred]) if (SUPPORTED_LOCALES.includes(base(value))) return base(value);
  return 'en';
}

/** Set only this process's active display locale; this never changes application content or storage. */
export function setLocale(locale) { active = SUPPORTED_LOCALES.includes(base(locale)) ? base(locale) : 'en'; return active; }
/** Return the active display locale used by messages and formatting. */
export function getLocale() { return active; }

/** Register a namespace of trusted bundled strings or plural-form maps for one supported locale. */
export function registerMessages(locale, namespace, messages) {
  if (!catalogs.has(locale) || typeof namespace !== 'string' || !namespace || !messages || typeof messages !== 'object') throw new TypeError('Invalid language catalog');
  const target = catalogs.get(locale);
  for (const [key, value] of Object.entries(messages)) target.set(`${namespace}.${key}`, value);
}

function message(locale, key, variables) {
  const value = catalogs.get(locale)?.get(key);
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  const count = Number(variables.count);
  const form = Number.isFinite(count) ? new Intl.PluralRules(locale).select(count) : 'other';
  return Object.hasOwn(value, form) ? value[form] : value.other;
}

/** Format trusted app copy once as plain text; an explicit platform overrides the host for platform-aware views. */
export function t(key, variables = {}, platform = globalThis.window?.pilot?.platform ?? globalThis.process?.platform) {
  const template = message(active, key, variables) ?? message('en', key, variables);
  if (typeof template !== 'string') return String(key);
  // Adapt only the trusted template: interpolation values remain byte-for-byte personal content.
  return osText(template, platform).replace(/\{([a-zA-Z][\w]*)\}/g, (placeholder, name) => Object.hasOwn(variables, name) ? String(variables[name]) : placeholder);
}

for (const [locale, messages] of Object.entries(common)) registerMessages(locale, 'common', messages);
