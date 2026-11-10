// The AI engine chooser's words and states (the setup wizard's AI step and Settings → Connections → AI), kept free of
// the DOM so the tests can check them. The user picks; nothing is chosen for them (lib/claude-code.js engine()).
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {costText, dollars} from './ai-cost.js';
import {FREE_WEAKER, FREE_WEAKER_SHORT} from './ai-tier-words.js';
import {plainError} from './run-warnings.js';
const freeOn = settings => !!(settings?.aiFree || settings?.aiTrial);
export const usingFree = settings => freeOn(settings) && (!settings.aiEngine || settings.aiEngine === 'api');   // Free is the engine in charge (a later pick of another engine wins)
// The one-time hint after AI-written text on Free AI (renderer/own-key-hint.js): its words, and when it is wanted (Free, not shown yet).
export const HINT = {text: t('helperMore.ownKeyHint', {quality: FREE_WEAKER_SHORT}), link: t('helperMore.openEngineSettings'), dismiss: t('helperState.dismiss')};
export const hintWanted = settings => usingFree(settings) && !settings?.ownKeyHintSeen;   // = lib/ai-free.js isOn (the renderer cannot import lib/)

export const TEXT = {
  title: t('helperMore.executionEngine'),
  families: {claude: 'Claude (Anthropic)', openai: 'ChatGPT (OpenAI)'},   // the two small cards under Free (owner, 16 Oct 2026; 9 Oct: family first, then its two cards)
  familyHint: {claude: t('helperMore.claudePlanKey'), openai: t('helperMore.chatgptPlanKey')},   // the company's logo on each card (owner, 16 Oct 2026)
  ownAccount: t('helperMore.ownAccount'),
  ownQuality: t('helperMore.ownQuality'),   // quality, never a number (owner, 16 Oct 2026)
  ownHeadroom: t('helperMore.ownHeadroom'),   // the numbers have their own line (owner, 10 Nov 2026: "let the users know of this difference"): own AI = no daily limit and 30 free applications on the trial; Pro unlimited
  subtitle: t('helperMore.engineSubtitle'),
  settingsSubtitle: t('helperMore.chooseEngine'),  // Settings → Connections: the two cards under it say the rest
  details: t('helperMore.installationDetails'),                 // the Claude Code path, folded under its status line
  api: {title: t('helperMore.apiKey'), text: t('helperMore.payOwnKey'),
    short: t('helperMore.payOwnKeyShort')},  // Settings shows the short line; the wizard explains in full
  cli: {title: t('helperMore.yourClaudeSubscription'), text: t('helperMore.useClaudePlan'),
    short: t('helperMore.usePaidPlan')},
  openai: {title: t('helperMore.apiKey'), text: t('helperMore.payOwnKey'),
    short: t('helperMore.payOwnKeyShort')},
  codex: {title: t('helperMore.yourOpenAiPlan'), text: t('helperMore.useCodexPlan'),
    short: t('helperMore.usePaidPlan')},
  free: {title: t('helperMore.free'), text: t('helperMore.freeDescription', {quality: FREE_WEAKER}), short: t('helperMore.freeShort', {quality: FREE_WEAKER_SHORT[0].toUpperCase() + FREE_WEAKER_SHORT.slice(1)})},
  // Why (2 Nov 2026, owner; localized 7 Nov 2026): Always on uses Jobadabra's AI on our servers, so translated plan notes never claim it "uses an API key".
  note: t('helperMore.claudeNote'),
  codexNote: t('helperMore.codexNote'),
  fallback: t('helperMore.claudeFallback'),
  codexFallback: t('helperMore.codexFallback'),
  fallbackHint: t('helperMore.fallbackHint'),
  notice: t('helperMore.claudeNotice'),
  codexNotice: t('helperMore.codexNotice'),
  offer: t('helperMore.cliOffer'),
};

// ⌘K: one entry per engine choice (the cards of pages/ai-engine.js, pressed by data-choice): [card, label, hint, search words, the family card to open first].
export const ENGINE_CHOICES = [
  ['free', t('helpers.useFree'), t('helperMore.freeShort', {quality: FREE_WEAKER_SHORT[0].toUpperCase() + FREE_WEAKER_SHORT.slice(1)}), 'free no key'],
  ['family-claude', t('helperMore.useOwnClaude'), t('helperMore.claudePlanKey'), 'claude anthropic own key api'],
  ['family-openai', t('helperMore.useOwnOpenAi'), t('helperMore.chatgptPlanKey'), 'openai chatgpt codex own key api'],
  ['cli', t('helperMore.useClaudeCode'), t('helperMore.claudeTasksMac'), 'claude code cli subscription', 'family-claude'],
  ['codex', t('helperMore.useCodex'), t('helperMore.chatgptTasksMac'), 'codex cli chatgpt subscription', 'family-openai'],
];

