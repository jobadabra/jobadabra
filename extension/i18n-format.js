// Shared classic/module formatter for trusted extension display messages; interpolation never reparses inserted values.
(() => {
  /** Format one explicit bundled key as plain text, with English fallback and locale-aware plural/number rules. */
  globalThis.__jobadabraFormatDisplayMessage = (messages, english, locale, key, values = {}, fallback = key) => {
    let template = messages?.[key] ?? english?.[key] ?? fallback;
    if (template && typeof template === 'object') template = template[new Intl.PluralRules(locale).select(Number(values.count))] ?? template.other;
    if (typeof template !== 'string') template = fallback;
    return template.replace(/\{([a-zA-Z][\w]*)\}/g, (match, name) => Object.hasOwn(values, name)
      ? (typeof values[name] === 'number' ? new Intl.NumberFormat(locale).format(values[name]) : String(values[name])) : match);
  };
})();
