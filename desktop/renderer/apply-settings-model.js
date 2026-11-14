// Settings → Apply (owner, 26 Oct 2026, hybrid fill step 2): how Jobadabra applies for the person, kept in settings.apply and read by the window
// (pages/apply-settings.js, pages/apply-choice.js) and the app (lib/apply-choice-gate.js). Pure. The consent switch (acceptConsents) and accounts
// (accountAutomation) keep their own keys: the extension reads them. Guard: test/unit/renderer/apply-settings.test.js.

// Why (27 Oct 2026, owner): approved labels state browser visibility and who submits; persisted mode IDs stay stable.
// runner: the batch runner the main process starts for the mode (lib/apply-handlers.js); a mode with none is not built. Why (28 Oct 2026, owner, #2317
// rework): a mode not built is drawn disabled with "Coming soon" and can never be the saved mode, so no screen offers a choice that does nothing.
// The PR that ships a mode's runner names it here.
// Why (2026-10-29, owner: "go ahead" with the switch): Full automation's runner is 'background' in every build; it runs only after the person confirmed it (autoConfirmedAt, stamped by save() in pages/apply-settings.js and read by lib/background-apply-controller.js).
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
export const MODES = Object.freeze([
  {id: 'check', icon: 'eye', title: t('helperMore.standardAutomation'), badge: [t('helperMore.bestQuality'), 'good'], runner: 'chrome',
    text: t('helperMore.visibleFilling')},
  {id: 'fill', icon: 'layers', title: t('helperMore.backgroundAutomation'), runner: 'background',
    text: t('helperMore.hiddenFilling')},
  {id: 'auto', icon: 'zap', title: t('helperMore.fullAutomation'), badge: [t('helperMore.moreLowerQuality'), 'warn'], runner: 'background',
    text: t('helperMore.fillsSubmits')},
]);
export const MODE_IDS = MODES.map(mode => mode.id);
/** The batch runner of the mode with this id, or '' when it is not built in this version (or unknown). */
export const modeRunner = id => MODES.find(mode => mode.id === id)?.runner || '';
/** True when the mode with this id runs in this version; an unknown id is not built. */
export const modeBuilt = id => !!modeRunner(id);

export const ANSWERS = Object.freeze([
  {id: 'facts', label: t('helperMore.onlyFacts')},
  {id: 'ai', label: t('helperMore.letGuess')},
]);
export const ANSWERS_TEXT = {
  facts: t('helperMore.factsText'),
  ai: t('helperMore.aiAnswersText'),
};

// Why (2026-10-29, owner: "remove all checks"; the wait is optional, default none): Full automation has no facts, fit or limit checks; the only setting is the optional wait before a submit (0 = none).
export const AUTO_DEFAULTS = Object.freeze({waitMin: 0});
const LIMITS = {waitMin: [0, 120]};
const clamp = (key, value) => {
  const [low, high] = LIMITS[key], n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(high, Math.max(low, n)) : AUTO_DEFAULTS[key];
};

// settings -> {mode, answers, auto, chosenAt, autoConfirmedAt, linkedinConfirmedAt, allowIneligible}: nothing saved yet is Standard automation (pre-selected, owner 26 Oct 2026) with facts only; the eligibility opt-in is false (owner, 7 Nov 2026).
// Invariant: mode is always a built mode; an older save of one not built yet reads as Standard automation, the mode that runs and the cards show.
export function applyOf(settings) {
  const saved = settings?.apply || {}, auto = {...AUTO_DEFAULTS};
  for (const key of Object.keys(AUTO_DEFAULTS)) {
    if (!(key in (saved.auto || {}))) continue;
    auto[key] = clamp(key, saved.auto[key]);
  }
  const mode = modeBuilt(saved.mode) ? saved.mode : 'check';
  return {mode, answers: saved.answers === 'ai' ? 'ai' : 'facts', auto, chosenAt: saved.chosenAt || '', autoConfirmedAt: mode === 'auto' ? saved.autoConfirmedAt || '' : '',
    linkedinConfirmedAt: mode === 'auto' && saved.autoConfirmedAt ? saved.linkedinConfirmedAt || '' : '', allowIneligible: saved.allowIneligible === true};
}
// Why (7 Nov 2026, owner: "Change the label (Recommended)" for the Apply button on a job, after it began to follow the saved mode): the button says where the application runs.
// Same three modes, same order as MODES; `tip` is the button's tooltip.
// Why (#3437): the words are read when called, not at load: this model is loaded without the pages catalog (page-case replays), and the Jobs page that draws the button has loaded it.
const ROW_APPLY_WORDS = Object.freeze({check: ['applyInChrome', 'extensionHelp'], fill: ['applyInBackground', 'backgroundApplyHelp'], auto: ['applyAutomatically', 'autoApplyHelp']});
/** The Apply button of one job for the saved mode: {label, tip}. Call after the pages catalog is loaded (pages/jobs-render.js does). */
export function rowApply(settings) {
  const [label, tip] = ROW_APPLY_WORDS[applyOf(settings).mode];
  return {label: t(`pagesJobsHelp.${label}`), tip: t(`pagesJobsHelp.${tip}`)};
}
export const applyChosen = settings => !!settings?.apply?.chosenAt;
/** True once the person confirmed Full automation for the mode it is saved in; a change to another mode clears it. */
export const autoConfirmed = settings => !!applyOf(settings).autoConfirmedAt;
/**
 * True when LinkedIn Easy Apply is on: its switch and LinkedIn jobs, which keeps the one sign-in it uses (settings.easyApply, settings.linkedinJobs). The one rule, read by lib/easy-apply-switch.js too.
 */