// Each engine's family, and the two cards of a family (API key first, then the user's own CLI).
export const familyOf = engine => (engine === 'openai' || engine === 'codex' ? 'openai' : 'claude');
export const FAMILY_CARDS = {claude: ['cli', 'api'], openai: ['codex', 'openai']};   // the subscription first, on the left (owner, 16 Oct 2026), then the API key
export const API_OF = {claude: 'api', openai: 'openai'};
export const CLI_OF = {claude: 'cli', openai: 'codex'};

// The picker's one selection (owner, 24 Oct 2026: "2 boxes get selected", "the old key box stays", "clicking a card should select it"). State is {picked, family}:
// Free is selected only with no provider open; a provider card is selected while its family is open; a method card only while it is the picked engine of
// that family. Switching provider drops the other family's pick, so its key box and CLI note go with it. Pure: pages/ai-engine.js draws it.
export function afterClick({picked = null, family = null} = {}, id) {
  if (id === 'free') return {picked: 'free', family: null};
  if (id.startsWith('family-')) {
    const next = id.slice('family-'.length);
    return next === family ? {picked, family} : {picked: picked && picked !== 'free' && familyOf(picked) === next ? picked : null, family: next};
  }
  return family && FAMILY_CARDS[family].includes(id) ? {picked: id, family} : {picked, family};
}
// A provider click also picks its method (owner, 24 Oct 2026: a click on a card should leave that family with one engine selected): the engine already
// saved for that family, else the subscription when its CLI is ready, else the API key.
export const defaultMethod = (family, {saved = null, cliUsable = false} = {}) =>
  saved && FAMILY_CARDS[family].includes(saved) ? saved : cliUsable ? CLI_OF[family] : API_OF[family];
// What is drawn selected for a state: the card ids, the one key box (the wizard's and Settings' API key steps) and the CLI note.
export function selection({picked = null, family = null} = {}) {
  const cards = [];
  if (picked === 'free' && !family) cards.push('free');
  if (family) cards.push(`family-${family}`);
  const method = family && FAMILY_CARDS[family].includes(picked) ? picked : null;
  if (method) cards.push(method);
  return {cards, keyBox: method && Object.values(API_OF).includes(method) ? method : null, note: method === CLI_OF[family] ? method : null};
}

// Who pays for an AI action, one quiet line before it runs and after it ran (owner, 18 Oct 2026, the cover letter's Draft with AI): never a guessed amount
// or time; after, the real cost only when one is known, an unknown one never "$0". The same three words as lib/cover-letter.js paidByOf.
export const PAID_BY = {free: 'credits', api: 'api', openai: 'api', cli: 'plan', codex: 'plan'};
export const USAGE = {credits: {before: t('helperMore.usesCredits'), after: t('helperMore.usedCredits')}, api: {before: t('helperMore.billedApiPeriod'), after: t('helperMore.billedApi')},
  plan: {before: t('helperMore.usesAllowance'), after: t('helperMore.usedAllowance')}};
export const usageBefore = (settings, hasKey = false) => USAGE[PAID_BY[chosen(settings, hasKey)]]?.before || '';
/** Describe the recorded payment route after a run; show measured API cost, a plan label, or an empty string when unknown. */
export const usageAfter = ({paidBy = '', usd = 0} = {}) => (paidBy === 'api' && costText(usd) ? t('helperMore.cost', {amount: dollars(usd)}) : USAGE[paidBy]?.after || '');
// The last run's real cost, labelled as the past (never an estimate for the next one): only a measured amount on an API account.
export const lastCost = ({paidBy = '', usd = 0} = {}, what = t('helperMore.draftNoun')) => (paidBy === 'api' && costText(usd) ? t('helperMore.lastCost', {what, amount: dollars(usd)}) : '');

// The chosen engine: 'api', 'cli', 'openai', 'codex' or null. In Settings an install that had a key before the choice existed shows 'api'
// (it keeps running on the key); the wizard shows nothing chosen until the user picks.
export function chosen(settings = {}, hasKey = false, context = 'settings') {
  if (context === 'wizard' && !freeOn(settings) && !['api', 'cli', 'openai', 'codex'].includes(settings.aiEngine) && !hasKey) return 'free';   // Free is preselected for a new user (owner, 16 Oct 2026)
  if (usingFree(settings)) return 'free';   // a later pick of another engine wins
  if (['api', 'cli', 'openai', 'codex'].includes(settings.aiEngine)) return settings.aiEngine;
  return context === 'settings' && hasKey ? 'api' : null;
}

