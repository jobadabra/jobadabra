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

/** What is missing, in the person's words: a sign-in, an account, a check only they can do, then the saved details the form asks for. */
function missingOf(read) {
  const out = [];
  if (read.login === true) out.push(t('pagesReadinessTab.signIn'));
  else if (read.accountCreation === true) out.push(t('pagesReadinessTab.account'));
  if (read.captcha === true) out.push(t('pagesReadinessTab.personCheck'));
  for (const item of read.match?.missing || []) if (item?.name) out.push(String(item.name));
  return out;
}

/** The drawer's "Apply readiness" part: {checked, chip: {label, tone}, found (the chip's detail), missing [words], button ("Check apply readiness" or "Check again")}. */
export function readinessOf(read) {
  const {label, tone, detail} = chipOf(read);
  if (!read) return {checked: false, chip: {label, tone}, found: '', missing: [], button: t('pagesReadinessTab.check')};
  return {checked: true, chip: {label, tone}, found: detail, missing: missingOf(read), button: t('pagesReadinessTab.checkAgain')};
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
