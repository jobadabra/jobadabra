// Notion's own reason behind a plain "HTTP 400", said once for every place a person reads a run's warning: the Activity page (renderer/run-warnings.js) and Send feedback (lib/feedback-bundle.js).
// Pure, imports nothing: the bundle's filter of what may leave stays self-contained.

// Why (5 Nov 2026, #3059): it says what was refused, but it can quote what was sent, so only its known shapes are shown, the words
// before "instead was": they hold a column or a request path, ours, never a job's value. The one open-ended slot, what a value "should be", is a fixed vocabulary (a type, defined, empty, a number bound):
// the bundle sends this text off the machine (code review of #3059: 40 free characters there could carry a value). A list of what to refuse let an unquoted value through (review), as a prefix did in #3071.
const NOTION_SAID = /\bHTTP Error (\d{3}): (.+)$/;
const NOTION_SHAPES = [/^[\w .-]{1,40} is not a property that exists$/, /^[\w .-]{1,40} is expected to be [\w ]{1,30}$/,
  /^(?:body failed validation: )?body\.[\w.[\]]{1,80} should (?:not )?be (?:(?:a|an) (?:string|number|array|object|boolean|date)|defined|empty|[≤≥<>=]{1,2} ?\d{1,9})$/];

/** A status the person is told nothing more about: not a refused (401/403), busy (429) or unavailable (5xx) service, which keep their own sentence (run-warnings.js httpSentence) because it says what to do. */
export const isPlainStatus = code => { const status = Number(code); return status >= 400 && status < 500 && ![401, 403, 429].includes(status); };

/** Notion's reason in a line holding "HTTP Error 400: <reason>", as "<reason> (HTTP 400)"; '' when the status says more, or the reason is not one of the known shapes. */
export function notionReason(text) {
  const [, code, said = ''] = NOTION_SAID.exec(text) || [];
  const reason = said.split(/,?\s+instead was\b/i)[0].replace(/`(\d+)`/g, '$1').replace(/[.\s]+$/, '');
  return code && isPlainStatus(code) && NOTION_SHAPES.some(shape => shape.test(reason)) ? `${reason} (HTTP ${code})` : '';
}
