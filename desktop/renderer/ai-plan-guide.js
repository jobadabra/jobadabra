// The words and buttons of each readiness state of the person's own AI plan (Claude Code for a Claude plan, Codex for a ChatGPT plan), for Windows and Mac. Pure: lib/plan-readiness.js
// decides the state, this file says it in plain words with one next step, pages/ai-engine.js draws it. Never a path, an exit code or a raw message: that stays in "Copy details for support".
// Why (2 Nov 2026, owner, a Windows tester who had only the Claude app): "We should never show a raw error. We should handle it properly. If the user has ChatGPT desktop or Claude Desktop,
// we should say explicitly: we detected the app, but the CLI is still missing. Please install using this guide."
// The install lines are the official ones: Claude Code from code.claude.com/docs/en/setup, Codex from the openai/codex README (checked 2 Nov 2026).
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
export const FAMILY = {
  claude: {app: t('helpers.claudeApp'), cli: 'Claude Code', plan: t('helpers.claudePlan'), account: t('helpers.claudeAccount'), file: 'claude', run: 'claude', page: 'https://code.claude.com/docs/en/setup',
    command: {win32: 'irm https://claude.ai/install.ps1 | iex', darwin: 'curl -fsSL https://claude.ai/install.sh | bash'}},
  openai: {app: t('helpers.chatgptApp'), cli: 'Codex', plan: t('helpers.chatgptPlan'), account: t('helpers.chatgptAccount'), file: 'codex', run: 'codex', page: 'https://developers.openai.com/codex/cli',
    command: {win32: 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"', darwin: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh'}},
};
export const GIT_PAGE = 'https://git-scm.com/downloads/win';
export const STATE_TONE = {checking: 'info', ready: 'good', limit: 'good', 'sign-in': 'warn', 'needs-git': 'warn', 'app-only': 'info', nothing: 'info', elsewhere: 'warn', broken: 'warn', 'check-failed': 'warn'};

const where = platform => (platform === 'win32' ? t('helpers.powershell') : t('helpers.terminal'));
const commandOf = (family, platform) => FAMILY[family].command[platform === 'win32' ? 'win32' : 'darwin'];
// The numbered install steps, shown beside the Install button and kept when it fails.
function installSteps(family, platform) {
  const f = FAMILY[family];
  return {steps: [t('helpers.openShell', {shell: where(platform)}), t('helpers.pasteInstall'), t('helpers.backDetect', {cli: f.cli})], command: commandOf(family, platform), page: f.page};
}
function signInSteps(family, platform) {
  const f = FAMILY[family];
  return {steps: [t('helpers.openShell', {shell: where(platform)}), t('helpers.typeSignIn', {account: f.account}), t('helpers.backDetectAny')], command: f.run};
}

/**
 * state, {family, platform, inApp} -> {state, tone, title, text, steps, command, actions: [{id, label, primary}]}
 * inApp: the in-app buttons (install, sign in) exist; without them the first button opens the official page and the numbered steps carry the install.
 * Action ids the page wires: install, install-git, sign-in, free, choose-file, check, details.
 */
export function guide(state, {family = 'claude', platform = 'darwin', inApp = false} = {}) {
  const f = FAMILY[family], file = `${f.file}${platform === 'win32' ? '.exe' : ''}`;
  const act = (id, label, primary = false) => ({id, label, primary});
  const choose = act('choose-file', t('helpers.chooseInstalled', {file}));
  const check = act('check', t('helpers.checkAgain')), details = act('details', t('helpers.copySupport'));
  const install = act('install', inApp ? t('helpers.installCli', {cli: f.cli}) : t('helpers.installPage'), true);
  const out = (title, text, actions, extra = {}) => ({state, tone: STATE_TONE[state], title, text, steps: [], command: '', actions, ...extra});
  switch (state) {
    case 'checking': return out(t('helpers.checkingCli', {cli: f.cli}), '', []);
    case 'ready': return out(t('helpers.readyPlan', {plan: f.plan}), '', []);
    case 'limit': return out(t('helpers.planLimit', {plan: f.plan}), t('helpers.resetRetry'), []);
    case 'app-only': return out(t('helpers.foundApp', {app: f.app, cli: f.cli}),
      t('helpers.needsCli', {cli: f.cli, account: f.account}), [install, choose, check, details], installSteps(family, platform));
    case 'nothing': return out(t('helpers.cliMissing', {cli: f.cli}),
      t('helpers.cliPlan', {cli: f.cli, plan: f.plan}),
      [install, act('free', t('helpers.useFree')), choose, check, details], installSteps(family, platform));
    case 'sign-in': return out(t('helpers.cliSignIn', {cli: f.cli, account: f.account}),
      t('helpers.providerSignIn', {provider: family === 'claude' ? 'Anthropic' : 'OpenAI'}),
      [...(inApp ? [act('sign-in', t('helpers.signIn'), true)] : []), check, details], inApp ? {} : signInSteps(family, platform));
    case 'needs-git': return out(t('helpers.cliGit', {cli: f.cli}), t('helpers.installGitOnce'),
      [act('install-git', inApp ? t('helpers.installGit') : t('helpers.gitPage'), true), check, details], inApp ? {} : {page: GIT_PAGE});
    case 'elsewhere': return out(t('helpers.cliGone', {cli: f.cli}), t('helpers.chooseAgain', {cli: f.cli}),
      [act('choose-file', t('helpers.chooseFile', {file}), true), install.primary ? {...install, primary: false} : install, check, details]);
    case 'broken': return out(t('helpers.cliBroken', {cli: f.cli}), t('helpers.reinstallFix'),
      [install, choose, check, details], installSteps(family, platform));
    default: return out(t('helpers.cannotCheckCli', {cli: f.cli}), t('helpers.checkSupport'), [check, details]);   // 'check-failed' and any state this file does not know yet
  }
}
