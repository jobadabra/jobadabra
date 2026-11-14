// LinkedIn jobs on every Find jobs (owner, 31 Oct 2026, spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the words of the one consent and the Suggestions entry, and
// when the ask is due. Pure, so test/unit/renderer/linkedin-consent.test.js checks them; pages/linkedin-consent.js draws the dialog, and the four doors (Settings, Find jobs ask, Suggestions, ⌘K) open it.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {NO_PLACE} from './targets.js';
export const KEY = 'linkedin:jobs';
// The owner's line (31 Oct 2026: "LinkedIn may limit accounts it thinks are automated; we read slowly and only your job searches.").
export const LINE = t('helperFlow.linkedinWarning');
const WHERE = t('helperFlow.linkedinWhere');
const LEAD = t('helperFlow.linkedinLead', {where: WHERE});

// The ways to sign in, shown in the dialog's choice (pages/linkedin-consent.js showWays).
const WAYS = {title: t('helperFlow.linkedinWays'), chrome: t('helperFlow.linkedinWayChrome'), chromeNote: t('helperFlow.linkedinWayChromeNote'), chromeMissing: t('helperFlow.linkedinWayChromeMissing'),
  window: t('helperFlow.linkedinWayWindow'), windowNote: t('helperFlow.linkedinWayWindowNote')};
export const CONSENT = {
  ask: {title: t('helperFlow.linkedinAsk'), lead: LEAD, line: LINE, yes: t('helperFlow.continue'), no: t('helperState.notNow'), ways: WAYS},
  'turn-on': {title: t('helperFlow.linkedinAsk'), lead: LEAD, line: LINE, yes: t('helperFlow.continue'), no: t('helperState.notNow'), ways: WAYS},
  // #3911: the way to renew a dead sign-in (⌘K, the card's Renew); its yes signs in here, the Chrome shortcut copies Chrome's.
  renew: {title: t('pagesLinkedinServices.renewTitle'), lead: t('pagesLinkedinServices.renewLead'), line: '', yes: t('helperFlow.continue'), no: t('pagesCommon.close'), ways: WAYS},
  // Why (owner, 14 Nov 2026: "make sure this popup make sense from all the states perspective"): Easy Apply's door (pages/easy-apply-consent.js, "LinkedIn jobs first") says why it asks for LinkedIn.
  'easy-apply': {title: t('pagesLinkedinServices.easyFirstTitle'), lead: t('pagesLinkedinServices.easyFirstLead'), line: LINE, yes: t('helperFlow.continue'), no: t('helperState.notNow'), ways: WAYS},
  manage: {title: t('helperFlow.linkedinOn'), lead: t('helperFlow.linkedinManage'), line: '', yes: t('helperFlow.turnOff'), no: t('helperFlow.keepOn')},
  'manage-easy-apply': {title: t('helperFlow.linkedinOn'), lead: `${t('helperFlow.linkedinManage')} ${t('pagesLinkedinServices.manageEasyApply')}`, line: '', yes: t('helperFlow.turnOff'), no: t('helperFlow.keepOn')},
};

/** The Suggestions entry while the switch is off; `view` is the window's read of the state (pages/linkedin-consent.js), `hidden`/`held` the keys answered Not now. */
export function linkedinEntries({view, hidden = new Set(), held = new Set()} = {}) {
  if (!view?.loaded || view.on || hidden.has(KEY) || held.has(KEY)) return [];
  return [{kind: 'linkedin', home: 'focus', topic: 'profile', key: KEY, title: t('helperFlow.linkedinSuggestion'), source: '',
    detail: t('helperFlow.linkedinSuggestionDetail'), evidence: [t('helperFlow.linkedinSuggestionEvidence')], answers: ['Not now'], actions: [{label: t('helperFlow.linkedinSignin'), do: 'turn_on_linkedin'}]}];
}

/** The ask on Find jobs: only a real Find jobs press (a re-score or Find employers goes through the same call), and only while the app says it is due. */
export const askOnPress = (view, why) => !!view?.ask && !(why && (why.reason || why.employers));

