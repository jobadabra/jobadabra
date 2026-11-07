// Shared timestamp, version and clipboard labels in the seven desktop display languages.
const keys = ['justNow', 'minutesAgo', 'hoursAgo', 'daysAgo', 'weeksAgo', 'today', 'version', 'copied'];
const rows = {
  en: ['just now', '{count} min ago', '{count} h ago', '{count}d ago', '{count}w ago', 'Today {time}', 'Version {version}', 'Copied ✓'],
  de: ['gerade eben', 'vor {count} Min.', 'vor {count} Std.', 'vor {count} T.', 'vor {count} Wo.', 'Heute {time}', 'Version {version}', 'Kopiert ✓'],
  fr: ['à l’instant', 'il y a {count} min', 'il y a {count} h', 'il y a {count} j', 'il y a {count} sem.', 'Aujourd’hui {time}', 'Version {version}', 'Copié ✓'],
  it: ['adesso', '{count} min fa', '{count} h fa', '{count} g fa', '{count} sett. fa', 'Oggi {time}', 'Versione {version}', 'Copiato ✓'],
  es: ['ahora mismo', 'hace {count} min', 'hace {count} h', 'hace {count} d', 'hace {count} sem.', 'Hoy {time}', 'Versión {version}', 'Copiado ✓'],
  ro: ['chiar acum', 'acum {count} min', 'acum {count} h', 'acum {count} z', 'acum {count} săpt.', 'Astăzi {time}', 'Versiunea {version}', 'Copiat ✓'],
  ru: ['только что', '{count} мин назад', '{count} ч назад', '{count} дн назад', '{count} нед назад', 'Сегодня {time}', 'Версия {version}', 'Скопировано ✓'],
};
export default Object.fromEntries(Object.entries(rows).map(([locale, values]) => [locale, Object.fromEntries(keys.map((key, index) => [key, values[index]]))]));
