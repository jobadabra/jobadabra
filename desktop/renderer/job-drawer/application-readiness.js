// Application → Apply readiness and Account / Credentials: the job's ONE stored check (pages/jobs-triage.js readOf, the same one the list's chip and the ⋯ menu read), what it found
// and what is missing, with Check / Check again; and whether the site asks for a sign-in or an account, with the saved sign-in of Settings → Credentials that matches it (host and e-mail only).
// Why: renderer/apply-readiness-view.js (the owner's request, once). Invariant: no password ever reaches this view; the model (apply-readiness-view.js accountOf) passes host, e-mail and state only.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {el} from '../components.js';
import {button, card, group, iconRow, skeleton, stateCard} from './parts.js';
import {accountOf, readinessOf} from '../apply-readiness-view.js';
import {checkJob, readOf} from '../pages/jobs-triage.js';
import {drawerActions} from './drawer-actions.js';

const TONE = {good: 'good', warn: 'warn', bad: 'bad'};   // the chip's tone on a state card; anything else reads as info
let saved = null;   // Settings → Credentials rows; 'loading' while asked; 'unread' when the read failed (never shown as "none saved"); read once per drawer open (forgetCredentials)
let running = '';   // the job url whose check runs from the drawer

/** Forgets the Credentials rows, so the next Account view reads them again (the drawer calls it on open). */
export const forgetCredentials = () => { saved = null; };

const checkButton = (ctx, redraw, label) => {
  const node = button(label, async () => {
    running = ctx.job.url; redraw();
    try { await checkJob(ctx.job); } finally { running = ''; redraw(); }
  }, 'primary');
  node.disabled = running === ctx.job.url;
  return node;
};

/** The Apply readiness part: "Not checked yet" with Check apply readiness, or what the check found, what is missing, and Check again. */
export function readinessView(ctx, redraw) {
  const view = readinessOf(readOf(ctx.job.url));
  if (!view.checked) return [stateCard({icon: 'search', title: t('pagesReadinessTab.notCheckedTitle'), text: t('pagesReadinessTab.notCheckedText'), actions: [checkButton(ctx, redraw, view.button)]})];
  const head = stateCard({icon: view.missing.length ? 'alert' : 'check-circle', tone: TONE[view.chip.tone] || 'info', title: view.chip.label, text: view.found, actions: [checkButton(ctx, redraw, view.button)]});
  const missing = view.missing.length ? view.missing : [t('pagesReadinessTab.nothingMissing')];
  return [head, group(t('pagesReadinessTab.missing'), missing)];
}

const NEED = {'sign-in': ['shield', 'pagesReadinessTab.needSignIn'], create: ['user', 'pagesReadinessTab.needCreate'], none: ['check-circle', 'pagesReadinessTab.needNone'], unknown: ['info', 'pagesReadinessTab.needUnknown']};

/** The Account / Credentials part: what the site asks, the saved sign-in that matches the job (host, e-mail), and the way to Settings → Credentials; never a password. */
export function accountView(ctx, redraw) {
  if (saved === null) {
    saved = 'loading';
    const failed = why => { window.pilot?.uiLog?.('drawer: the saved sign-ins could not be read', String(why).slice(0, 200)); return 'unread'; };
    Promise.resolve().then(() => window.pilot.credentials()).then(answer => (answer?.ok ? answer.rows || [] : failed(answer?.error || 'no answer')), error => failed(error?.message || error))
      .then(rows => { saved = rows; redraw(); });
  }
  if (saved === 'loading') return skeleton();
  const {need, saved: row} = accountOf(ctx.job, readOf(ctx.job.url), Array.isArray(saved) ? saved : []);
  const [name, key] = NEED[need];
  const lines = [iconRow(name, t(key))];
  if (row) lines.push(iconRow('key', t('pagesReadinessTab.saved', {host: row.host})), ...(row.email ? [iconRow('mail', t('pagesReadinessTab.usesEmail', {email: row.email}))] : []));
  else lines.push(iconRow(saved === 'unread' ? 'alert' : 'key', t(saved === 'unread' ? 'pagesReadinessTab.unread' : 'pagesReadinessTab.noSaved')));
  const open = button(t('pagesReadinessTab.openCredentials'), () => { ctx.close?.(); drawerActions.openCredentials(); });
  return [card(t('pagesReadinessTab.tabAccount'), ...lines, el('p', 'muted small', t('pagesReadinessTab.passwordNote')), open)];
}
