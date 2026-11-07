// Public Focus/Jobs display recipes survive JSON/cache transport; original fields and control values stay canonical.
import {t} from './index.js';

const descriptor = value => ({value});

/** Capture one trusted authored field recipe without selecting a locale or rewriting raw interpolation values. */
export function copyMessage(key, fallback, variables = {}) {
  return {key, fallback, values: Object.fromEntries(Object.entries(variables).map(([name, value]) => [name, descriptor(value)]))};
}

/** Add deliberate UI presentation metadata to a derived result clone; never use this on diagnostic or stored records. */
export function copyFields(value, fields) {
  return {...value, displayCopy: {...value.displayCopy, ...fields}};
}

function resolve(spec, fallback) {
  if (!spec || typeof spec !== 'object') return fallback;
  if (Object.hasOwn(spec, 'value')) return spec.value;
  if (Array.isArray(spec.list)) return spec.list.map((part, index) => resolve(part, fallback?.[index]));
  if (Array.isArray(spec.join)) return spec.join.map(part => resolve(part, '')).join(String(spec.separator || ''));
  if (typeof spec.key !== 'string' || !spec.key.startsWith('focusCards.')) return fallback;
  const variables = Object.fromEntries(Object.entries(spec.values || {}).map(([name, value]) => [name, resolve(value, '')]));
  const translated = t(spec.key, variables);
  return translated === spec.key ? spec.fallback ?? fallback : translated;
}

/** Read one field's display copy at invocation time; callers keep using the original object for actions, IDs and persistence. */
export function copyField(value, field, fallback = value?.[field]) {
  return value?.displayCopy?.[field] ? resolve(value.displayCopy[field], fallback) : fallback;
}
