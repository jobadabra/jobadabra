// The light triage read's verdict (#3519): can this application page be submitted automatically, from the page-kind answer and the page's control counts. Pure: no chrome, no AI, no I/O.
// Why (7 Nov 2026, owner: "we need just to understand if there is a captcha, or account needed… if it's a simple form and can be submitted automatically. For that it would be 5 seconds"):
// the AI's page-kind answer decides what the page IS; the control counts only AND with it (a "form" with nothing to fill is not one), they never turn a non-form into a form.
// Known limit: steps cannot be counted (the page-kind answer has no step field), so a form with a Next button reads "simple" until Apply reads its later steps.

/** The control count the floor reads: every kind of control the flow can fill. */
const controlsOf = counts => (Number(counts?.fields) || 0) + (Number(counts?.textareas) || 0) + (Number(counts?.files) || 0) + (Number(counts?.anyFiles) || 0) + (Number(counts?.passwords) || 0) + (Number(counts?.choices) || 0);

/**
 * -> {simple, why}. why is '' for a simple form, else one of 'captcha', 'login', 'account', 'no form', 'check' (a form with a visible frame among its fields: see below), 'posting' (a posting whose application is a form behind its Apply button:
 * the caller presses it once and asks again), 'frame' (a form drawn inside a frame this read does not enter), 'unknown' (no page-kind answer).
 * `kind` = the page-kind answer ({role, botCheck, accountStep}) or null; `counts` = pageShape's counts.
 */
export function verdictOf(kind, counts) {
  if (!kind || !kind.role) return {simple: false, why: 'unknown'};
  if (kind.botCheck === true) return {simple: false, why: 'captcha'};   // words-ok: the read's own flag name, not a page word list
  if (kind.role === 'account') return {simple: false, why: kind.accountStep === 'sign_in' ? 'login' : 'account'};   // words-ok: the answer's own step ids
  if (kind.role !== 'form') return kind.kind === 'posting' && !['email', 'other'].includes(kind.applyBy) ? {simple: false, why: 'posting'} : {simple: false, why: 'no form'};
  if (controlsOf(counts) === 0) return {simple: false, why: (Number(counts?.frames) || 0) > 0 ? 'frame' : 'no form'};
  if ((Number(counts?.passwords) || 0) > 0) return {simple: false, why: 'account'};   // a password box on an application page is an account to make or a login, whatever the answer said
  // Why (7 Nov 2026, review of #3519): the page-kind prompt tells the AI that a robot check among the form's own fields is NOT a bot check (it only answers true for a check that covers the page), so a form with a captcha beside its Submit
  // arrives as role form, botCheck false. The floor can only demote: a visible frame among the form's controls is "may need a check" (the shape the prompt's FORM_CHECK_RULE names), never a simple form.
  if ((Number(counts?.frames) || 0) > 0) return {simple: false, why: 'check'};
  return {simple: true, why: ''};
}
