// Application → Apply readiness and Account / Credentials: the job's ONE stored check (pages/jobs-triage.js readOf, the same one the list's chip and the ⋯ menu read), what it found
// and what is missing, with Check / Check again; and whether the site asks for a sign-in or an account, with the saved sign-in of Settings → Credentials that matches it (host and e-mail only).
// Why: renderer/apply-readiness-view.js (the owner's request, once). Invariant: no password ever reaches this view; the model (apply-readiness-view.js accountOf) passes host, e-mail and state only.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {el, pill} from '../components.js';
import {button, card, factStrip, foldCard, iconRow, skeleton, stateCard} from './parts.js';
import {accountOf, fixAllOf, readinessOf} from '../apply-readiness-view.js';
import {checkJob, readOf} from '../pages/jobs-triage.js';
import {stepsOf} from '../readiness-steps.js';
import {drawerActions} from './drawer-actions.js';

const TONE = {good: 'good', warn: 'warn', bad: 'bad'};   // the chip's tone on a state card; anything else reads as info
let saved = null;   // Settings → Credentials rows; 'loading' while asked; 'unread' when the read failed (never shown as "none saved"); read once per drawer open (forgetCredentials)
let reading = 0;   // which read is current: a drawer reopened mid-read starts a new one, and the older answer is dropped (Gitar on #4018)
let running = '';   // the job url whose check runs from the drawer

/** Forgets the Credentials rows, so the next Account view reads them again (the drawer calls it on open). */
export const forgetCredentials = () => { saved = null; reading += 1; };

const checkButton = (ctx, redraw, label, secondary = false) => {   // secondary: "Fix all" is the primary press, Check again steps back
  const node = button(label, async () => {
    running = ctx.job.url; redraw();
    try { await checkJob(ctx.job); } finally { running = ''; redraw(); }
  }, secondary ? 'secondary' : 'primary');
  node.disabled = running === ctx.job.url;
  return node;
};

const TODO_ICON = {'sign-in': 'key', account: 'user', check: 'shield', detail: 'edit', answer: 'edit'};   // what each kind of to-do asks of the person

/** One "What's missing" row with the one button it gets: the site for a sign-in, an account or a check only the person passes; the queue for a saved detail ("Add it") or a question ("Answer it"). */
function todoRow(ctx, item) {
  const row = iconRow(TODO_ICON[item.kind] || 'edit', item.words);
  const {action} = item;
  row.classList.add('has-action');
  if (action.type === 'site') row.append(button(t('pagesReadinessTab.openSite'), () => window.pilot.openExternal(ctx.job.url)));   // the app never types a password or solves a check
  else row.append(button(t(item.kind === 'answer' ? 'pagesReadinessTab.answerIt' : 'pagesReadinessTab.addIt'), () => drawerActions.openQueue(ctx.job, {queue: action.queue, labels: [action.label]})));
  return row;
}

/** The check log, folded: each finished step with its seconds and a bar of its share of the slowest step (stepsOf: this window's last check of the job). */
function checkLog(url) {
  const steps = stepsOf(url);
  if (!steps.length) return null;
  const total = steps.reduce((sum, step) => sum + step.seconds, 0), longest = Math.max(1, ...steps.map(step => step.seconds));
  const rows = steps.map(({words, seconds}) => {
    const row = el('div', 'jd-readiness-step');
    const bar = el('span', 'jd-readiness-bar');
    bar.style.setProperty('--share', `${Math.round((seconds / longest) * 100)}%`);
    row.append(el('span', '', words), bar, el('span', 'muted small', t('helperTail.triageStepSeconds', {count: seconds})));
    return row;
  });
  return {total, node: foldCard({iconName: 'clock', title: t('pagesReadinessTab.checkLog'), when: t('helperTail.triageStepSeconds', {count: total})}, ...rows)};
}

/**
 * The Apply readiness part: "Not checked yet" with Check apply readiness; else one summary card (the outcome, the form's required questions as counts, how long the check took, Check again;
 * the drawer's footer already opens the posting), what needs the person (one row each), and the check log folded.
 * Why (14 Nov 2026, #4325, owner: "it's too basic. too broken" · "this should be a collapsed log" · "On the main content, we should show more details. How many fields... how much it took").
 */
export function readinessView(ctx, redraw) {
  const view = readinessOf(readOf(ctx.job.url));
  if (!view.checked) return [stateCard({icon: 'search', title: t('pagesReadinessTab.notCheckedTitle'), text: t('pagesReadinessTab.notCheckedText'), actions: [checkButton(ctx, redraw, view.button)]})];
  const log = checkLog(ctx.job.url);
  const head = el('div', 'jd-readiness-head');
  head.append(pill(view.chip.label, TONE[view.chip.tone] || 'info', {dot: true}), el('b', '', view.todo.length ? t('pagesReadinessTab.toDoLine', {count: view.todo.length}) : view.ready ? t('pagesReadinessTab.readyLine') : view.found || view.chip.label));
  const {questions, answered} = view.counts;
  const unread = t('pagesReadinessTab.notRead');
  const cells = [
    {icon: 'file-text', label: t('pagesReadinessTab.questions'), value: questions === null ? unread : String(questions)},
    {icon: 'check-circle', label: t('pagesReadinessTab.answered'), value: answered === null ? unread : String(answered)},
    {icon: 'alert', label: t('pagesReadinessTab.toDo'), value: String(view.todo.length)},
    ...(log ? [{icon: 'clock', label: t('pagesReadinessTab.took'), value: t('helperTail.triageStepSeconds', {count: log.total})}] : []),
  ];
  const actions = el('div', 'jd-actions');
  const fixAll = fixAllOf(view.todo);
  if (fixAll) actions.append(button(t('pagesReadinessTab.fixAll', {count: fixAll.count}), () => drawerActions.openQueue(ctx.job, fixAll.first), 'primary'));
  actions.append(checkButton(ctx, redraw, view.button, Boolean(fixAll)));
  const summary = el('section', 'jd-card jd-readiness');
  summary.append(head, factStrip(cells), ...(log ? [] : [el('p', 'muted small', t('pagesReadinessTab.noLog'))]), actions);   // a check from the store, or one before a restart, has no step times: say so (Gitar on #4379)
  const todo = view.todo.length ? card(t('pagesReadinessTab.missing'), ...view.todo.map(item => todoRow(ctx, item))) : null;
  return [summary, todo, log?.node].filter(Boolean);
}

const NEED = {'sign-in': ['shield', 'pagesReadinessTab.needSignIn'], create: ['user', 'pagesReadinessTab.needCreate'], none: ['check-circle', 'pagesReadinessTab.needNone'], unknown: ['info', 'pagesReadinessTab.needUnknown']};

/** The Account / Credentials part: what the site asks, the saved sign-in that matches the job (host, e-mail), and the way to Settings → Credentials; never a password. */
export function accountView(ctx, redraw) {
  if (saved === null) {
    saved = 'loading';
    const mine = ++reading;
    const failed = why => { window.pilot?.uiLog?.('drawer: the saved sign-ins could not be read', String(why).slice(0, 200)); return 'unread'; };
    Promise.resolve().then(() => window.pilot.credentials()).then(answer => (answer?.ok ? answer.rows || [] : failed(answer?.error || 'no answer')), error => failed(error?.message || error))
      .then(rows => { if (mine !== reading) return; saved = rows; redraw(); });
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
