// LinkedIn Easy Apply's switch in the window, plan 1/5 (spec docs/superpowers/specs/2026-11-13-linkedin-easy-apply-design.md D4): the window's copy of the switch and the flow behind its two doors
// (the Connections row, ⌘K). It shares the one LinkedIn dialog (pages/linkedin-consent.js showConsent). Without a LinkedIn sign-in, LinkedIn jobs' own dialog comes first (owner, 13 Nov 2026:
// "LinkedIn jobs first"); the owner's warning comes once, before the first turn-on. The steps and words are renderer/easy-apply-words.js. Guard: test/unit/renderer/easy-apply-words.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {EASY_APPLY, commandOf, nextStep, view} from '../easy-apply-words.js';
import {openLinkedinConsent, refreshLinkedin, say, showConsent} from './linkedin-consent.js';
import {NO_PLACE} from '../targets.js';

export {view};

/** Read the switch from the app; tells the pages ('easy-apply-changed') when what they draw changed. */
export async function refreshEasyApply() {
  const before = `${view.on}:${view.linkedinOn}:${view.offered}`;
  Object.assign(view, await window.pilot.easyApplyState(), {loaded: true});
  if (before !== `${view.on}:${view.linkedinOn}:${view.offered}`) window.dispatchEvent(new Event('easy-apply-changed'));
  return view;
}

// Easy Apply reads as on only while LinkedIn jobs is on (lib/easy-apply-switch.js state), so a change of that switch is re-read here.
window.addEventListener('linkedin-changed', () => { refreshEasyApply().catch(() => {}); });

async function turnOn(warned) {
  const answer = await window.pilot.easyApplyOn({warned}).catch(() => null);
  await refreshEasyApply().catch(() => {});
  if (answer?.ok) say(t('pagesEasyApply.onTitle'), t('pagesEasyApply.onBody'), NO_PLACE.itself, 'good');
  else say(t('pagesEasyApply.stayedOff'), answer?.reason === 'needs-linkedin' ? t('pagesEasyApply.needsLinkedin') : '', NO_PLACE.itself, 'warn');
}

/** The one flow behind every door: manage while on; else LinkedIn jobs first when it holds no sign-in, then the warning once, then on. Resolves when its last step is done. */
export async function openEasyApply() {
  await refreshEasyApply();
  let step = nextStep(view);
  if (step === 'linkedin-first') {
    await openLinkedinConsent({mode: 'easy-apply'});
    await refreshLinkedin().catch(() => {});
    await refreshEasyApply();
    step = nextStep(view);
    if (step === 'linkedin-first') return;   // Not now, or the sign-in still finishing in Chrome: the person presses Turn on again once LinkedIn jobs is on
  }
  if (step === 'turn-on') return turnOn(false);
  const answer = await showConsent(step === 'manage' ? EASY_APPLY.manage : EASY_APPLY.warn);
  if (answer !== 'default') return;
  if (step === 'warn') return turnOn(true);
  await window.pilot.easyApplyOff();
  await refreshEasyApply();
  say(t('pagesEasyApply.offTitle'), t('pagesEasyApply.offBody'), NO_PLACE.itself, 'info');
}

/** Adds the switch's ⌘K command through `add(group, label, hint, keywords, run)` (pages/nav.js), where it is offered; reads the switch for the next opening. */
export function addEasyApplyCommand(add) {
  refreshEasyApply().catch(() => {});
  const command = commandOf(view, () => openEasyApply());
  if (command) add('Settings', command.label, command.hint, command.keywords, command.run);
}
