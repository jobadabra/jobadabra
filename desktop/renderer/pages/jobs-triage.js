// Apply triage on the Jobs screen (spec 2026-10-30-apply-triage, PR B): the button, the popup (how many of the best new jobs), the progress with Cancel, and the chip on each job.
// The form read itself is the hidden browser's (lib/triage-reader.js); a job that was not read keeps its "Not checked" chip.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {chip} from '../components.js';
import {$} from './core.js';
import {KEEP_TIMINGS, chipOf, estimateOf, pickForTriage, pickWhenFresh} from '../apply-triage-pick.js';
import {listReady} from './jobs-state.js';
import {heldAfterList} from '../apply-readiness-read.js';
import {shared} from './shared.js';

// The reads this window knows, by job URL: {read, at}: the checks run in this window, and the stored ones the list rows carry (keepStored).
const reads = new Map();
/** The read of a job, by its URL, or null when it has none. Takes the job's URL; never throws; the data is the reads this window holds (filled by setRead). */
export const readOf = url => reads.get(url)?.read || null;
/** Stores one job's read with the time it was read. Takes the URL and the read; returns nothing; a repeat read replaces the last one. */
export const setRead = (url, read) => reads.set(url, {read, at: new Date().toISOString()});
/**
 * Follows the stored checks the Jobs list rows carry (`job.check`, lib/apply-readiness.js rowCheck), so a restart keeps each row's "Needs you" line and "Account needed" chip and a
 * changed posting drops its old one (apply-readiness-read.js heldAfterList). A read made in this window wins over the stored one. Takes the list's rows; returns nothing.
 */
export function keepStored(jobs = []) {
  for (const job of jobs) {
    if (!job?.url) continue;
    const held = readOf(job.url), next = heldAfterList(held, job.check);
    if (!next) reads.delete(job.url);
    else if (next !== held) setRead(job.url, next);
  }
}

/** The chip for a job's row on the board: the mode of its last read, or "Not checked". */
export function triageChip(job, {detail: withDetail = true} = {}) {   // detail false: the value only (a narrow board card); the detail stays in the tooltip
  const {label, tone, detail} = chipOf(readOf(job?.url));
  return chip(label, {tone, detail: withDetail ? detail : '', title: detail || t('pagesJobsFinal.notReadYet')});
}

// The seconds each real read took on this Mac (the last ten), so the popup's estimate learns from them; a window with no storage keeps them for this session only.
const TIMINGS_KEY = 'jobadabra.triage-seconds';
let timings = [];
try { timings = (JSON.parse(localStorage.getItem(TIMINGS_KEY) || '[]') || []).filter(Number.isFinite).slice(-KEEP_TIMINGS); } catch { timings = []; }
const rememberTiming = seconds => { timings = [...timings, seconds].slice(-KEEP_TIMINGS); try { localStorage.setItem(TIMINGS_KEY, JSON.stringify(timings)); } catch { /* no storage: this session only */ } };

// Design (#3519, owner 7 Nov 2026: "it's very slow and doesn't give you live updates of what's going on"): the dialog has ONE owner of what it shows, `state`, and ONE painter, `paint()`.
//   idle     -> the count is editable, its line says how many and how long, the footer is Close + "Check N jobs".
//   running  -> the count is read-only, the line is replaced by the job being read (its number, title and company, the step it is on and that step's own seconds) and the jobs finished so far with their chips,
//               (8 Nov 2026, owner chose "A: fix the end + steps"): a job starts at "Getting ready" (its kit, the hidden browser); the read's steps (lib/triage-reader.js STEPS) move it on,
//               the footer is Close + Stop (no Check, no second Cancel). Close hides the dialog and the run goes on; opening it again shows the same state.
//   stopping -> Stop is pressed: the same view says "Stopping…" and Stop is disabled until the read in flight has ended.
//   matching -> every read is in: the simple forms' required questions are matched against Your details in ONE call (L2b); the words say so, Stop is gone (a call cannot be stopped), then done.
//   done     -> back to idle; the rows' chips and the toast say what was read.
const state = {picking: false, running: false, stopping: false, matching: false, total: 0, seen: 0, job: null, startedAt: 0, step: 'ready', stepAt: 0};
// The words of each step of a read; a step the dialog does not know keeps the one before it.
const STEP_WORDS = {ready: 'triageStepReady', opening: 'triageStepOpening', looking: 'triageStepLooking', pressing: 'triageStepPressing', landed: 'triageStepLanded', judging: 'triageStepLooking', planning: 'triageStepLooking'};
/** The read's step for the job in flight ({url, step} from the app, which sends the job's address back unchanged): its words and its own seconds start now. Another job's step, or one the dialog does not know, changes nothing. */
export function heardStep({url, step} = {}) {
  if (!state.running || !state.job || url !== state.job.url || !STEP_WORDS[step] || step === state.step) return false;
  Object.assign(state, {step, stepAt: Date.now()});
  paint();
  return true;
}
let cancelled = false, ticker = null;   // one run at a time: a second Start while one runs does nothing

