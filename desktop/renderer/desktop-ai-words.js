// The words of "Let the Claude or ChatGPT desktop app answer your questions" (owner, 2 Nov 2026): the banner, the instruction that is copied, and what a press says afterwards. One file for every surface
// (the What we learned drawer and page, the Focus and Jobs rows, ⌘K), free of the DOM so test/desktop-ai.test.js checks them. The detection and the launch are lib/desktop-ai.js.
// Why (2 Nov 2026, owner): a friend's Claude Desktop answered the questions queue on its own on a Windows PC; we offer it, with a copied instruction and a button, instead of leaving it to chance.
export const KEY = 'desktop-ai:answer';   // the Suggestions answer key: Not now hides it 14 days like every other card (lib/suggestion-answers.js)
export const NAMES = {claude: 'Claude', openai: 'ChatGPT'};

/** The instruction the person pastes into their AI app. It promises nothing the drawer's own checks do not give: it never submits, never touches Settings, skips what it does not know. */
export const instruction = () => [
  'Open the Jobadabra app and go to Profile → What we learned.',
  'Answer each open question from my CV and my details in Jobadabra. Never invent an answer: if you do not know it, skip that question.',
  'Never press Submit on any job. Do not change Settings.',
].join('\n');

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
    short: `Let ${name} answer your questions`,
    done: opened => (opened
      ? `Copied, and ${name} is open. Paste it in a new chat with ${paste(platform)} and send.`
      : `Copied. Open ${name} yourself, paste it in a new chat with ${paste(platform)} and send.`),
  };
}
