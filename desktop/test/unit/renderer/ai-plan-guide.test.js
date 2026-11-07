// The words of every readiness state (renderer/ai-plan-guide.js): both families, both systems, with and without the in-app buttons. Each state has a title and at most one primary button, the
// install states carry the numbered official steps, and no raw text (a path, an exit code, a stack, "Looked in", winget) is ever drawn.
// Why (2 Nov 2026, owner): "We should never show a raw error."
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {STATES} from '../../../lib/plan-readiness.js';
import {FAMILY, STATE_TONE, guide} from '../../../renderer/ai-plan-guide.js';

const every = [];
for (const state of STATES) for (const family of Object.keys(FAMILY)) for (const platform of ['win32', 'darwin']) for (const inApp of [false, true]) every.push({state, family, platform, inApp});
const words = g => [g.title, g.text, ...g.steps, ...g.actions.map(a => a.label)].join('\n');   // (the command line is quoted code, checked apart)

test('every state, family, system and button mode has a title, a tone, and at most one primary button', () => {
  for (const options of every) {
    const g = guide(options.state, options);
    assert.ok(g.title && STATE_TONE[g.state], JSON.stringify(options));
    assert.ok(g.actions.filter(a => a.primary).length <= 1, `two primary buttons: ${JSON.stringify(options)}`);
    if (!['ready', 'limit', 'checking'].includes(g.state)) assert.ok(g.actions.some(a => a.id === 'check') && g.actions.some(a => a.id === 'details'), `no way out: ${JSON.stringify(options)}`);
  }
});

test('no raw text reaches the screen: no path, exit code, stack, folder list or winget, in any state', () => {
  const RAW = /[A-Za-z]:\\|\/Users\/|\/home\/|ENOENT|EACCES|exit code|exit \d|stack|Error:|undefined|\[object|Looked in|winget|spawn |\.local[\\/]bin/i;
  for (const options of every) assert.doesNotMatch(words(guide(options.state, options)), RAW, JSON.stringify(options));
});

test('only the Claude Desktop app is found: the words say so explicitly and name what is missing (Windows and Mac, Claude and ChatGPT)', () => {
  for (const platform of ['win32', 'darwin']) {
    assert.match(guide('app-only', {family: 'claude', platform}).title, /^We found the Claude Desktop app on this computer, but Claude Code \(its command-line part\) is still missing\.$/);
    assert.match(guide('app-only', {family: 'openai', platform}).title, /^We found the ChatGPT app on this computer, but Codex \(its command-line part\) is still missing\.$/);
  }
});

test('the install states give three numbered steps and the official line of the system and family', () => {
  const line = (family, platform) => guide('app-only', {family, platform}).command;
  assert.equal(line('claude', 'win32'), 'irm https://claude.ai/install.ps1 | iex');
  assert.equal(line('claude', 'darwin'), 'curl -fsSL https://claude.ai/install.sh | bash');
  assert.equal(line('openai', 'win32'), 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"');
  assert.equal(line('openai', 'darwin'), 'curl -fsSL https://chatgpt.com/codex/install.sh | sh');
  for (const state of ['app-only', 'nothing', 'broken']) assert.equal(guide(state, {platform: 'win32'}).steps.length, 3);
  assert.match(guide('app-only', {platform: 'win32'}).steps[0], /PowerShell/);
  assert.match(guide('app-only', {platform: 'darwin'}).steps[0], /Terminal/);
});

test('"nothing" offers Free AI beside Install; "only the app" does not push it', () => {
  assert.ok(guide('nothing', {inApp: true}).actions.some(a => a.id === 'free'));
  assert.ok(!guide('app-only', {inApp: true}).actions.some(a => a.id === 'free'));
  assert.equal(guide('nothing', {inApp: true}).actions.find(a => a.primary).label, 'Install Claude Code');
  assert.equal(guide('nothing', {inApp: false}).actions.find(a => a.primary).label, 'Open the install page');
});

test('the file picker names the file by system and family', () => {
  assert.ok(guide('app-only', {family: 'claude', platform: 'win32'}).actions.some(a => a.label === 'Already installed? Choose claude.exe'));
  assert.ok(guide('app-only', {family: 'openai', platform: 'darwin'}).actions.some(a => a.label === 'Already installed? Choose codex'));
});

test('the outdated "Always on still uses your API key" sentence is gone from every text the chooser and the engine notice say', () => {
  for (const file of ['../../../lib/claude-code.js', '../../../renderer/ai-engine-view.js', '../../../renderer/index.html', '../../../renderer/ai-plan-guide.js', '../../../lib/ai/codex-cli.js']) {
    const text = readScreenSource(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /Always on\) still use|Always on \(GitHub\)|requires an API key, regardless|Scheduled runs in your GitHub repository|Scheduled runs \(Always on\) still use/, file);
  }
});

test('the chooser: while a check runs only "Checking…" shows; only the person\'s own keys count as a key (review of [cc] 1/2)', async () => {
  const {statusLines, ownKeys, cliStatus} = await import('../../../renderer/ai-engine-view.js');
  const old = cliStatus({installed: false}, 'claude');
  assert.deepEqual(statusLines(old, true), [{tone: 'neutral', text: 'Checking…'}], 'the last answer\'s words ("Not installed on this Mac") are old');
  assert.ok(statusLines(old, false).length);
  assert.deepEqual(statusLines({usable: true, lines: []}, true), [{tone: 'good', text: 'Ready to use'}]);
  assert.equal(ownKeys({secrets: {ANTHROPIC_API_KEY: true}, ownSecrets: {ANTHROPIC_API_KEY: false}}).ANTHROPIC_API_KEY, false, 'Free AI\'s token is not a key');
  assert.equal(ownKeys({secrets: {ANTHROPIC_API_KEY: true}}).ANTHROPIC_API_KEY, true, 'a state without ownSecrets (older window) reads secrets');
  const page = readScreenSource(new URL('../../../renderer/pages/ai-engine.js', import.meta.url), 'utf8');
  assert.match(page, /if \(aboutCli && copied\)/, 'the copied note belongs to the CLI card');
  assert.match(page, /async function pick\(id\) \{\n    problem = ''; copied = false;/);
});