// The popup's one choice: the first N best matching jobs not checked before (owner, 30 Oct 2026), N from the one field.
// A job whose read gave "Couldn't read" is offered again; any other read counts as checked.
const choiceNow = () => ({n: Math.max(1, Math.floor(Number($('triage-n')?.value) || 10)), isChecked: job => { const read = readOf(job.url); return read !== null && read.unreadable !== true; }});
const busy = () => state.picking || state.running;
const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// One finished job on the list: who it was and the chip of what its read said (a read that gave nothing says "Not checked", like its row).
function resultRow(job, read) {
  const li = document.createElement('li'), who = document.createElement('span');
  who.className = 'triage-who';
  who.textContent = [job.company, job.title].filter(Boolean).join(' · ');
  const {label, tone, detail} = chipOf(read);
  li.append(who, chip(label, {tone, title: detail || label}));   // the word only; the reason is its tooltip, so a row stays one line
  return li;
}

/** Draws the dialog from `state`: the only function that shows or hides its parts. Takes nothing; safe to call at any time. */
function paint() {
  const on = busy(), set = (id, fn) => { const el = $(id); if (el) fn(el); };
  set('triage-progress', el => { el.hidden = !state.running; });
  set('triage-count', el => { el.hidden = state.running; });
  set('triage-n', el => { el.disabled = on; });
  set('triage-start', el => { el.hidden = state.running; });
  set('triage-cancel', el => { el.hidden = !state.running || state.matching; el.disabled = state.stopping; });
  if (!state.running) {   // idle, or picking the fresh list (Check stays visible but disabled, as before, so the dialog is never a bare body)
    const picked = pickForTriage(shared.allJobs || [], choiceNow());
    const {text, measured} = estimateOf(picked.length, timings);
    const wanted = choiceNow().n, jobsWord = picked.length === 1 ? 'job' : 'jobs';
    set('triage-count', el => { el.textContent = !picked.length ? t('pagesAuditPunct.a39') : `${picked.length} ${jobsWord}${picked.length < wanted ? t('pagesAuditSecond.a117') : ''}${text ? ` · ${text}${measured ? '' : t('pagesAuditSecond.a118')}` : ''}`; });
    set('triage-start', el => { el.textContent = t('pagesShortJobs.m202', {"length": picked.length, count: picked.length}); el.disabled = picked.length === 0 || on; });
    return;
  }
  const words = state.matching ? t('helperTail.triageMatching') : state.stopping ? t('pagesControlStatus.stoppingDots') : [t('pagesShortJobs.m203', {"seen": Math.min(state.seen + 1, state.total), "length": state.total}), state.job?.title, state.job?.company].filter(Boolean).join(' · ');
  set('triage-progress-text', el => { el.textContent = words; el.title = state.job?.title || ''; });
  const stepWords = state.matching || state.stopping ? '' : t(`helperTail.${STEP_WORDS[state.step]}`);
  set('triage-elapsed', el => { el.textContent = state.stopping ? '' : [stepWords, clock(Date.now() - (state.matching ? state.startedAt : state.stepAt))].filter(Boolean).join(' · '); });
  set('triage-track', el => el.classList.toggle('is-sliding', state.seen === 0 || state.matching));
  set('triage-bar', el => { el.style.width = state.seen === 0 || state.matching ? '' : `${Math.round((state.seen / state.total) * 100)}%`; });
}

// One match for the whole check (L2b): the simple forms' required questions, asked of `match` once; a form it names gets its missing details on its read, and its line in the dialog is drawn again.
async function matchChecked(jobs, match, rows) {
  const asked = jobs.map(job => ({url: job.url, read: readOf(job.url)})).filter(({read}) => read?.simple === true && read.questions?.length && !read.match).map(({url, read}) => ({url, questions: read.questions}));
  if (!asked.length) return;
  Object.assign(state, {matching: true, job: null, startedAt: Date.now()});
  paint();
  const found = await match(asked).catch(() => ({}));   // a failed match leaves every form as it was read, never a guess
  for (const {url} of asked) {
    if (!found?.[url]) continue;
    setRead(url, {...readOf(url), match: found[url]});
    rows.get(url)?.replaceWith(resultRow(jobs.find(job => job.url === url), readOf(url)));
  }
}

/**
 * Runs the checks on the picked jobs, one at a time, through `read(job)` (the hidden-browser read). The dialog names the job in flight from the first moment, counts its seconds, and lists
 * each finished job's result as it lands; Stop ends before the next one. Resolves with {read, failed}: how many were read and how many could not be.
 */