// The Claude Code status block: dot lines (installed, signed in), the path, and whether it can be chosen.
export function cliStatus(status = null, family = 'claude') {
  const login = family === 'openai' ? t('helperMore.codexTerminalLogin') : t('helperMore.claudeTerminalLogin');
  if (!status) return {lines: [{tone: 'neutral', text: t('helpers.checking')}], path: '', usable: false, checking: true};
  const lines = [status.installed ? {tone: 'good', text: t('helperMore.installedVersion', {version: status.version ? ` v${status.version}` : ''})}
    : {tone: 'bad', text: t('helperMore.notInstalledMac')}];
  if (status.installed) {
    lines.push(status.authenticated ? {tone: 'good', text: t('helperMore.authenticated')}
      : status.checkedAt ? {tone: 'bad', text: t('helperMore.notSignedIn', {login})}
        : {tone: 'warn', text: t('helperMore.notVerified')});
  }
  if (status.error && status.authenticated) lines.push({tone: 'warn', text: plainError(status.error)});  // e.g. the usage window
  return {lines, path: status.path || '', usable: !!(status.installed && status.authenticated), checking: false};
}

// The pills under the picked CLI card. While a check runs the last answer's words are old ("Not installed on this Mac"): only "Checking…" shows (review of [cc] 1/2).
export function statusLines(cli, busy = false) {
  if (cli.usable) return [{tone: 'good', text: t('helperMore.readyUse')}];
  return busy ? [{tone: 'neutral', text: t('helpers.checking')}] : cli.lines.filter(each => each.tone !== 'good');
}
// The states whose card is about getting the program, and what a finished Install / Sign in says (one plain sentence, never the process's text).
export const INSTALL_STATES = ['nothing', 'app-only', 'broken', 'elsewhere', 'needs-git'];
const SENTENCE = {failed: t('helperMore.installFailed'), notFound: t('helperMore.installNotFound'),
  openedGit: t('helperMore.gitOpened'), signIn: t('helperMore.signInFailed')};
/**
 * what ('install' | 'install-git' | 'sign-in'), the run's result {ok, reason}, the family's state after it -> {problem, manual, check}
 * problem: one sentence or ''; manual: show the numbered steps and the page buttons; check: verify the CLI now (it appeared, or Git was added).
 * An installer that ends ok but leaves the program missing is a failure (review of [cc] 2/2: the person saw a minute of progress and the same card).
 */
export function runOutcome(what, result, stateAfter) {
  if (['cancelled', 'test', 'busy'].includes(result.reason)) return {problem: '', manual: false, check: false};
  if (what === 'sign-in') return {problem: result.ok ? '' : SENTENCE.signIn, manual: false, check: false};
  if (result.reason === 'opened-page') return {problem: SENTENCE.openedGit, manual: true, check: false};
  const missing = what === 'install' && INSTALL_STATES.includes(stateAfter) && stateAfter !== 'needs-git';
  if (result.ok && !missing) return {problem: '', manual: false, check: true};
  return {problem: result.reason === 'not-found' ? SENTENCE.notFound : SENTENCE.failed, manual: true, check: false};
}
// The keys the person saved themselves: Free AI's token in the same slot is not one (state.ownSecrets, lib/secrets.js).
export const ownKeys = state => state?.ownSecrets || state?.secrets || {};

// Wizard: Continue once a card is picked and it can run (Claude Code verified; the API card with a key saved or typed;
// Free AI always (nothing to type).
export function canContinue({picked, hasKey = false, keyTyped = false, status = null, hasOpenAiKey = false}) {
  if (picked === 'free') return true;
  if (picked === 'cli' || picked === 'codex') return cliStatus(status, familyOf(picked)).usable;
  if (picked === 'openai') return !!(hasOpenAiKey || keyTyped);
  if (picked === 'api') return !!(hasKey || keyTyped);
  return false;
}

// "Use my API key when Claude Code hits my plan limit": only with Claude Code chosen and a key saved. Off by default.
export const showFallback = (engine, hasKey, hasOpenAiKey = false) => (engine === 'cli' && !!hasKey) || (engine === 'codex' && !!hasOpenAiKey);
export const fallbackOn = settings => !!settings?.aiFallback;

// Settings: a small, non-blocking card for installs that already had an API key (they keep it): shown once,
// only when Claude Code is here and the user hasn't chosen an engine or dismissed it.
export const showOffer = (settings = {}, hasKey = false, status = null) =>
  !settings.aiEngine && !!hasKey && !settings.aiEngineOffered && !!status?.installed;

// The first-use notice: the first time the user picks Claude Code.
export const needsNotice = (settings, engine = 'cli') => (engine === 'codex' ? !settings?.codexNotice : !settings?.claudeCodeNotice);

// Recent activity: how a run was paid for, instead of "$0.03".
export function billingLabel(run = {}) {
  if (run.billing === 'Claude subscription') return t('helperMore.claudeYourPlan');
  if (run.billing === 'ChatGPT plan') return t('helperMore.codexYourPlan');
  if (run.billing === 'Both') return costText(run.usd, usd => `${dollars(usd)} + Claude Code`) || t('helperMore.claudeYourPlan');
  return null;
}
