// Keep trusted UI descriptors private to one process so diagnostic objects and wire payloads remain unchanged.
import {t} from './index.js';

// Why (7 Nov 2026): diagnostic text and serialized replies must never acquire locale-specific or private descriptor fields.
const presentations = new WeakMap();

/** Attach trusted bundled message metadata privately to an existing object/Error; return the same identity without mutating it. */
export function withDisplay(value, key, variables = {}) {
  presentations.set(value, {key, variables});
  return value;
}

/** Resolve attached UI copy at invocation time; untagged objects or missing bundled keys keep the exact caller-supplied fallback. */
export function displayText(value, fallback) {
  const presentation = presentations.get(value);
  if (!presentation) return fallback;
  const text = t(presentation.key, presentation.variables);
  return text === presentation.key ? fallback : text;
}
