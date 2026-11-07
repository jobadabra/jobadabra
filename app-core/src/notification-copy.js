// Format only trusted bundled notification templates with explicit language context, never completed user/provider messages.
/** Select a bundled locale with English fallback, use numeric counts for plurals, and interpolate supplied values once without rewriting them. */
export function renderCopy(catalogs, locale, key, variables = {}) {
  const language = Object.hasOwn(catalogs, locale) ? locale : 'en';
  const value = catalogs[language][key] ?? catalogs.en[key];
  const count = Number(variables.count), form = Number.isFinite(count) ? new Intl.PluralRules(language).select(count) : 'other';
  const template = typeof value === 'string' ? value : value?.[form] ?? value?.other;
  if (typeof template !== 'string') return key;
  const shown = Number.isFinite(count) ? new Intl.NumberFormat(language).format(count) : '';
  return template.replace(/\{([a-zA-Z][\w]*)\}/g, (placeholder, name) => name === 'shown' ? shown : Object.hasOwn(variables, name) ? String(variables[name]) : placeholder);
}
