// The Apply to jobs dialog's check of a Full automation batch ([fa] 2/2, spec docs/superpowers/specs/2026-11-07-full-automation-check-first.md): each form checked live, then the split the person confirms.
// The app holds the batch and keeps the reads (lib/apply-check-first.js); this panel shows them and sends the person's one answer. Pure parts: checkView in renderer/apply-dialog-model.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {chip, el} from '../components.js';
import {$} from './core.js';
import {checkView} from '../apply-dialog-model.js';

// Design (fa, owner 7 Nov 2026: "letting the user see live updates/results and letting him confirm one more time"): ONE owner of what the panel shows, `state`, ONE painter, `paint()`.
//   checking -> each job without a check prepared with its kit is read in the app's hidden browser, one at a time: "Checking i of n · company", its seconds, every job's row with its chip as it lands.
//   matching -> every read is in: the app matches the simple forms' questions with Your details (one call); the bar slides.
//   split    -> the split bar and its groups (Full automation, Background · you submit, In Chrome · you submit, Not applied); Cancel, and "Apply to N jobs" when one can start.
//   sending  -> Confirm pressed: both buttons are off until the app answers.
//   ''       -> no batch held: the panel is hidden and the dialog's own form shows.
// Cancel, Esc or closing the dialog in any state but sending ends the batch with nothing queued (owner's choice on the fa sketch: "End the batch, nothing queued").
const state = {phase: '', check: null, reads: new Map(), current: null, startedAt: 0};
let pilot = null, settle = null, ticker = null;

const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const who = text => el('span', 'triage-who', text);

// A job's line while the check runs: its chip once read, "Checking…" for the one in flight, "Waiting" for the rest.
function liveRow(row) {
  const li = el('li', 'apply-check-row');
  if (row.chip) li.append(who(row.who), chip(row.chip.label, {tone: row.chip.tone, title: row.chip.detail || row.chip.label}));
  else if (state.current?.url === row.url) li.append(who(row.who), el('span', 'apply-check-busy small', t('pagesApplyCheck.checkingOne')));
  else li.append(who(row.who), el('span', 'muted small', t('pagesApplyCheck.waiting')));
  return li;
}

// One group of the split: its mode as the heading with a count, then each job and why it is there.
function groupBlock(group) {
  const box = el('section', `apply-check-group tone-${group.tone}`), head = el('h4', 'apply-check-group-head');
  head.append(el('span', 'apply-check-dot'), el('span', '', group.title), el('span', 'apply-check-count', String(group.rows.length)));
  if (group.key === 'auto') head.append(el('span', 'muted small', t('pagesApplyCheck.groupAutoNote')));
  const list = el('ul', 'apply-check-rows');
  for (const row of group.rows) { const li = el('li', 'apply-check-row'); li.append(who(row.who), el('span', 'muted small apply-check-why', row.chip.detail || row.chip.label)); list.append(li); }
  box.append(head, list);
  if (group.key === 'none') box.append(el('p', 'muted small apply-check-hint', t('pagesApplyCheck.noneHint')));
  return box;
}

// The split as one bar: a part per group, its width the group's share, the same colours as the groups below it.
function mixParts(view) {
  return view.groups.filter(group => group.rows.length).map(group => Object.assign(el('span', `tone-${group.tone}`), {title: `${group.title}: ${group.rows.length}`, style: `flex-grow: ${group.rows.length}`}));
}

function paintClock() { const node = $('apply-check-elapsed'); if (node) node.textContent = state.phase === 'checking' && state.current ? clock(Date.now() - state.startedAt) : ''; }

/** Draws the panel from `state`: the only function that shows or hides its parts. Takes nothing; safe to call at any time. */
function paint() {
  const panel = $('apply-check');
  if (!panel) return;
  const on = !!state.phase;
  panel.hidden = !on;
  $('apply-form')?.classList.toggle('is-checking', on);
  if (!on) return;
  const view = checkView(state.check, state.reads), matching = state.phase === 'matching', split = state.phase === 'split' || state.phase === 'sending';
  $('apply-check-title').textContent = split ? view.title : t('pagesApplyCheck.checkingTitle');
  $('apply-check-lead').textContent = split ? view.lines.join(' ') : t('pagesApplyCheck.checkingLead');
  $('apply-check-progress').hidden = split;
  $('apply-check-now').textContent = matching ? t('pagesApplyCheck.matching') : [t('pagesApplyCheck.checkingNow', {seen: Math.min(view.seen + 1, view.total), total: view.total}), state.current?.company].filter(Boolean).join(' · ');
  $('apply-check-track').classList.toggle('is-sliding', matching || view.seen === 0);
  $('apply-check-bar').style.width = matching || !view.seen ? '' : `${Math.round((view.seen / view.total) * 100)}%`;
  $('apply-check-mix').hidden = !split;
  $('apply-check-mix').replaceChildren(...(split ? mixParts(view) : []));
  const live = el('ul', 'triage-results apply-check-live');
  if (!split) live.append(...view.rows.map(liveRow));
  $('apply-check-list').replaceChildren(...(split ? view.groups.filter(group => group.rows.length).map(groupBlock) : [live]));
  paintClock();
  const go = $('apply-check-go'), cancel = $('apply-check-cancel');
  Object.assign(go, {hidden: !split || !view.startable, disabled: state.phase === 'sending', textContent: view.confirmLabel});
  Object.assign(cancel, {disabled: state.phase === 'sending', textContent: t('pagesApplyCheck.cancel')});
}

