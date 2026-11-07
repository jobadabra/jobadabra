// Notion's own reason behind a plain "HTTP 400", said once for every place a person reads a run's warning: the Activity page (renderer/run-warnings.js) and Send feedback (lib/feedback-bundle.js).
// Pure, imports nothing: the bundle's filter of what may leave stays self-contained.

// Why (5 Nov 2026, #3059): it says what was refused, but it can quote what was sent, so only its known shapes are shown, the words
// before "instead was": they hold a column or a request path, ours, never a job's value. A list of what to refuse let an unquoted value through (review), as a prefix did in #3071.
const NOTION_SAID = /\bHTTP Error (\d{3}): (.+)$/;
const NAMES = [/^[\w .-]{1,40} is not a property that exists$/, /^[\w .-]{1,40} is expected to be [\w ]{1,30}$/];
const BODY = '(?:body failed validation: )?body\\.[\\w.[\\]]{1,80} should (?:not )?be';
// Why (7 Nov 2026, #3059 code review): what a value "should be" is the one open-ended slot. Strict (the bundle, which leaves the machine) takes a fixed vocabulary only (a type, defined, empty,
// a number bound); the Activity page, which never sends text anywhere, keeps the wider tail it always had (Gitar: the strict list had narrowed it by accident).
const STRICT_TAIL = new RegExp(`^${BODY} (?:(?:a|an) (?:string|number|array|object|boolean|date)|defined|empty|[≤≥<>=]{1,2} ?\\d{1,9})$`);
const OPEN_TAIL = new RegExp(`^${BODY}[\\w ≤≥<>=.-]{0,40}$`);

/** A status the person is told nothing more about: not a refused (401/403), busy (429) or unavailable (5xx) service, which keep their own sentence (run-warnings.js httpSentence) because it says what to do. */
export const isPlainStatus = code => { const status = Number(code); return status >= 400 && status < 500 && ![401, 403, 429].includes(status); };

/** `strict: false` is for text that stays on this computer. Notion's reason in a line holding "HTTP Error 400: <reason>", as "<reason> (HTTP 400)"; '' when the status says more, or the reason is not one of the known shapes. */
export function notionReason(text, {strict = true} = {}) {
  const [, code, said = ''] = NOTION_SAID.exec(text) || [];
  const reason = said.split(/,?\s+instead was\b/i)[0].replace(/`(\d+)`/g, '$1').replace(/[.\s]+$/, '');
  return code && isPlainStatus(code) && [...NAMES, strict ? STRICT_TAIL : OPEN_TAIL].some(shape => shape.test(reason)) ? `${reason} (HTTP ${code})` : '';
}
