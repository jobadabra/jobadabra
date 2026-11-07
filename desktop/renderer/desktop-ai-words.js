// The words of "Let the Claude or ChatGPT desktop app answer your questions" (owner, 2 Nov 2026): the banner, the instruction that is copied, and what a press says afterwards. One file for every surface
// (the What we learned drawer and page, the Focus and Jobs rows, ⌘K), free of the DOM so test/unit/renderer/desktop-ai.test.js checks them. The detection and the launch are lib/desktop-ai.js.
// Why (2 Nov 2026, owner): a friend's Claude Desktop answered the questions queue on its own on a Windows PC; we offer it, with a copied instruction and a button, instead of leaving it to chance.
import '../i18n/screens-helpers.js';
import {t, getLocale} from '../i18n/index.js';
import {date} from '../i18n/format.js';
export const KEY = 'desktop-ai:answer';   // the Suggestions answer key: Not now hides it 14 days like every other card (lib/suggestion-answers.js)
export const NAMES = {claude: 'Claude', openai: 'ChatGPT'};

/**
 * The instruction the person pastes into their AI app. It promises nothing the drawer's own checks do not give: it never submits, never touches Settings, skips what it does not know.
 * `connected` (4/6): once the Jobadabra tools are connected it is the short one, "Use the Jobadabra tools", because the tools refuse what the drawer refuses.
 */
export const instruction = (connected = false) => (connected
  ? ['Use the Jobadabra tools to answer my open questions.',
    'Never invent an answer: if you do not know it, skip that question.',
    'Never press Submit on any job. Do not change Settings.'].join('\n')
  : ['Open the Jobadabra app and go to Profile → What we learned.',
    'Answer each open question from my CV and my details in Jobadabra. Never invent an answer: if you do not know it, skip that question.',
    'Never press Submit on any job. Do not change Settings.'].join('\n'));

const paste = platform => (platform === 'darwin' ? '⌘V' : 'Ctrl+V');

/** Everything a surface draws for the app `family` ('claude' | 'openai'). `platform` picks the paste key. */
export function words(family, platform = 'darwin') {
  const name = NAMES[family] || NAMES.claude;
  return {
    title: t('helperMore.letAppAnswer', {name}),
    lead: t('helperMore.appAnswerLead', {name}),
    button: t('helperMore.copyOpenApp', {name}),
    notNow: t('helperState.notNow'),
    gone: t('helperMore.appGone', {name}),
    failed: t('helperMore.cannotCopyInstruction'),
    short: t('helperMore.letAppAnswer', {name}),
    done: opened => (opened
      ? t('helperMore.copiedAppOpen', {name, paste: paste(platform)})
      : t('helperMore.copiedOpenYourself', {name, paste: paste(platform)})),
  };
}

/**
 * Connect Claude (4/6, spec "Transport and install" and "The privacy note"): the words of the Connect button, the wait for Claude's own install window, the connected line, Disconnect, the privacy note
 * shown once before the first Connect, and the Changes strip. One file for the banner, Settings → Connections, ⌘K and the strip. `family`: 'claude' (ChatGPT follows in 6/6 with its own tunnel sentence).
 * Why (3 Nov 2026, owner D4): the privacy note names the AI and says where the text goes, so the person decides knowing it.
 */
export function connectWords(family = 'claude') {
  const name = NAMES[family] || NAMES.claude, company = family === 'openai' ? 'OpenAI' : 'Anthropic';
  return {
    name,
    connect: t('helperMore.connectApp', {name}),
    waiting: t('helperMore.waitingApp', {name}),
    notOpened: t('helperMore.appDidNotOpen', {name}),
    failed: t('helperMore.prepareConnectionFailed'),
    connected: used => t('helperMore.appConnected', {name, used: used ? t('helperMore.lastUsed', {time: used}) : t('helperMore.notUsedYet')}),
    disconnect: t('helperMore.disconnect'),
    connectedLead: t('helperMore.appConnectedLead', {name}),
    disconnected: t('helperMore.appDisconnected', {name}),
    cardTitle: t('helperMore.appDesktop', {name}),
    states: {off: t('helpers.notConnected'), waiting: t('helperMore.waitingInstall'), connected: t('helpers.connected')},
    cardLine: {
      off: t('helperMore.connectReadQuestions', {name}),
      waiting: t('helperMore.connectionValid'),
      connected: t('helperMore.appCanRead', {name}),
    },
    privacy: {
      title: t('helperMore.sharedWithApp', {name}),
      text: t('helperMore.appPrivacy', {name, company}),
      connect: t('helperMore.connectApp', {name}),
      cancel: t('helperState.notNow'),
      tools: t('helperMore.seeTools'),
    },
    changes: {
      title: t('helperMore.changesBy', {name}),
      none: t('helperMore.noAppChanges', {name}),
      undo: t('helpers.undo'),
      undone: t('helperMore.undone'),
      arrow: (before, after) => `${before || t('helperMore.openState')} → ${after}`,
      dismissed: t('helperMore.setAside'),
      undoFailed: t('helperMore.undoFailed'),
    },
  };
}

/** "14:02" for today, "2 Nov, 14:02" for another day, '' for nothing: the time of a use or a change. `locale` and `now` are injectable so the test does not depend on the machine. */
export function whenText(iso, now = new Date(), locale = null) {
  const at = new Date(iso);
  if (!iso || Number.isNaN(at.getTime())) return '';
  const format = options => locale || getLocale() === 'en' ? new Intl.DateTimeFormat(locale || 'en-GB', options).format(at) : date(at, options);
  const time = format({hour: '2-digit', minute: '2-digit'});
  return at.toDateString() === now.toDateString() ? time : `${format({day: 'numeric', month: 'short'})}, ${time}`;
}
