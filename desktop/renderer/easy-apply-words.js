// LinkedIn Easy Apply's switch in the window, plan 1/5 (spec docs/superpowers/specs/2026-11-13-linkedin-easy-apply-design.md D4): the owner's warning, which step a press takes, the Connections
// row and the ⌘K command. Pure, so test/unit/renderer/easy-apply-words.test.js checks them; pages/easy-apply-consent.js runs the steps in the one LinkedIn dialog.
import '../i18n/screens-pages.js';
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';

/** The window's copy of the switch (lib/easy-apply-switch.js viewOf), filled by pages/easy-apply-consent.js refreshEasyApply; here so the services list reads it without the page module. */
export const view = {loaded: false, on: false, signedIn: false, warned: false, offered: false};

export const EASY_APPLY = {
  // The owner's D4 answer, "Full text (Recommended)", 13 Nov 2026: the warning line and its two buttons are his words.
  warn: {title: t('pagesEasyApply.title'), lead: t('pagesEasyApply.lead'), line: t('pagesEasyApply.warning'), yes: t('pagesCommon.turnOn'), no: t('helperState.notNow')},
  manage: {title: t('pagesEasyApply.onTitle'), lead: t('pagesEasyApply.manageLead'), line: '', yes: t('helperFlow.turnOff'), no: t('helperFlow.keepOn')},
};

/**
 * The step a press on the row or ⌘K takes, from the window's read of the switch (lib/easy-apply-switch.js viewOf):
 * 'manage' (on: Keep on / Turn off) | 'linkedin-first' (no LinkedIn sign-in kept: the sign-in dialog first; any kept sign-in is enough, and the dialog keeps it without turning LinkedIn jobs on; owner, 14 Nov 2026) | 'warn' (the first turn-on) | 'turn-on' (warned once already).
 */
export function nextStep(view) {
  if (view.on) return 'manage';   // `on` is the active switch; a lost sign-in (view.lost) is off here and goes to the sign-in first, then straight back on
  if (!view.signedIn) return 'linkedin-first';
  return view.warned ? 'turn-on' : 'warn';
}

/** The Connections row: shown only where offered (dev builds until plan 4/5), on, and the word beside the button while off. */
export const rowOf = view => ({shown: !!(view?.loaded && view.offered), on: !!view?.on, lost: !!view?.lost, words: view?.lost ? t('pagesLinkedinServices.signinMissing') : view?.signedIn ? t('pagesCommon.off') : t('pagesEasyApply.needsLinkedin')});   // lost: still on, inactive until the sign-in is renewed

/** The ⌘K command "Turn off LinkedIn Easy Apply" while its sign-in is lost (the row's press is Renew then), so the saved-on switch can be cleared without renewing (Gitar on #4420); else null. */
export const turnOffCommandOf = (view, run) => (view?.loaded && view.offered && view.lost
  ? {label: t('pagesEasyApply.turnOff'), hint: t('pagesEasyApply.hint'), keywords: 'linkedin easy apply turn off disable connection', run} : null);

/** The ⌘K command that opens the same flow as the row (`run`), or null where the switch is not offered. */
export const commandOf = (view, run) => (view?.loaded && view.offered
  ? {label: view.lost ? t('pagesLinkedinServices.renewLabel') : view.on ? t('pagesEasyApply.turnOff') : t('pagesEasyApply.turnOn'), hint: t('pagesEasyApply.hint'), keywords: 'linkedin easy apply send applications automatic connection', run} : null);