// The batch ends here: the panel hides and runCheck resolves with `result`.
function end(result) {
  clearInterval(ticker);
  Object.assign(state, {phase: '', check: null, current: null, reads: new Map()});
  paint();
  const done = settle;
  settle = null;
  done?.(result);
}

/** Cancel, Esc or the dialog closed: the app ends the held batch and nothing is queued. Takes nothing; a press while Confirm is being sent does nothing. */
export async function cancelCheck() {
  if (!state.phase || state.phase === 'sending') return;
  const plan = state.check.plan;
  end({cancelled: true});
  await pilot.applyCheckCancel(plan).catch(() => {});
}

// The person's one answer: the Full automation jobs they saw go with it; the app splits again from its own reads (lib/apply-check-first.js confirm).
async function confirmCheck() {
  if (state.phase !== 'split') return;
  const view = checkView(state.check, state.reads), plan = state.check.plan;
  state.phase = 'sending';
  paint();
  const result = await pilot.applyCheckConfirm(plan, view.autoUrls).catch(error => ({ok: false, error: error.message}));
  if (result?.cancelled) {   // Not now in the first-choice gate: nothing queued, nothing more to say; the app ends the held batch now, not in 30 minutes (code review)
    end({cancelled: true});
    await pilot.applyCheckCancel(plan).catch(() => {});
    return;
  }
  end(result?.ok || result?.outcomes?.length ? result : {ok: false, error: result?.error || t('helperFlow.applyStartFallback')});   // a refusal's .error is said by the dialog (jobs-apply.js)
}

// The check itself: each job without a read, one at a time, then the app's one match, then the split. It stops at once when the batch ended (Cancel, close, a newer batch).
async function checkEach(check) {
  for (const job of check.jobs || []) {
    if (state.check !== check) return;
    if (state.reads.has(job.url)) continue;
    Object.assign(state, {current: job, startedAt: Date.now()});
    paint();
    const read = await pilot.applyCheckRead(check.plan, job.url).catch(() => null);
    if (state.check !== check) return;   // cancelled meanwhile: a late read is not shown
    state.reads.set(job.url, read || null);
    paint();
  }
  Object.assign(state, {phase: 'matching', current: null});
  paint();
  const matched = await pilot.applyCheckMatch(check.plan).catch(() => null);
  if (state.check !== check) return;
  if (matched?.reads) state.reads = new Map(Object.entries(matched.reads));   // the app's own reads, so the split shown is the one Confirm is checked against
  clearInterval(ticker);
  state.phase = 'split';
  paint();
}

/**
 * Shows the check of a held Full automation batch and resolves with the app's answer: Confirm's result ({ok, outcomes, message} | {ok: false, error}) or {cancelled: true}.
 * Takes the hold answer's `check` ({plan, allowIneligible, jobs: [{url, title, company, read}]}) and the app's calls (`window.pilot` in the app: applyCheckRead, applyCheckMatch, applyCheckConfirm, applyCheckCancel).
 * A job whose check came with its kit is shown at once; only the others are read live, one at a time.
 * Why (8 Nov 2026, the window test): the answer settles the moment the person answers, never after the read in flight, so a stuck read cannot hold the dialog on "Starting…".
 */
export function runCheck(check, calls = window.pilot) {
  if (state.phase) cancelCheck();   // one held batch per dialog
  pilot = calls;
  Object.assign(state, {phase: 'checking', check, current: null, reads: new Map((check?.jobs || []).filter(job => job.read).map(job => [job.url, job.read]))});
  const answered = new Promise(resolve => { settle = resolve; });
  ticker = setInterval(paintClock, 1000);   // a read takes up to a minute: the seconds are the proof it is alive
  paint();
  checkEach(check).catch(() => {});   // a call that throws leaves the panel where it is: Cancel still ends the batch
  return answered;
}

/** Wires the panel's buttons and the dialog's close once. Takes nothing; a window without the panel wires nothing. */
export function wireApplyCheck() {
  if (!$('apply-check')) return;
  $('apply-check-cancel').addEventListener('click', () => cancelCheck());
  $('apply-check-go').addEventListener('click', () => confirmCheck());
  $('apply-dialog').addEventListener('close', () => cancelCheck());
  // Why (8 Nov 2026, code review): Esc while Confirm is being sent would close the dialog the answer is drawn into; it waits for the app's answer instead.
  $('apply-dialog').addEventListener('cancel', event => { if (state.phase === 'sending') event.preventDefault(); });
}
