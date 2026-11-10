// The result line of "Apply readiness on the top matches" (owner, 9 Nov 2026, asked via AskUserQuestion: "Rename + result line (Recommended)"): "3 jobs checked: 2 simple, 1 needs you", in the person's language.
// The states are the ones the app already shows on a checked job (Simple form / Needs you / Couldn't read, lib apply-triage-mode.js): a form that needs the person (a captcha, a login, a question only they can answer)
// is "needs you", a form that could not be read is "couldn't be read", a job the read found not eligible is checked but in neither. Pure. Guard: test/unit/main/top-matches-line.test.js.
import {completionText} from '../i18n/completion-notices.js';
import {getLocale} from '../i18n/index.js';
import {modeOfRead} from '../renderer/apply-triage-mode.js';

/** The count of each state over the step's results ({check} is the read, null when nothing was read). -> {checked, simple, needs, unread}. */
export function classify(results) {
  const done = results.filter(result => result.kit?.refused !== true && result.cancelled !== true);   // a gate that started nothing (no Notion, no allowance, no AI) or a Stop is not a job that was checked
  const counts = {checked: done.length, simple: 0, needs: 0, unread: 0};
  for (const {check} of done) {
    if (!check || check.unreadable === true) { counts.unread += 1; continue; }
    const {mode} = modeOfRead(check);
    if (mode === 'none') continue;
    if (mode === 'auto' || (mode === 'fill' && check.simple === true)) counts.simple += 1; else counts.needs += 1;   // Needs you: the person must act (a captcha, a login, a question only they can answer); a simple form, even one that lacks a saved detail, is simple
  }
  return counts;
}

/** "3 jobs checked: 2 simple, 1 needs you"; a state with no job is left out. */
export function resultLine(counts, locale = getLocale()) {
  const words = (key, count) => completionText(locale, key, {count});
  const parts = [['readinessSimple', counts.simple], ['readinessNeeds', counts.needs], ['readinessUnread', counts.unread]].filter(([, count]) => count > 0).map(([key, count]) => words(key, count));
  const checked = words('readinessChecked', counts.checked);
  return parts.length ? completionText(locale, 'readinessLine', {checked, parts: parts.join(', ')}) : checked;
}