export async function runTriage(jobs, read, match = null) {
  if (state.running) return {read: 0, failed: 0};
  Object.assign(state, {picking: false, running: true, stopping: false, total: jobs.length, seen: 0, job: null});
  cancelled = false;
  $('triage-results')?.replaceChildren();
  ticker = setInterval(paint, 1000);   // Why (#3519): one read takes about a minute; the seconds are the proof it is alive between its steps
  let done = 0, failed = 0;
  const rows = new Map();   // the dialog's line of each job, so the match can redraw it
  try {
    for (const job of jobs) {
      if (cancelled) break;
      Object.assign(state, {job, startedAt: Date.now(), step: 'ready', stepAt: Date.now()});
      paint();
      const started = Date.now();
      const result = await read(job).catch(() => null);
      if (result) { setRead(job.url, result); if (result.unreadable === true) failed += 1; else { if (!result.stored) rememberTiming((Date.now() - started) / 1000); done += 1; } }   // only a real read counts as read, and as a timing; one that could not be made is listed, with its reason
      if (cancelled && !result) break;   // a read Stop cut short is not a result
      state.seen += 1;
      const row = resultRow(job, result);
      rows.set(job.url, row);
      $('triage-results')?.append(row);
      $('triage-results')?.lastElementChild?.scrollIntoView({block: 'nearest'});
      paint();
    }
    if (match && !cancelled) await matchChecked(jobs, match, rows);   // Stop ends the check where it is: no match runs, so the simple forms read so far say "answers not checked" (apply-triage-mode.js), never "can apply automatically"
  } finally {
    clearInterval(ticker);
    Object.assign(state, {running: false, stopping: false, matching: false, job: null});
    paint();
  }
  return {read: done, failed};
}

// The default read reads nothing (a window with no hidden browser behind it): the person is told so.
const notYetRead = async () => null;
let wired = {read: notYetRead, match: null, rerender: () => {}};   // what wireTriage was given, so one job can be checked the same way

/**
 * Checks ONE job (the ⋯ menu's "Check apply readiness", the drawer's Check button) through the same read, match and dialog as the top button, so its progress and Stop show the same way.
 * Owner, 13 Nov 2026: "checks only this job, like the top button does for all". Takes the job; resolves with {read, failed}, or {read: 0, failed: 0} while another check runs.
 */
export async function checkJob(job) {
  if (busy() || !job?.url) return {read: 0, failed: 0};
  const dialog = $('triage-dialog');
  if (dialog && !dialog.open) dialog.showModal();
  const result = await runTriage([job], wired.read, wired.match);
  wired.rerender();
  return result;
}

/** Wires the popup once: `read(job)` is the form read in the hidden browser (null = nothing read), `cancel()` ends the read in flight, `rerender` redraws the list after a run, `toast(title, body, place, tone)` says how it ended, `onStep(fn)` hands the read's steps to the dialog. Takes the callbacks; a missing dialog wires nothing. */
export function wireTriage({read = notYetRead, match = null, cancel = () => {}, rerender = () => {}, toast = () => {}, onStep = () => {}} = {}) {
  const dialog = $('triage-dialog');
  if (!dialog) return;
  wired = {read, match, rerender};
  onStep(heardStep);
  $('triage-open').addEventListener('click', () => { paint(); dialog.showModal(); });
  $('triage-close').addEventListener('click', () => dialog.close());
  $('triage-n').addEventListener('input', paint);
  $('triage-cancel').addEventListener('click', () => { if (!state.running) return; cancelled = true; state.stopping = true; paint(); cancel(); });
  $('triage-start').addEventListener('click', async () => {
    if (busy()) return;
    state.picking = true; paint();
    let jobs = [], done = 0, failed = 0;
    try {
      jobs = await pickWhenFresh(() => shared.allJobs || [], listReady, choiceNow());   // never the kept copy painted before the fresh read (jobs-state.js)
      ({read: done, failed} = await runTriage(jobs, read, match));
    } finally {
      state.picking = false;
      paint();
    }
    rerender();
    // Why (7 Nov 2026, owner: three statuses with a sub-status; coordinator's "Checked 7 of 10, 3 couldn't be read"): a read that could not be made is said, never silently counted away.
    const body = failed ? t('pagesControlStatus.checkedSome', {done, length: jobs.length, failed}) : done ? t('pagesDynamicJobs.m240', {"done": done, "length": jobs.length}) : t('pagesAuditSecond.a119');
    toast(done ? t('pagesControlStatus.checkedJobs') : t('pagesControlStatus.nothingChecked'), body, null, done && !failed ? 'good' : done || failed ? 'warn' : 'info');
  });
  paint();
}