// Why "Turn on LinkedIn" opened no page, from the app (lib/extension-target.js noPageReason): the extension is only blamed when the app has not heard from it.
const NOT_OPENED = {
  missing: [t('helperFlow.extensionNeeded'), t('helperFlow.linkedinExtensionHelp')],
  'unknown-copy': [t('helperFlow.extensionUnknown'), t('helperFlow.extensionUnknownHelp')],
  chrome: [t('helperFlow.chromeNotOpened'), t('helperFlow.chromeNotOpenedHelp')],
};
/** The toast's arguments for a press that opened no page: `answer` = {opened: false, reason, note} (no answer at all reads as "missing"); `note` says how to update an older copy. */
export function notOpened(answer) {
  const [title, body] = NOT_OPENED[answer?.reason] || NOT_OPENED.missing;
  return [title, answer?.note ? `${body} ${answer.note}` : body, NO_PLACE.itself, 'warn'];
}

// How the sign-in window ended without a session (lib/linkedin-signin-window.js reasons; 'not-kept' = the Keychain or the sign-in itself was refused, its own sentence comes with it;
// 'popup-ended' = a provider's popup (Google, Apple) had opened and the window ended with no sign-in: the app cannot read that page, so the words only say it may not allow sign-in here).
const SIGN_IN_ENDED = {
  cancelled: [t('helperFlow.linkedinStillOff'), t('helperFlow.linkedinCancelled'), 'info'],
  timeout: [t('helperFlow.linkedinStillOff'), t('helperFlow.linkedinTimeout'), 'info'],
  'load-failed': [t('helperFlow.linkedinLoadFailed'), t('helperFlow.linkedinLoadHelp'), 'warn'],
  'no-keychain': [t('helperFlow.linkedinUnavailable'), t('helperFlow.linkedinNoKeychain'), 'info'],
  'not-kept': [t('helperFlow.linkedinStayedOff'), t('helperFlow.linkedinNotKept'), 'warn'],
  'popup-ended': [t('helperFlow.linkedinStillOff'), t('helperFlow.linkedinPopupEnded'), 'info'],
};
// Why (owner, 5 Nov 2026: "Allow popup, you try once"; "if Google refuses, the window says so plainly and points to signing in with Chrome"): the way out is the Chrome sign-in shortcut, or connecting the extension first.
const CHROME_WAY = {
  connected: t('helperFlow.linkedinChromeWay'),
  missing: t('helperFlow.linkedinChromeMissing'),
};
/** The toast's arguments for a sign-in window that ended with no session: `answer` = {ok: false, reason, error?}; an unknown reason reads as closed. `view.extension` = the Chrome extension is connected (pages/linkedin-consent.js). */
export function signInEnded(answer, view = {}) {
  const [title, body, tone] = SIGN_IN_ENDED[answer?.reason] || SIGN_IN_ENDED.cancelled;
  if (answer?.reason === 'popup-ended') return [title, `${body} ${view.extension ? CHROME_WAY.connected : CHROME_WAY.missing}`, NO_PLACE.itself, tone];
  return [title, answer?.reason === 'not-kept' && answer.error ? answer.error : body, NO_PLACE.itself, tone];
}

const SIGNIN_LINES = {missing: 'signinMissing', 'signed-out': 'signinSignedOut', check: 'signinCheck', empty: 'signinEmpty'};
/** The Settings card's state line while LinkedIn jobs is on and its sign-in needs the person (the one state: lib/linkedin-session.js signinView), else ''. */
export const signinLine = view => (view?.loaded && view.on && view.signin?.state === 'needs-you' ? t(`pagesLinkedinServices.${SIGNIN_LINES[view.signin.why] || 'signinEmpty'}`) : '');
/** The ⌘K command "Renew LinkedIn sign-in" while LinkedIn jobs is on (it opens the renew dialog with `run`), else null. */
export const renewCommandOf = (view, run = () => {}) => (view?.loaded && view.on
  ? {label: t('pagesLinkedinServices.renewLabel'), hint: t('pagesLinkedinServices.renewHint'), keywords: 'linkedin link sign in sign-in login renew expired signed out session connection', run} : null);
