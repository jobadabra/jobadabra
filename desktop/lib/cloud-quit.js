// What a quit with Full automation applications still working offers about Always on (cloud browser runner cs 4/4, owner 10 Nov 2026: "If the user quits the app while something is running, we should popup and ask him to
// switch on Always on"; approved by the owner as drawn, "Yes + 'Stop and quit' in case 3"). The words are lib/quit-dialog.js sessionsOnly's; this decides which case applies and what the third button does.
// Invariants: only a Pro install on its own real app is offered anything (the cloud refuses the rest, so the offer would lie); Always on is never turned on without the e-mail address the person already gave
// (without one the app stays open and shows Always on); "Keep working" stays the default. Guard: test/unit/main/cloud-quit.test.js.
import {createPlan} from './plan.js';
import {state as hostedSearch} from './hosted-search.js';
import {consented} from './email-consent.js';
import {emailOf} from './notify-channel.js';
import {turnOnShared} from './hosted-email.js';
import * as mail from './mail-choices.js';
import {realInstall} from './cloud-on.js';

const BEFORE_PRESS = new Set(['queued', 'preflight', 'filling', 'ready_for_review', 'waiting_to_submit']);

/** -> 'on' (Always on is on: a quit hands them to the cloud), 'off' (offer to turn it on; the person's address is on file), 'setup' (offer to set it up first), or null (nothing to offer: no Full automation item before its press, not Pro, not a real install). */
export function offerFor(storage, sessions, {real = realInstall} = {}) {
  if (!real() || !sessions.some(session => session.background?.mode === 'auto' && BEFORE_PRESS.has(session.background?.state))) return null;
  if (createPlan(storage).state().plan !== 'pro') return null;
  // Why (code review of cs 4/4): the site takes one auto night per install and UTC day; once today's started, a later quit cannot hand anything over, so the dialog must not promise it (it is the old dialog: Stop and quit).
  const night = storage.settings().cloudAuto;
  if (storage.settings().cloud?.repo || hostedSearch(storage).on) return night?.started && night.night === new Date().toISOString().slice(0, 10) ? null : 'on';
  return consented(storage) && emailOf(storage) ? 'off' : 'setup';
}

/** The third button of the quit dialog. -> 'quit' (go on and quit: the departure hook hands the items over) or 'stay' (keep the app open and show Always on: nothing could be turned on here). Never throws. */
export async function chooseCloud(storage, kind, {turnOn = turnOnShared} = {}) {
  if (kind === 'on') return 'quit';
  if (kind !== 'off') return 'stay';
  try {
    const was = mail.modeOf(storage), done = await turnOn(storage, {});
    if (done.ok && was !== 'always') mail.alwaysOnTurnedOn(storage).catch(() => {});   // every mail switch turns on with Always on (lib/mail-choices.js), as the Always on card does
    return done.ok ? 'quit' : 'stay';
  } catch { return 'stay'; }
}
