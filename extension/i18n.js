// Bundled extension display messages and rebuildable desktop-locale cache; never translates applicant or employer text.
import {catalogs} from './locales.js';
export {catalogs};
export const locales = Object.freeze(['en', 'de', 'fr', 'it', 'es', 'ro', 'ru']);
export const languageNames = Object.freeze({en:'🇬🇧 English',de:'🇩🇪 Deutsch',fr:'🇫🇷 Français',it:'🇮🇹 Italiano',es:'🇪🇸 Español',ro:'🇷🇴 Română',ru:'🇷🇺 Русский'});
const valid = locale => locales.includes(locale);
const normalize = locale => valid(locale) ? locale : 'en';

/** Create a display-only runtime; a failed request leaves its offline cache intact. */
export async function createI18n(storage) {
  const saved = await storage.get(['extensionLanguage', 'desktopDisplayLocale']);
  let choice = valid(saved.extensionLanguage) ? saved.extensionLanguage : 'desktop';
  let desktop = normalize(saved.desktopDisplayLocale);
  const listeners = new Set();
  const locale = () => choice === 'desktop' ? desktop : choice;
  const changed = () => { for (const listener of listeners) listener(); };
  return {
    locale, choice: () => choice,
    restore(saved) { choice = valid(saved.extensionLanguage) ? saved.extensionLanguage : 'desktop'; desktop = normalize(saved.desktopDisplayLocale); changed(); },
    async desktop(value) { desktop = normalize(value); await storage.set({desktopDisplayLocale:desktop}); changed(); },
    async preference(value) { choice = valid(value) ? value : 'desktop'; await storage.set({extensionLanguage:choice}); changed(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    t(key, values = {}) {
      let template = catalogs[locale()][key] ?? catalogs.en[key] ?? key;
      if (typeof template === 'object') template = template[new Intl.PluralRules(locale()).select(Number(values.count))] ?? template.other;
      return template.replace(/\{([a-zA-Z][\w]*)\}/g, (match, name) => Object.hasOwn(values, name) ? (typeof values[name] === 'number' ? new Intl.NumberFormat(locale()).format(values[name]) : String(values[name])) : match);
    },
    number(value) { return new Intl.NumberFormat(locale()).format(value); },
    date(value, options) { return new Intl.DateTimeFormat(locale(), options).format(value); },
  };
}

/** Translate only explicitly marked extension-owned nodes and attributes, using text rather than HTML. */
export function localize(root, i18n) {
  root.documentElement.lang = i18n.locale();
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = i18n.t(node.dataset.i18n);
  for (const node of root.querySelectorAll('[data-i18n-title]')) node.title = i18n.t(node.dataset.i18nTitle);
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = i18n.t(node.dataset.i18nPlaceholder);
}

/** Connect a page to cached display settings; Chrome storage events update an already open page. */
export async function displayLanguage(chromeApi = chrome) {
  const runtime = await createI18n(chromeApi.storage.local);
  chromeApi.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.extensionLanguage || changes.desktopDisplayLocale) chromeApi.storage.local.get(['extensionLanguage','desktopDisplayLocale']).then(saved => runtime.restore(saved));
  });
  return runtime;
}

/** Cache an answered desktop locale; a missing field from older desktops resets to English. */
export async function cacheDesktopLocale(storage, value) {
  const desktopDisplayLocale = normalize(value);
  const saved = await storage.get('desktopDisplayLocale');
  if (saved.desktopDisplayLocale !== desktopDisplayLocale) await storage.set({desktopDisplayLocale});
}
