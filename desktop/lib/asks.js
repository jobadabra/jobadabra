// The ask gate: when the app may invite the person to tell us what went wrong, instead of leaving (PR 3/7 of docs/superpowers/specs/2026-11-05-report-instead-of-leaving-design.md). One owner of the answer; the window only draws.
// Design (fb, 5 Nov 2026): a kind of ask is IDLE, PENDING (a moment passed the gate), ANSWERED ("Tell us" pressed, quiet 30 days) or SNOOZED ("Not now", quiet 14 days). Only a failed application whose cause is ours to fix is a moment here.
// The No list is `mayAsk`: setup not finished, another ask within 24 hours, this kind snoozed or answered lately, a kind nobody defined. Guard: test/unit/main/asks.test.js.

import {ASK_FAILED_APPLICATION, ASK_WORDS} from '../renderer/ask-card-text.js';

export {ASK_FAILED_APPLICATION};
const QUIET = {later: 14 * 24 * 3600 * 1000, tell: 30 * 24 * 3600 * 1000}, ONE_A_DAY = 24 * 3600 * 1000;
const KINDS = Object.keys(ASK_WORDS);

/** An application result word (lib/application-result.js) -> the kind of ask it opens, or null. Only the form not reached and the sign-in step are ours to fix; a success, or a person who walked away, opens nothing. */
export function momentOf(result) {
  return result === 'failed-no-form' || result === 'failed-account' ? ASK_FAILED_APPLICATION : null;
}

/** May `kind` be asked at `now` (ms)? `settings` is the app's settings. Pure: the whole No list. */
export function mayAsk(settings, kind, now) {
  if (!KINDS.includes(kind) || !settings?.setupDone) return false;
  const mine = settings.asks || {};
  if (now - (mine.lastAt || -Infinity) < ONE_A_DAY) return false;
  if (now - (mine.snoozedAt?.[kind] || -Infinity) < QUIET.later) return false;
  return !(now - (mine.answeredAt?.[kind] || -Infinity) < QUIET.tell);
}

/** The asks of one app run over `storage` (`demo`: the look-around app asks nothing): `moment(result)` opens an ask when the gate says yes and tells the window (`askMoment`); `pending()` is the open kind or null (kept until answered, so a reloaded window still gets it);
 *  `answer(kind, 'tell' | 'later')` closes it and starts that kind's quiet time. */
export function createAsks({storage, getWindow = null, now = Date.now, demo = false}) {
  let open = null;
  const remember = (kind, key) => {
    const mine = storage.settings().asks || {};
    storage.saveSettings({asks: {...mine, [key]: key === 'lastAt' ? now() : {...mine[key], [kind]: now()}}});
  };
  return {
    moment(result) {
      const kind = momentOf(result);
      if (demo || !kind || open || !mayAsk(storage.settings(), kind, now())) return;
      open = kind;
      remember(kind, 'lastAt');
      const win = getWindow?.();
      if (win && !win.isDestroyed()) win.webContents.send('askMoment');
    },
    pending: () => open,
    answer(kind, how) {
      if (open !== kind || !QUIET[how]) return;
      open = null;
      remember(kind, how === 'tell' ? 'answeredAt' : 'snoozedAt');
    },
  };
}
