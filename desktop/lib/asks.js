// The ask gate: when the app may invite the person to tell us what went wrong, instead of leaving (PR 3/7 of docs/superpowers/specs/2026-11-05-report-instead-of-leaving-design.md). One owner of the answer; the window only draws.
// Design (fb, 5 Nov 2026): a kind of ask is IDLE, PENDING (a moment passed the gate), ANSWERED ("Tell us" pressed, quiet 30 days) or SNOOZED ("Not now", quiet 14 days). The moments (MOMENTS): a failed application whose cause is ours to fix, a Find jobs press that failed (runMomentOf), a crash on the last run (fb 4/7); nothing else opens one.
// The No list is `mayAsk`: setup not finished, another ask within 24 hours, this kind snoozed or answered lately, a kind nobody defined. Guard: test/unit/main/asks.test.js.

import {ASK_CRASHED, ASK_FAILED_APPLICATION, ASK_FAILED_RUN, ASK_THIN_SEARCH, ASK_WORDS} from '../renderer/ask-card-text.js';
import {runFailure} from './run-failure.js';

export {ASK_CRASHED, ASK_FAILED_APPLICATION, ASK_FAILED_RUN, ASK_THIN_SEARCH};
const QUIET = {later: 14 * 24 * 3600 * 1000, tell: 30 * 24 * 3600 * 1000}, ONE_A_DAY = 24 * 3600 * 1000;
const KINDS = Object.keys(ASK_WORDS);
// Why (spec 2026-11-05, step 5/7): a thin search is asked at most once a week; the 5 is a guess from 2 testers' searches, to be measured on real installs for two weeks and then tuned.
const AT_MOST_EVERY = {[ASK_THIN_SEARCH]: 7 * 24 * 3600 * 1000}, THIN = 5;

const MOMENTS = {'failed-no-form': ASK_FAILED_APPLICATION, 'failed-account': ASK_FAILED_APPLICATION, 'failed-run': ASK_FAILED_RUN, crashed: ASK_CRASHED, 'thin-search': ASK_THIN_SEARCH};

/** A moment word -> the kind of ask it opens, or null. The words: an application result (lib/application-result.js: only the form not reached and the sign-in step are ours to fix; a success, or a person who walked away, opens nothing),
 *  'failed-run' (runMomentOf) and 'crashed' (the last run of the app ended in a crash). */
export function momentOf(word) {
  return MOMENTS[word] || null;
}

/** A finished engine run ({args, code, timedOut, stopped, tail, errorKind}, lib/pipeline-run.js) -> 'failed-run' when the person pressed Find jobs and it failed (the same verdict as the technical report, runFailure: never a Stop, a quit or a
 *  scheduled run), else ''. A run that ended with 0 is never a failure here, even with warnings. */
export function runMomentOf(info) {
  const args = info.args || [], mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : '';
  return args[0] === 'src' && ['daily', 'check'].includes(args[1]) && mode === 'run' && info.code !== 0 && runFailure(info) ? 'failed-run' : '';
}

/** May `kind` be asked at `now` (ms)? `settings` is the app's settings. Pure: the whole No list. */
export function mayAsk(settings, kind, now) {
  if (!KINDS.includes(kind) || !settings?.setupDone) return false;
  const mine = settings.asks || {};
  if (now - (mine.lastAt || -Infinity) < ONE_A_DAY) return false;
  if (now - (mine.openedAt?.[kind] || -Infinity) < (AT_MOST_EVERY[kind] || 0)) return false;
  if (now - (mine.snoozedAt?.[kind] || -Infinity) < QUIET.later) return false;
  return !(now - (mine.answeredAt?.[kind] || -Infinity) < QUIET.tell);
}

/** A finished Find jobs run ({ok, stopped, trigger, endedByTime}, lib/search-report.js) and the number of open jobs the person has in their places (null when unknown) -> 'thin-search' when the person pressed it, it finished, and fewer than 5 jobs
 *  are in their places; else ''. An unknown number is never a verdict. */
export function searchMomentOf(info, openInPlaces) {
  const pressed = ['you', 'first'].includes(info?.trigger) && info.ok === true && !info.stopped && !info.endedByTime;   // Why (code review of fb 5/7, 5 Nov 2026): a press cut at its 3 minutes ends with code 0, but it did not finish looking; few jobs then says nothing
  return pressed && Number.isInteger(openInPlaces) && openInPlaces >= 0 && openInPlaces < THIN ? 'thin-search' : '';
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
      remember(kind, 'openedAt');
      const win = getWindow?.();
      if (win && !win.isDestroyed()) win.webContents.send('askMoment');
    },
    /** After a finished run: counts the open jobs in the person's places with `count()` (async, may return null) and opens the thin-search ask when the verdict says so. Never throws. */
    async search(info, count) {
      try { this.moment(searchMomentOf(info, await count())); } catch { /* an invitation is never worth a failed search */ }
    },
    pending: () => open,
    answer(kind, how) {
      if (open !== kind || !QUIET[how]) return;
      open = null;
      remember(kind, how === 'tell' ? 'answeredAt' : 'snoozedAt');
    },
  };
}
