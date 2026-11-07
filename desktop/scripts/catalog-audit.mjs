// Audit every bundled desktop catalog for key, placeholder, plural and copied-English parity.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../i18n/catalogs/', import.meta.url));
const locales = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];
const {locales: sharedSpellings} = JSON.parse(await fs.readFile(new URL('./catalog-shared-spellings.json', import.meta.url), 'utf8'));
const groups = new Map();
const findings = [];
const add = (group, locale, messages, file) => {
  if (!groups.has(group)) groups.set(group, {});
  groups.get(group)[locale] = {messages, file};
};
for (const file of (await fs.readdir(root, {recursive: true})).filter(file => file.endsWith('.js')).sort()) {
  const module = await import(new URL(file, new URL('../i18n/catalogs/', import.meta.url)));
  const data = module.default || module.messages || module.common || module.rows;
  if (!data) throw new Error(`Unrecognized catalog: ${file}`);
  const basename = path.basename(file);
  const split = basename.match(/^(en|de|fr|it|es|ro|ru)(-.*)?\.js$/)
    || basename.match(/^(.*)-(en|de|fr|it|es|ro|ru)\.js$/)?.map((value, index, parts) => index === 1 ? parts[2] : index === 2 ? parts[1] : value);
  if (split) add(`${path.dirname(file)}/${split[2] || 'main'}`, split[1], data, file);
  else if (data.en) for (const locale of locales) add(file, locale, data[locale] || {}, file);
  else {
    const rows = data.messages || data;
    for (const [column, locale] of locales.entries()) {
      add(file, locale, Object.fromEntries(Object.entries(rows).map(([key, values]) => {
        if (!Array.isArray(values)) throw new Error(`Unrecognized row: ${file}/${key}`);
        return [key, values[column]];
      })), file);
    }
  }
}
const forms = value => typeof value === 'string' ? {other: value} : value || {};
const params = value => [...new Set([...value.matchAll(/\{([a-zA-Z]\w*)\}/g)].map(match => match[1]))].sort().join(',');
const rows = [];
for (const locale of locales) {
  const row = {locale, groups: groups.size, keys: 0, keyGaps: 0, inherited: 0, parameters: 0, plurals: 0, identical: 0, copiedEnglish: 0};
  for (const [group, catalogs] of groups) {
    if (!catalogs.en) throw new Error(`Catalog group without English: ${group}`);
    const english = catalogs.en.messages;
    const {messages, file} = catalogs[locale] || {messages: {}, file: group};
    const keys = new Set([...Object.keys(english), ...Object.keys(messages)]);
    const issue = (kind, key, detail) => { row[kind]++; findings.push({locale, group, file, kind, key, detail}); };
    row.keys += Object.keys(messages).length;
    for (const key of keys) {
      const value = messages[key], source = english[key];
      if (value === undefined || source === undefined) { issue('keyGaps', key, value === undefined ? 'missing' : 'extra'); continue; }
      if (value === null) { row.inherited++; continue; }
      // Null source columns explicitly inherit canonical diagnostic/platform text. Compare the translated columns to each other.
      const reference = source === null ? Object.values(catalogs).map(catalog => catalog.messages[key]).find(item => typeof item === 'string') : source;
      const sourceForms = forms(reference), actual = forms(value);
      for (const [category, text] of Object.entries(actual)) {
        if (typeof text !== 'string' || !text.trim()) { issue('parameters', key, `empty/invalid ${category}`); continue; }
      }
      // Singular forms may spell out “one”; compare the message's complete parameter contract.
      if (params(Object.values(actual).join('\n')) !== params(Object.values(sourceForms).join('\n'))) issue('parameters', key, 'message parameters');
      // A locale may use invariant wording instead of a plural map (for example “Matches: {count}”).
      if (typeof value === 'object') {
        for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) {
          if (!Object.hasOwn(actual, category)) issue('plurals', key, `missing ${category}`);
        }
      }
      if (locale !== 'en' && JSON.stringify(value) === JSON.stringify(source)) {
        row.identical++;
        const reviewed = sharedSpellings[locale]?.[`${group}/${key}`] === value;
        findings.push({locale, group, file, kind: 'identical', key, detail: value, reviewed});
        if (!reviewed) issue('copiedEnglish', key, value);
      }
    }
  }
  rows.push(row);
}
console.table(rows);
console.log('Identical values require an exact reviewed key/value in catalog-shared-spellings.json; unreviewed English copies fail.');
console.log(`${groups.size} catalog groups; ${rows[0].keys} English keys. No fallback masks missing forms.`);
const output = process.argv[2];
if (output) await fs.writeFile(output, JSON.stringify({rows, findings}, null, 2));
if (rows.some(row => row.keyGaps || row.parameters || row.plurals || row.copiedEnglish)) process.exitCode = 1;
