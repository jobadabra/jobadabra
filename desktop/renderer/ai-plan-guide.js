// The words and buttons of each readiness state of the person's own AI plan (Claude Code for a Claude plan, Codex for a ChatGPT plan), for Windows and Mac. Pure: lib/plan-readiness.js
// decides the state, this file says it in plain words with one next step, pages/ai-engine.js draws it. Never a path, an exit code or a raw message: that stays in "Copy details for support".
// Why (2 Nov 2026, owner, a Windows tester who had only the Claude app): "We should never show a raw error. We should handle it properly. If the user has ChatGPT desktop or Claude Desktop,
// we should say explicitly: we detected the app, but the CLI is still missing. Please install using this guide."
// The install lines are the official ones: Claude Code from code.claude.com/docs/en/setup, Codex from the openai/codex README (checked 2 Nov 2026).
export const FAMILY = {
  claude: {app: 'the Claude Desktop app', cli: 'Claude Code', plan: 'Claude plan', account: 'Claude account', file: 'claude', run: 'claude', page: 'https://code.claude.com/docs/en/setup',
    command: {win32: 'irm https://claude.ai/install.ps1 | iex', darwin: 'curl -fsSL https://claude.ai/install.sh | bash'}},
  openai: {app: 'the ChatGPT app', cli: 'Codex', plan: 'ChatGPT plan', account: 'ChatGPT account', file: 'codex', run: 'codex', page: 'https://developers.openai.com/codex/cli',
    command: {win32: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"', darwin: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh'}},
};
export const GIT_PAGE = 'https://git-scm.com/downloads/win';
export const STATE_TONE = {checking: 'info', ready: 'good', limit: 'good', 'sign-in': 'warn', 'needs-git': 'warn', 'app-only': 'info', nothing: 'info', elsewhere: 'warn', broken: 'warn', 'check-failed': 'warn'};

const where = platform => (platform === 'win32' ? 'PowerShell (Start menu, type PowerShell)' : 'Terminal (press ⌘ Space, type Terminal)');
const commandOf = (family, platform) => FAMILY[family].command[platform === 'win32' ? 'win32' : 'darwin'];
// The numbered install steps, shown beside the Install button and kept when it fails.
function installSteps(family, platform) {
  const f = FAMILY[family];
  return {steps: [`Open ${where(platform)}.`, 'Paste this line and press Enter:', `Come back to Jobadabra: it notices ${f.cli} by itself.`], command: commandOf(family, platform), page: f.page};
}
function signInSteps(family, platform) {
  const f = FAMILY[family];
  return {steps: [`Open ${where(platform)}.`, `Type this and press Enter, then sign in with your ${f.account} in the browser:`, 'Come back to Jobadabra: it notices by itself.'], command: f.run};
}

/**
 * state, {family, platform, inApp} -> {state, tone, title, text, steps, command, actions: [{id, label, primary}]}
 * inApp: the in-app buttons (install, sign in) exist; without them the first button opens the official page and the numbered steps carry the install.
 * Action ids the page wires: install, install-git, sign-in, free, choose-file, check, details.
 */
export function guide(state, {family = 'claude', platform = 'darwin', inApp = false} = {}) {
  const f = FAMILY[family], file = `${f.file}${platform === 'win32' ? '.exe' : ''}`;
  const act = (id, label, primary = false) => ({id, label, primary});
  const choose = act('choose-file', `Already installed? Choose ${file}`);
  const check = act('check', 'Check again'), details = act('details', 'Copy details for support');
  const install = act('install', inApp ? `Install ${f.cli}` : 'Open the install page', true);
  const out = (title, text, actions, extra = {}) => ({state, tone: STATE_TONE[state], title, text, steps: [], command: '', actions, ...extra});
  switch (state) {
    case 'checking': return out(`Checking ${f.cli}…`, '', []);
    case 'ready': return out(`Ready: uses your ${f.plan}`, '', []);
    case 'limit': return out(`Ready. Your ${f.plan}'s limit is reached for now`, 'Tasks try again by themselves when it resets.', []);
    case 'app-only': return out(`We found ${f.app} on this computer, but ${f.cli} (its command-line part) is still missing.`,
      `Jobadabra needs ${f.cli}, a free part of the same ${f.account}. It installs in about a minute and needs no administrator.`, [install, choose, check, details], installSteps(family, platform));
    case 'nothing': return out(`${f.cli} is not on this computer yet.`,
      `Jobadabra needs ${f.cli} to use your ${f.plan}. It installs in about a minute and needs no administrator. No ${f.plan}? Use Free AI or an API key.`,
      [install, act('free', 'Use Free AI'), choose, check, details], installSteps(family, platform));
    case 'sign-in': return out(`${f.cli} is installed. Sign in with your ${f.account}.`,
      `It opens ${family === 'claude' ? 'Anthropic' : 'OpenAI'}'s sign-in page in your browser. Jobadabra never sees your password.`,
      [...(inApp ? [act('sign-in', 'Sign in', true)] : []), check, details], inApp ? {} : signInSteps(family, platform));
    case 'needs-git': return out(`${f.cli} needs Git for Windows.`, 'Install it once (it is free), then Jobadabra checks again by itself.',
      [act('install-git', inApp ? 'Install Git for Windows' : 'Open the Git download page', true), check, details], inApp ? {} : {page: GIT_PAGE});
    case 'elsewhere': return out(`The ${f.cli} file you chose is no longer there.`, `Choose it again, or install ${f.cli}.`,
      [act('choose-file', `Choose ${file}`, true), install.primary ? {...install, primary: false} : install, check, details]);
    case 'broken': return out(`${f.cli} is on this computer but did not start.`, 'Installing it again usually fixes this.',
      [install, choose, check, details], installSteps(family, platform));
    default: return out(`We could not check ${f.cli} just now.`, 'Check again in a moment. If it keeps happening, copy the details for support.', [check, details]);   // 'check-failed' and any state this file does not know yet
  }
}
