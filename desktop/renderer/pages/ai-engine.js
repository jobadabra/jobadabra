// The AI engine chooser, one component for the setup wizard's AI step and Settings → Connections → AI: one big Free card first, then two small
// cards, Claude and OpenAI (with their marks), for people with their own account; the one picked opens that family's two cards (API key / its own CLI:
// Claude Code or Codex), the CLI's status block with Verify,
// the in-family plan-limit fallback and the note.
// The user picks; in the wizard nothing is pre-selected, in Settings the choice is remembered and switching is instant.
import {refreshClaudeHelp} from '../claude-help.js';
import {choiceCards, el, pill} from '../components.js';
import {icon} from '../icons.js';
import {API_OF, CLI_OF, FAMILY_CARDS, TEXT, afterClick, chosen, cliStatus, defaultMethod, familyOf, fallbackOn, ownKeys, selection, showFallback, statusLines} from '../ai-engine-view.js';
import {applyAiNames} from '../ai-name.js';
import {FAMILY, guide} from '../ai-plan-guide.js';
import {planCard} from '../ai-plan-card.js';
import {shared} from './shared.js';

const hasKey = () => !!ownKeys(shared.state).ANTHROPIC_API_KEY;
const hasOpenAiKey = () => !!ownKeys(shared.state).OPENAI_API_KEY;
const COMPANY_LOGO = {claude: 'anthropic', openai: 'openai'};   // the companies' own marks (renderer/assets/ai/)
const ICONS = {api: 'key', cli: 'terminal', openai: 'key', codex: 'terminal'};
export const RECHECK_MS = 3000;   // how often a missing CLI is looked for again while its chooser is on screen
// The family's own CLI, in words and through its IPC (Claude Code / Codex).
const CLI = {claude: {name: 'Claude Code CLI', short: 'Claude Code', status: () => window.pilot.claudeCodeStatus(), verify: () => window.pilot.verifyClaudeCode()},
  openai: {name: 'Codex CLI', short: 'Codex', status: () => window.pilot.codexStatus(), verify: () => window.pilot.verifyCodex()}};

