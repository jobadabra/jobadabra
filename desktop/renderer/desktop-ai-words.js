// The words of "Let the Claude or ChatGPT desktop app answer your questions" (owner, 2 Nov 2026): the banner, the instruction that is copied, and what a press says afterwards. One file for every surface
// (the What we learned drawer and page, the Focus and Jobs rows, ⌘K), free of the DOM so test/desktop-ai.test.js checks them. The detection and the launch are lib/desktop-ai.js.
// Why (2 Nov 2026, owner): a friend's Claude Desktop answered the questions queue on its own on a Windows PC; we offer it, with a copied instruction and a button, instead of leaving it to chance.
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
    title: `Let ${name} answer your questions`,
    lead: `You have the ${name} app. Copy an instruction, paste it there, and ${name} answers from your CV and details. Its answers go through the same checks as yours, and you can look them over here.`,
    button: `Copy the instruction and open ${name}`,
    notNow: 'Not now',
    gone: `${name} is not on this computer any more. Nothing was copied.`,
    failed: 'Could not copy the instruction. Try again.',
    short: `Let ${name} answer your questions`,
    done: opened => (opened
      ? `Copied, and ${name} is open. Paste it in a new chat with ${paste(platform)} and send.`
      : `Copied. Open ${name} yourself, paste it in a new chat with ${paste(platform)} and send.`),
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
    connect: `Connect ${name}`,
    waiting: `Waiting for ${name}. In its window, read what it asks and press Install.`,
    notOpened: `The helper file is ready but ${name} did not open it. Open ${name}, then Settings, Extensions, Advanced settings, Install Extension, and choose the file.`,
    failed: `Could not prepare the connection. Try again.`,
    connected: used => `${name} is connected · ${used ? `Last used ${used}` : 'Not used yet'}`,
    disconnect: 'Disconnect',
    connectedLead: `Ask ${name} to answer your open questions. Its answers appear here marked New, and every change is listed under Changes by ${name}.`,
    disconnected: `${name} is disconnected. It can no longer read or change anything here.`,
    cardTitle: `${name} desktop app`,
    states: {off: 'Not connected', waiting: 'Waiting for install', connected: 'Connected'},
    cardLine: {
      off: `Connect it so ${name} can read your open questions and help answer them. You stay in charge: every change is listed and can be undone.`,
      waiting: `Connecting. Press Install in ${name}'s window. The file is valid for 10 minutes.`,
      connected: `${name} can read your questions, answers, CV details and job list, and answer open questions. It cannot submit anything.`,
    },
    privacy: {
      title: `What this shares with ${name}`,
      text: `When you ask ${name} to help, it reads your questions, answers, CV details and job list from this app, and that text is sent to ${company} as part of your chat, under their terms and your settings with them. `
        + `It never sees your passwords, keys or your LinkedIn session, never reads job posting texts, and never submits anything. Everything it changes is listed under Changes by ${name} and can be undone. Disconnect any time.`,
      connect: `Connect ${name}`,
      cancel: 'Not now',
      tools: 'See every tool it can use',
    },
    changes: {
      title: `Changes by ${name}`,
      none: `${name} has not changed anything yet.`,
      undo: 'Undo',
      undone: 'Undone',
      arrow: (before, after) => `${before || 'open'} → ${after}`,
      dismissed: 'Set aside',
      undoFailed: 'Could not undo that.',
    },
  };
}

/** "14:02" for today, "2 Nov, 14:02" for another day, '' for nothing: the time of a use or a change. `locale` and `now` are injectable so the test does not depend on the machine. */
export function whenText(iso, now = new Date(), locale = 'en-GB') {
  const at = new Date(iso);
  if (!iso || Number.isNaN(at.getTime())) return '';
  const time = at.toLocaleTimeString(locale, {hour: '2-digit', minute: '2-digit'});
  return at.toDateString() === now.toDateString() ? time : `${at.toLocaleDateString(locale, {day: 'numeric', month: 'short'})}, ${time}`;
}