export const easyApplyOn = settings => settings?.easyApply?.on === true && settings?.linkedinJobs?.on === true;
/**
 * True when the Full automation confirmation must also carry the LinkedIn line: Easy Apply is on and the saved confirmation has no "LinkedIn may send" yes yet.
 * Why (14 Nov 2026, owner, plan 4b-1, asked via AskUserQuestion: "In the Full auto confirm (Recommended)"; D1 "Follow the Apply mode (Recommended)"): LinkedIn sends only after its own yes,
 * asked in the same confirmation, so Easy Apply turned on after Full automation was confirmed asks again.
 */
export const linkedinUnconfirmed = settings => easyApplyOn(settings) && !applyOf(settings).linkedinConfirmedAt;
/** True when a save would turn Full automation on without a confirmation yet: the dialog must ask first (save() in pages/apply-settings.js). */
export const needsAutoConfirm = (change, settings) => change.mode === 'auto' && !change.autoConfirmedAt && (!autoConfirmed(settings) || linkedinUnconfirmed(settings));
/** A mode that runs in Jobadabra's own hidden browser (Background or Full automation) is the saved mode, so the Applying page offers that browser's download. One rule for the start-up and for a change in Settings.
 *  Why (1 Nov 2026, #2485): keyed on the runner, not on the id 'fill': Full automation shares the runner and the controller refuses its start without the browser (lib/background-apply-controller.js enqueue). */
export const needsBrowser = settings => modeRunner(applyOf(settings).mode) === 'background';

// The settings patch for a change: the whole apply object (saveSettings merges one level). `chosen` stamps the confirmation.
export function applyPatch(settings, change = {}, {chosen = false, now = new Date()} = {}) {
  const current = applyOf(settings);
  const next = {...current, ...change, auto: {...current.auto, ...(change.auto || {})}};
  const autoConfirmedAt = next.mode === 'auto' ? change.autoConfirmedAt || current.autoConfirmedAt : '';
  const linkedinConfirmedAt = next.mode === 'auto' ? (change.autoConfirmedAt ? change.linkedinConfirmedAt || '' : current.linkedinConfirmedAt) : '';   // a new yes replaces both stamps
  return {apply: applyOf({apply: {...next, autoConfirmedAt, linkedinConfirmedAt, chosenAt: chosen ? now.toISOString() : current.chosenAt}})};
}

/** How long a confirmation given in Apply to jobs counts for the batch it started: it is sent with Start, normally seconds after it was given; a dialog left open longer asks again (code review, 7 Nov 2026). */
export const BATCH_CONFIRM_MS = 10 * 60000;
/** True when picking `mode` in Apply to jobs must ask the Full-automation confirmation first: Full automation is not the confirmed saved mode. The pick never writes Settings (owner, 7 Nov 2026, #3363). */
export const dialogNeedsConfirm = (mode, settings) => mode === 'auto' && (!autoConfirmed(settings) || linkedinUnconfirmed(settings));
/**
 * The Full-automation confirmation a dialog batch runs under: the stamp this very Start call carries when it is recent, else Settings' own when Settings itself is the confirmed Full automation, else ''.
 * `key`: 'autoConfirmedAt', or 'linkedinConfirmedAt' for its "LinkedIn may send" yes (plan 4b-1), read the same way.
 * Invariant: a batch's confirmation comes from its own call or from Settings' saved one, never from an earlier batch's dialog (nothing here is stored).
 */
export function batchConfirmation(stamp, settings, now = Date.now(), key = 'autoConfirmedAt') {
  const given = Date.parse(stamp);
  if (Number.isFinite(given) && given <= now + 60000 && now - given <= BATCH_CONFIRM_MS) return new Date(given).toISOString();
  return applyOf(settings)[key];
}
/**
 * The confirmations a batch picked in Apply to jobs or a job's ⋯ menu runs under (`call`: what that call carries): {autoConfirmedAt, linkedinConfirmedAt}, each read by batchConfirmation;
 * both '' for any mode but Full automation. lib/apply-handlers.js hands it to the controller (lib/background-apply-controller.js batchSettings).
 */
export const batchOf = (picked, call, settings, now = Date.now()) => (picked !== 'auto' ? {autoConfirmedAt: '', linkedinConfirmedAt: ''}
  : {autoConfirmedAt: batchConfirmation(call?.autoConfirmedAt, settings, now), linkedinConfirmedAt: batchConfirmation(call?.linkedinConfirmedAt, settings, now, 'linkedinConfirmedAt')});