// mountEngine(box, {context: 'wizard' | 'settings', onChange(picked)}) -> {picked(), refresh()}
export function mountEngine(box, {context = 'settings', onChange = () => {}} = {}) {
  let picked = chosen(shared.state?.settings, hasKey(), context), busy = false, problem = '', copied = false;
  let family = picked && picked !== 'free' ? familyOf(picked) : null;   // null: no family open (Free picked, or nothing yet)
  const statuses = {claude: null, openai: null};   // each family's CLI, found and verified separately
  const statusOf = () => statuses[family];   // family is null while Free leads: nothing to read
  // The two small family cards under Free (owner, 16 Oct 2026; was a Claude | OpenAI switch): picking one opens that family's two cards, it picks no engine.
  const familyCards = () => {
    const cards = choiceCards(Object.entries(TEXT.families).map(([id, title]) => ({id: `family-${id}`, logo: COMPANY_LOGO[id], title, size: 'compact',
      text: TEXT.familyHint[id]})), {selected: family && `family-${family}`, label: TEXT.ownAccount, onPick: choice => {
      const id = choice.replace('family-', '');
      if (family !== id) {
        ({picked, family} = afterClick({picked, family}, choice)); problem = ''; render();
        pick(defaultMethod(id, {saved: chosen(shared.state?.settings, hasKey(), context), cliUsable: cliStatus(statusOf(), id).usable}));   // and its method, so one card carries the check
      }   // one selection: Free and the other family's pick let go
    }});
    cards.classList.add('is-pair');
    return cards;
  };
  const render = () => {
    const cli = cliStatus(family && statusOf(), family || 'claude');
    const status = family && statusOf();
    const chosenCards = selection({picked, family}).cards;   // (the offer banner "run these tasks on your own Claude Code" is gone: the subscription card is first now)
    // Free leads: one big card (owner, 16 Oct 2026: most early users are not technical), in the wizard and in Settings.
    const free = choiceCards([{id: 'free', icon: 'sparkle', title: TEXT.free.title, size: 'hero', text: context === 'settings' ? TEXT.free.short : TEXT.free.text}],
      {selected: chosenCards.includes('free') ? 'free' : null, onPick: pick, label: TEXT.free.title});
    free.classList.add('is-single');
    // The engine cards of the open family (API key / its own CLI), only once a family is open.
    const cards = family ? choiceCards(FAMILY_CARDS[family].map(id => ({id, icon: ICONS[id], title: TEXT[id].title, text: context === 'settings' ? TEXT[id].short : TEXT[id].text,
      note: id === CLI_OF[family] && status && ['app-only', 'nothing', 'elsewhere', 'broken'].includes(status.state) ? `Needs ${FAMILY[family].cli}` : ''})), {selected: chosenCards.find(id => FAMILY_CARDS[family].includes(id)), onPick: pick, label: TEXT.title}) : null;
    // Settings: the key box under the chooser shows only for the API key card of the open family (owner, 16 Oct 2026: hide technical details until asked).
    if (context === 'settings') for (const foot of document.querySelectorAll('#setting-ai [data-family]')) foot.hidden = selection({picked, family}).keyBox !== API_OF[foot.dataset.family] || foot.dataset.family !== family;
    const head = el('div', 'engine-head');
    head.append(el('h3', '', TEXT.title), el('p', 'muted small', context === 'settings' ? TEXT.settingsSubtitle : TEXT.subtitle));
    const parts = [head];
    parts.push(free, el('p', 'muted small engine-own', TEXT.ownAccount), familyCards(), el('p', 'muted small engine-quality', TEXT.ownQuality));
    if (cards) parts.push(cards);
    if (selection({picked, family}).note) parts.push(cliNote());   // what the old confirm said, now a note under the selected card
    // Only the picked subscription card says more: one line (ready, or what is missing), the rest folded under "More about this".
    const aboutCli = !!family && picked === CLI_OF[family];
    if (aboutCli) parts.push(cli.checking || busy ? statusBlock(cli) : planBlock(status));
    if (aboutCli && copied) parts.push(el('p', 'muted small', 'Details copied. Paste them into your message to support.'));
    if (problem) parts.push(el('p', 'message error', problem));   // our own words only (a file refused, Free AI could not start): never a CLI's raw message
    if (aboutCli && cli.usable) parts.push(moreAbout(cli));
    box.replaceChildren(...parts);
  };
  // One readiness state, drawn from lib/plan-readiness.js (the status carries it): the words and the one next step are renderer/ai-plan-guide.js.
  const stateOf = found => found.state || (found.installed ? (found.authenticated ? 'ready' : 'sign-in') : 'nothing');
  const planBlock = found => planCard(guide(stateOf(found), {family, platform: window.pilot.platform, inApp: false}), {onAction: act});
  const REFUSED = {'not-the-cli': file => `That is not ${file}. Choose the ${file} file.`, 'did-not-start': () => 'That file did not start. Choose another one.'};
  async function act(id) {
    const which = family;
    problem = ''; copied = false;
    if (id === 'check') return check();
    if (id === 'free') return pick('free');
    if (id === 'install') await window.pilot.planOpenGuide(which);
    else if (id === 'install-git') await window.pilot.planOpenGuide('git');
    else if (id === 'details') { copied = await navigator.clipboard?.writeText(await window.pilot.planSupportDetails(which)).then(() => true, () => false) ?? false; }
    else if (id === 'choose-file') {
      const result = await window.pilot.planChooseFile(which);
      if (result.ok) { statuses[which] = result.status; onChange(picked); if (picked === CLI_OF[which] && !result.status.authenticated) return check(); }
      else if (REFUSED[result.reason]) problem = REFUSED[result.reason](`${FAMILY[which].file}${window.pilot.platform === 'win32' ? '.exe' : ''}`);
    }
    render();
  }
  const statusBlock = cli => {
    const block = el('div', 'engine-status');  // one tinted line: ready, or what is missing, then "Check again"
    const row = el('div', 'engine-status-row');
    const again = el('button', 'link', busy ? 'Checking…' : 'Check again');
    Object.assign(again, {type: 'button', disabled: busy});
    again.addEventListener('click', () => check());
    const lines = el('div', 'engine-status-lines');
    for (const line of statusLines(cli, busy)) lines.append(pill(line.text, line.tone, {dot: true}));
    row.append(el('b', '', CLI[family].short), lines, again);
    block.append(row);
    return block;
  };
  // The technical rest, folded: version and path, how it is billed, and the plan-limit fallback.
  const moreAbout = cli => {
    const details = el('details', 'engine-details plain');
    details.append(el('summary', 'small', 'More about this'));
    for (const line of cli.lines.filter(each => each.tone === 'good')) details.append(el('p', 'muted small', line.text));
    if (cli.path) details.append(el('code', 'engine-path', cli.path));
    details.append(el('p', 'muted small engine-note', family === 'openai' ? TEXT.codexNote : TEXT.note));
    if (showFallback(picked, hasKey(), hasOpenAiKey()) && familyOf(picked) === family) details.append(fallbackRow());
    return details;
  };
  const fallbackRow = () => {
    const label = el('label', 'check-row');
    const box = Object.assign(document.createElement('input'), {type: 'checkbox', checked: fallbackOn(shared.state?.settings)});
    box.addEventListener('change', async () => { shared.state.settings = await window.pilot.setAiFallback(box.checked); });
    const words = el('span');
    words.append(el('span', '', family === 'openai' ? TEXT.codexFallback : TEXT.fallback), el('span', 'muted small', TEXT.fallbackHint));
    label.append(box, words);
    return label;
  };
  // The CLI card's words, under the selected card (owner, 24 Oct 2026: a click selects, it is not a gate).
  const cliNote = () => {
    const note = el('div', 'alert tone-warn engine-notice');
    note.append(icon('info'), el('p', '', family === 'openai' ? TEXT.codexNotice : TEXT.notice));
    return note;
  };
  async function check() {
    busy = true; problem = ''; render();
    const which = family;
    try { statuses[which] = await CLI[which].verify(); } catch { statuses[which] = {...statuses[which], installed: !!statuses[which]?.installed, authenticated: false, state: 'check-failed'}; }   // a failed check is a state, never its message
    busy = false;
    render();
    return cliStatus(statuses[which], which).usable;
  }
  async function pick(id) {
    problem = ''; copied = false;
    if (id === 'cli' || id === 'codex') {
      ({picked, family} = afterClick({picked, family}, id)); render();   // selected at once; Settings saves it only once it can run
      if (!cliStatus(statusOf(), family).usable && !(await check())) { render(); onChange(picked); return; }
    }
    if (id === 'free' && context === 'settings') {   // Free needs this install's token first; the wizard does it on Continue
      const started = await window.pilot.startFreeAi();
      if (!started.ok) { problem = started.error; render(); return; }
      shared.state.secrets = {...shared.state.secrets, ANTHROPIC_API_KEY: true};
    }
    ({picked, family} = afterClick({picked, family}, id));
    if (context === 'settings') {
      const wasFree = chosen(shared.state?.settings, hasKey(), context) === 'free';
      shared.state.settings = await window.pilot.setAiEngine(id === 'free' ? 'api' : id);  // instant, reversible
      if (wasFree && id === 'api') shared.state.secrets = {...shared.state.secrets, ANTHROPIC_API_KEY: false};   // leaving Free forgot its token: the key box is empty
    }
    else if (id === 'cli') shared.state.settings = {...shared.state.settings, claudeCodeNotice: true};
    else if (id === 'codex') shared.state.settings = {...shared.state.settings, codexNotice: true};
    applyAiNames();   // the window's static texts name the new engine at once
    window.dispatchEvent(new Event('claude-help'));   // and every Claude entry point (Jobs ⋯, Apply dialog, sessions) shows or hides with the family
    refreshClaudeHelp();
    render();
    onChange(picked);
  }
  render();
  // Each CLI's status is read now and again whenever it could have changed: the window regains focus (the user came back from installing it),
  // and every few seconds while one is still missing. Installing Codex or Claude Code never needs an app restart.
  // `again`: the window regained focus, so a CLI that was not ready is checked for real (free for a signed-out one: no AI call, lib/plan-login.js); the timer only re-reads files.
  const recheck = (again = false) => {
    if (busy) return;   // a Verify in progress owns the status
    for (const which of Object.keys(CLI)) {
      if (again === true && family === which && ['sign-in', 'check-failed', 'broken'].includes(statuses[which]?.state)) { check(); continue; }
      CLI[which].status().then(found => {
        if (busy || JSON.stringify(found) === JSON.stringify(statuses[which])) return;
        statuses[which] = found; render(); onChange(picked);
        if (found.state === 'checking' && family === which) check();   // found but never checked: one real check decides signed in or not (no guess from a file)
      }, () => { if (!statuses[which]) { statuses[which] = {installed: false}; render(); } });
    }
  };
  recheck();
  const watch = () => { if (!box.isConnected) { clearInterval(timer); removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisible); } };
  const onFocus = () => recheck(true);
  const onVisible = () => { if (!document.hidden) recheck(true); };
  const timer = setInterval(() => { watch(); if (box.isConnected && Object.values(statuses).some(found => !found?.installed)) recheck(); }, RECHECK_MS);
  addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisible);
  return {picked: () => picked, family: () => family, status: () => statuses[familyOf(picked || CLI_OF[family])],
    refresh: () => { picked = chosen(shared.state?.settings, hasKey(), context) || picked; if (picked === 'free') family = null; else if (picked) family = familyOf(picked); render(); }};
}

// Settings → Connections → AI: the same chooser, mounted once, redrawn each time Settings loads.
let settingsChooser = null;
export function showEngineSettings() {
  const box = document.getElementById('ai-engine-settings');
  if (!box) return;
  if (settingsChooser) settingsChooser.refresh(); else settingsChooser = mountEngine(box, {context: 'settings'});
}
