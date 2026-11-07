// Apply triage read (spec 2026-10-30-apply-triage, PR C): turns the form judge's answer into the flags the mode table reads (renderer/apply-triage-mode.js).
// The judge gives a robot check (captcha), a login wall and an account to create (prompt change in lib/form-judge.js). "Every answer is a saved fact" is not a page
// judgment (the page sketch holds no saved facts): the caller passes it from the fill plan. A flag nobody gave stays unknown (null), which the mode table reads as the unsafe answer. Pure: no AI, no I/O.

/**
 * The read flags from one judge answer: {eligible, captcha, login, accountCreation, allFactsSaved}. Unknown flags are null, never false.
 * `judged` is judgeForm's result ({answer, botCheck, loginWall, accountCreation, ...} or {error}); a failed judge is a read with no page flags.
 * `allFactsSaved` comes from the fill plan (true / false / unknown), not from the judge.
 */
export function readFromJudge(judged, {eligible = true, allFactsSaved = null} = {}) {
  const facts = typeof allFactsSaved === 'boolean' ? allFactsSaved : null;
  if (!judged || judged.error) return {eligible, captcha: null, login: null, accountCreation: null, allFactsSaved: facts};   // words-ok: the read's own flag names, not a page word list
  return {
    eligible,
    captcha: typeof judged.botCheck === 'boolean' ? judged.botCheck : null,   // words-ok: the read's own flag names, not a page word list
    login: typeof judged.loginWall === 'boolean' ? judged.loginWall : null,   // words-ok: the read's own flag names, not a page word list
    accountCreation: typeof judged.accountCreation === 'boolean' ? judged.accountCreation : null,
    allFactsSaved: facts,
  };
}

/**
 * The read flags from the light triage read's report ({simple, why}, extension/triage-look.js): the mode table's flags plus `simple` and `why`.
 * Only the one named reason is true; the others are false, so a page needs exactly one thing from the person. No answer plan was made: allFactsSaved stays unknown.
 * A report without a boolean `simple` is a read with no flags (unknown, the unsafe answer).
 */
export function readFromLook(report, {eligible = true} = {}) {
  if (!report || typeof report.simple !== 'boolean') return {eligible, captcha: null, login: null, accountCreation: null, allFactsSaved: null};   // words-ok: the read's own flag names, not a page word list
  const why = typeof report.why === 'string' ? report.why : '';
  const read = {eligible, captcha: why === 'captcha' || why === 'check', login: why === 'login', accountCreation: why === 'account', allFactsSaved: null, simple: report.simple, why};   // words-ok: the read's own flag names, not a page word list
  if (report.simple === true && 'questions' in report) read.questions = Array.isArray(report.questions) ? report.questions.filter(label => typeof label === 'string' && label.trim()).map(label => label.trim().slice(0, 120)).slice(0, 30) : null;   // null: the page refused the question read   // L2b: the required questions, for the one match
  return read;
}
