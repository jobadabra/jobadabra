// Apply triage: turns one form read into the highest apply mode that job can take. Pure, no AI, no I/O.

/**
 * The highest apply mode a read form allows, with the reason the chip shows.
 * Order: not eligible is skipped; a captcha, a login wall or an account to create needs the person (Standard); then the read's own verdict:
 * the light look says `simple` (a simple form is Full automation, any other named reason needs the person: the form's shape decides, no answer plan was made, owner 7 Nov 2026);
 * a judge-based read (the demo, an older extension) says allFactsSaved: answers that are not all saved facts go to fill (the person reviews and submits), otherwise Full automation can take it.
 * `read` = {eligible, captcha, login, accountCreation, allFactsSaved, simple?, why?}; a missing flag counts as the unsafe answer.
 * @returns {{mode: 'auto'|'fill'|'check'|'none', reason: string}}
 */
export function modeOfRead(read) {
  read = read || {};   // a failed read (null) is a missing read, so it takes the unsafe answer too
  if (read.unreadable === true) return {mode: 'none', reason: 'unreadable'};   // a read that could not be made is never a mode a batch can take
  if (read.eligible !== true) return {mode: 'none', reason: 'not eligible'};
  if (read.captcha !== false) return {mode: 'check', reason: read.why === 'check' ? 'check' : 'captcha'}; // words-ok: the read's own flag, not a page word list
  if (read.login !== false) return {mode: 'check', reason: 'login wall'}; // words-ok: the read's own flag, not a page word list
  if (read.accountCreation !== false) return {mode: 'check', reason: 'asks you to create an account'};
  // Why (7 Nov 2026, owner, #3519: "to understand if it's a simple form and can be submitted automatically"): the light read has no answer plan, so its own verdict decides here: anything but a simple form needs the person; a simple form is auto only when the check's one match judged every required question (L2b, owner 7 Nov 2026), else fill (details missing, answers not checked).
  // L2b (owner 7 Nov 2026: "Simple form, but can or not be applied automatically"): the check's one match of the form's required questions says what saved details it lacks; no match (AI off, no questions) leaves it as it was.
  if (read.simple === true) {
    if (read.match?.missing?.length) return {mode: 'fill', reason: 'needs your details'};
    if (read.match?.unnamed > 0) return {mode: 'fill', reason: 'a box without a question'};   // a required box the page left unnamed cannot be judged, now or on a re-check
    // Not judged = not read on a guess (review of L2b): a form with required questions that were not all judged (the AI was off or busy, the match never ran, the page refused the label read) is not "can apply automatically".
    const asked = read.questions === null || read.questions?.length > 0;
    if (asked && read.match?.unjudged !== 0) return {mode: 'fill', reason: 'answers not checked'};
    return {mode: 'auto', reason: 'a simple form'};
  }
  if (read.simple === false) return {mode: 'check', reason: read.why || 'not a simple form'};
  if (read.allFactsSaved !== true) return {mode: 'fill', reason: 'answers you have not saved'};
  return {mode: 'auto', reason: 'every answer is a saved fact'};
}

/**
 * What account a job's application asks for, from the same read (owner, 13 Nov 2026: "mark the jobs that requires an account"), drawn as "Account needed" (renderer/account-chip.js).
 * Only an explicit `true` counts: an unknown flag (null, not checked yet) shows nothing, since not judged = not read on a guess (the mode table above reads unknown as unsafe; a chip must not). Pure.
 * @returns {{kind: 'site', why: 'sign-in'|'create'} | null}
 */
export function accountNeed(read) {
  if (!read || read.unreadable === true) return null;
  if (read.login === true) return {kind: 'site', why: 'sign-in'}; // words-ok: the read's own flag, not a page word list
  if (read.accountCreation === true) return {kind: 'site', why: 'create'};
  return null;
}
