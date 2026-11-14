// LinkedIn Easy Apply's switch in the window, plan 1/5 (spec docs/superpowers/specs/2026-11-13-linkedin-easy-apply-design.md D4): the window's copy of the switch and the flow behind its two doors
// (the Connections row, ⌘K). It shares the one LinkedIn dialog (pages/linkedin-consent.js). Two switches, one sign-in (owner, 14 Nov 2026, replacing 13 Nov "LinkedIn jobs first"): with no
// sign-in kept, Easy Apply's own dialog shows its warning and how to sign in, and the sign-in turns on Easy Apply only; with one kept, only the warning, once. The steps and words are renderer/easy-apply-words.js. Guard: test/unit/renderer/easy-apply-words.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {EASY_APPLY, commandOf, nextStep, view} from '../easy-apply-words.js';
import {openLinkedinConsent, refreshLinkedin, say, showConsent} from './linkedin-consent.js';
import {NO_PLACE} from '../targets.js';

export {view};

/** Read the switch from the app; tells the pages ('easy-apply-changed') when what they draw changed. */
export async function refreshEasyApply() {
  const before = `${view.on}:${view.signedIn}:${view.offered}`;
  Object.assign(view, await window.pilot.easyApplyState(), {loaded: true});
  if (before !== `${view.on}:${view.signedIn}:${view.offered}`) window.dispatchEvent(new Event('easy-apply-changed'));
  return view;
}

// Easy Apply reads as on only while a sign-in is kept (lib/easy-apply-switch.js state), and LinkedIn's dialog may change it, so a change there is re-read here.
window.addEventListener('linkedin-changed', () => { refreshEasyApply().catch(() => {}); });

async function turnOn(warned) {
  const answer = await window.pilot.easyApplyOn({warned}).catch(() => null);
  await refreshEasyApply().catch(() => {});
  if (answer?.ok) say(t('pagesEasyApply.onTitle'), t('pagesEasyApply.onBody'), NO_PLACE.itself, 'good');
  else say(t('pagesEasyApply.stayedOff'), '', NO_PLACE.itself, 'warn');
}

/** The one flow behind every door: manage while on and active; sign in again while on but inactive; else, with no sign-in kept, Easy Apply's own dialog (warning + how to sign in), on once the sign-in came; else the warning once, then on. Resolves when its last step is done. */
export async function openEasyApply() {
  await refreshEasyApply();
  const step = nextStep(view);
  if (step === 'sign-in') {
    const kept = await openLinkedinConsent({mode: 'easy-apply'});   // its Continue is the warned yes; resolves once the sign-in came (the Chrome way waits for its copy)
    await refreshEasyApply().catch(() => {});
    return kept ? turnOn(true) : undefined;   // Not now, closed, or the copy never came: Easy Apply stays off and its Turn on asks again
  }
  if (step === 'renew') {   // on but inactive: the one sign-in again; the switch is already on, so it is active once the sign-in came
    await openLinkedinConsent({mode: 'renew'});
    await refreshEasyApply().catch(() => {});
    return undefined;
  }
  if (step === 'turn-on') return turnOn(false);
  const answer = await showConsent(step === 'manage' ? EASY_APPLY.manage : EASY_APPLY.warn);
  if (answer !== 'default') return;
  if (step === 'warn') return turnOn(true);
  await window.pilot.easyApplyOff();
  await refreshEasyApply();
  await refreshLinkedin().catch(() => {});   // off may have deleted the sign-in (LinkedIn jobs off too): LinkedIn jobs' next Turn on must ask for one again
  say(t('pagesEasyApply.offTitle'), t('pagesEasyApply.offBody'), NO_PLACE.itself, 'info');
}

/** Adds the switch's ⌘K command through `add(group, label, hint, keywords, run)` (pages/nav.js), where it is offered; reads the switch for the next opening. */
export function addEasyApplyCommand(add) {
  refreshEasyApply().catch(() => {});
  const command = commandOf(view, () => openEasyApply());
  if (command) add('Settings', command.label, command.hint, command.keywords, command.run);
}
