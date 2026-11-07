// Private presentation provenance for wizard progress/rebuild values; canonical objects and JSON never acquire UI metadata.
const recipes = new WeakMap();

/** Remember explicit authored field projections on the same canonical object, without adding fields or changing its identity. */
export function rememberDisplay(value, fields) {
  recipes.set(value, {...recipes.get(value), ...fields});
  return value;
}

/** Project a derived window-only clone at invocation time; unknown/raw values and every canonical source remain unchanged. */
export function forWindow(value) {
  if (!value || typeof value !== 'object') return value;
  const fields = recipes.get(value) || {};
  if (Array.isArray(value)) return value.map((part, index) => fields[index] ? fields[index]() : forWindow(part));
  return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, fields[key] ? fields[key]() : forWindow(part)]));
}

/** Append one canonical progress note and capture its authored display projection privately at that exact producer branch. */
export function displayNote(notes, canonical, project) {
  const index = notes.length;
  notes.push(canonical);
  rememberDisplay(notes, {[index]: project});
}

/** Concatenate canonical note arrays while retaining only their explicitly captured per-index presentation recipes. */
export function concatDisplay(...lists) {
  const result = [], fields = {};
  for (const list of lists) {
    const offset = result.length;
    result.push(...list);
    for (const [index, project] of Object.entries(recipes.get(list) || {})) fields[offset + Number(index)] = project;
  }
  return rememberDisplay(result, fields);
}
