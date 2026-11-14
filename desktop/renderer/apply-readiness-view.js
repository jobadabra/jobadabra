// A job's apply readiness as the ⋯ menu and the drawer draw it, from the job's ONE stored check (pages/jobs-triage.js readOf; lib/apply-readiness.js keeps it per posting). Pure: the menu item, what
// the check found and what is missing, and the saved sign-in that matches the job (never a password).
// Why (13 Nov 2026, owner, screenshots 888-889 via the coordinator): "let's add a new action on the job to fulffull the apply readiness" ("One action, changes with state") and, on the drawer's
// Application tab, "a tab with Apply readiness and with Account/Credentials"; one model so the menu and both parts read the same check.
// Guard: test/unit/renderer/apply-readiness-view.test.js.
import '../i18n/screens-pages.js';
import {t} from '../i18n/index.js';
import {chipOf} from './apply-triage-pick.js';
import {accountNeed, modeOfRead} from './apply-triage-mode.js';

const hostOf = url => { try { return new URL(String(url)).hostname.toLowerCase(); } catch { return ''; } };
const lower = text => String(text || '').trim().toLowerCase();

/** Whether the check left something the person can do: a sign-in, an account, a check only they can pass, or saved details the form asks for. */
function fixable(read) {
  const {mode, reason} = modeOfRead(read);
  return mode === 'check' || (mode === 'fill' && reason === 'needs your details');
}

/** The ⋯ menu's one readiness item: "Check apply readiness" before a check, "Fix what's missing" while it needs the person, else "Check again". -> {action: 'check' | 'fix', label}. */
export function menuItemOf(read) {
  if (!read) return {action: 'check', label: t('pagesReadinessTab.check')};
  return fixable(read) ? {action: 'fix', label: t('pagesReadinessTab.fix')} : {action: 'check', label: t('pagesReadinessTab.checkAgain')};
}

/**
 * What is missing, in the person's words, each with its kind ('sign-in' | 'account' | 'check' | 'detail' | 'answer') and the one button it gets (`action`): a sign-in, an account or a check only
 * the person can pass is done on the posting ({type: 'site'}); a saved detail or a question in their own words is answered in the queue ({type: 'queue', queue: 'details' | 'learned', label}).
 * Why (14 Nov 2026, #4325, owner: "The apply readiness should give some call to actions, to make it ready"): every to-do says what to press.
 */
function todoOf(read) {
  const out = [], site = {type: 'site'};
  if (read.login === true) out.push({kind: 'sign-in', words: t('pagesReadinessTab.signIn'), action: site});
  else if (read.accountCreation === true) out.push({kind: 'account', words: t('pagesReadinessTab.account'), action: site});
  if (read.captcha === true) out.push({kind: 'check', words: t('pagesReadinessTab.personCheck'), action: site});
  for (const item of read.match?.missing || []) {   // Why (14 Nov 2026, #4325): the match's items are {kind, label} (lib/triage-match.js missingOf), so the label is read, never `name`
    if (!item?.label) continue;
    const answer = item.kind === 'answer';
    out.push({kind: answer ? 'answer' : 'detail', words: String(item.label), action: {type: 'queue', queue: answer ? 'learned' : 'details', label: String(item.label)}});
  }
  return out;
}

/** The to-dos the queue can close: {count, groups: [{queue: 'details' | 'learned', labels}]}, Your details first, then the questions (the queue opens one after the other). Null when none. */
export function fixAllOf(todo) {
  const queued = (todo || []).filter(item => item.action?.type === 'queue');
  const groups = ['details', 'learned'].map(queue => ({queue, labels: queued.filter(item => item.action.queue === queue).map(item => item.action.label)})).filter(group => group.labels.length);
  return queued.length ? {count: queued.length, groups} : null;
}

/**
 * The form's required questions as counts: {questions, answered, unjudged}, each null when the check did not read or match them (never a guess).
 * Invariant: answered = questions − missing details − unjudged, so the three never add up to more than the form asked.
 */
function countsOf(read) {
  const questions = Array.isArray(read.questions) ? read.questions.length : null;
  if (questions === null || !read.match) return {questions, answered: null, unjudged: null};
  const unjudged = Number(read.match.unjudged) || 0;
  return {questions, answered: Math.max(0, questions - (read.match.missing || []).length - unjudged), unjudged};
}

/**
 * The drawer's "Apply readiness" part: {checked, chip: {label, tone}, found (the chip's detail), todo [{kind, words}], missing [words], counts {questions, answered, unjudged}, ready (it can be filled as it is), blocked (a sign-in,
 * an account or a person's check: the posting is where the person does it), button ("Check apply readiness" or "Check again")}.
 */
export function readinessOf(read) {
  const {label, tone, detail} = chipOf(read);
  if (!read) return {checked: false, chip: {label, tone}, found: '', todo: [], missing: [], counts: {questions: null, answered: null, unjudged: null}, blocked: false, button: t('pagesReadinessTab.check')};
  const todo = todoOf(read);
  const counts = countsOf(read);
  // Why (14 Nov 2026, Gitar on #4379): "it can be filled" only when the check read and matched every question and found it good; an unreadable, unmatched or not-simple form says its own words.
  const ready = !todo.length && tone === 'good' && counts.answered !== null;
  return {checked: true, chip: {label, tone}, found: detail, todo, missing: todo.map(item => item.words), counts, ready, blocked: todo.some(item => item.action.type === 'site'),
    button: t('pagesReadinessTab.checkAgain')};
}

/**
 * The drawer's "Account / Credentials" part: what the site asks ('sign-in' | 'create' | 'none', or 'unknown' before a check) and the saved sign-in of Settings → Credentials that matches the job
 * (`rows` from the credentials channel: {host, email, job, state, companies}), by the job's own link, then the link's host, then the company. -> {need, saved: {host, email, state} | null}.
 * Invariant: only host, e-mail and state leave this function; a password never does.
 */
export function accountOf(job, read, rows = []) {
  const need = !read ? 'unknown' : accountNeed(read)?.why || 'none';
  const list = (rows || []).filter(row => row && !row.unassigned);
  const host = hostOf(job?.url), company = lower(job?.company);
  const row = list.find(item => item.job && item.job === job?.url) || list.find(item => host && lower(item.host) === host)
    || list.find(item => company && (item.companies || []).some(name => lower(name) === company)) || null;
  return {need, saved: row ? {host: String(row.host), email: String(row.email || ''), state: String(row.state || '')} : null};
}
