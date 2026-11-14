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
 * 'manage' (on: Keep on / Turn off) | 'renew' (on but inactive: the sign-in was lost; sign in again) | 'sign-in' (no LinkedIn sign-in kept: Easy Apply's own dialog, its warning and how to sign in; owner, 14 Nov 2026: "a turn on should focus just on that
 * specific case") | 'warn' (the first turn-on, a sign-in kept) | 'turn-on' (warned once already).
 */
export function nextStep(view) {
  if (view.on) return view.signedIn ? 'manage' : 'renew';   // on but inactive: the sign-in was lost; signing in again makes it active (owner, 14 Nov 2026)
  if (!view.signedIn) return 'sign-in';
  return view.warned ? 'turn-on' : 'warn';
}

/** On but inactive: the saved switch is on and no LinkedIn sign-in is kept, so nothing is sent until the person signs in again. */
export const inactive = view => !!(view?.on && !view.signedIn);
// Why (owner, 14 Nov 2026, asked via AskUserQuestion after Gitar on #4289): "Lost sign-in, means they are not active anymore … The one on, is still on but inactive (UI should represent this state).
// Renew sign in bring the one on back to on and active": a lost sign-in never writes a switch; the row says Sign-in needed until any new sign-in.
/** The Connections row: shown only where offered (dev builds until plan 4/5), on, needs (on but inactive), and the word beside the button. */
export const rowOf = view => ({shown: !!(view?.loaded && view.offered), on: !!view?.on, needs: inactive(view), words: inactive(view) ? t('helperState.needsSignIn') : t('pagesCommon.off')});

/** The ⌘K command that opens the same flow as the row (`run`), or null where the switch is not offered. */
export const commandOf = (view, run) => (view?.loaded && view.offered
  ? {label: view.on ? t('pagesEasyApply.turnOff') : t('pagesEasyApply.turnOn'), hint: t('pagesEasyApply.hint'), keywords: 'linkedin easy apply send applications automatic connection', run} : null);
