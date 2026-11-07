// Apply with Claude prerequisites: what only the user can install, shown in Settings when Claude help is available.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {resumeOffered} from '../claude-help.js';
import {icon} from '../icons.js';

export async function showClaudePrereqs() {
  const inSettings = document.getElementById('claude-prereqs-settings');
  if (inSettings) inSettings.hidden = !resumeOffered();
  if (!resumeOffered()) return;   // nothing to check while Claude help is off
  const found = await window.pilot.claudePrereqs().catch(() => null);
  if (!found) return;
  const link = (href, text) => Object.assign(document.createElement('a'), {href, target: '_blank', textContent: text});
  const items = [
    [found.claude, t('pagesFinalLabels.claudeInstalled'), link('https://code.claude.com/docs/en/setup', t('pagesFinalLabels.installClaude'))],
    [found.signedIn, t('pagesFinalLabels.claudeSigned'), document.createTextNode(t('pagesFinalLabels.claudeSteps'))],
    ...(found.windows ? [[found.git, t('pagesFinalLabels.gitInstalled'), link('https://git-scm.com/downloads/win', t('pagesFinalLabels.installGit'))]] : []),
    [found.chrome, found.chrome ? t('pagesFinalLabels.chromeClaudeAdded') : t('pagesFinalLabels.chromeClaudeSigned'),
      link('https://chromewebstore.google.com/search/Claude', t('pagesFinalLabels.getStore'))],
    // Built into the app (nothing to install): sessions run inside Jobadabra; without it, in Terminal windows.
    [found.inApp, found.inApp ? t('pagesFinalLabels.terminalReady') : t('pagesFinalLabels.terminalUnavailable'),
      document.createTextNode(t('pagesFinalLabels.terminalFallback'))],
  ];
  const draw = () => items.map(([done, text, action]) => {
    const li = document.createElement('li');
    li.className = done ? 'done' : '';
    const words = document.createElement('span');
    words.append(text);
    if (!done) words.append(' · ', action.cloneNode(true));
    li.append(icon(done ? 'check-circle' : 'info'), words);
    return li;
  });
  if (inSettings) inSettings.replaceChildren(...draw());
}
window.addEventListener('claude-help', () => showClaudePrereqs());   // the switch turned on in Settings: what to install shows under it at once

// A windowless Chrome from an earlier automation holds macOS's one Apple Event connection to Chrome, so the app
