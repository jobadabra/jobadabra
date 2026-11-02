// "✓ Connected" on the API key card means the person's OWN key is saved, never Free AI's token (JPF1.…), which lib/ai-free.js keeps in the same slot (ANTHROPIC_API_KEY).
// Why (2 Nov 2026, owner, a Windows tester): "How it can show Connected on the API key if no API is set." The only code that fills that slot without the person typing is Free AI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {ownSecretHints, ownSecretsPresent} from '../lib/secrets.js';

const storage = secrets => ({secretsPresent: () => Object.fromEntries(Object.keys({ANTHROPIC_API_KEY: 1, OPENAI_API_KEY: 1, NOTION_TOKEN: 1}).map(name => [name, !!secrets[name]])), secret: name => secrets[name] || ''});

test('a Free AI token in the API key slot is not shown as the person\'s key', () => {
  const held = storage({ANTHROPIC_API_KEY: 'JPF1.install-1.dG9rZW4tZGF0YQ-CwAA', NOTION_TOKEN: 'ntn_x'});
  assert.equal(held.secretsPresent().ANTHROPIC_API_KEY, true, 'the app still holds it (Free AI uses it)');
  assert.deepEqual(ownSecretsPresent(held), {ANTHROPIC_API_KEY: false, OPENAI_API_KEY: false, NOTION_TOKEN: true});
  assert.equal(ownSecretHints(held).ANTHROPIC_API_KEY, undefined, 'no "••••CwAA · saved" for a token that is not theirs');
  assert.ok(ownSecretHints(held).NOTION_TOKEN);
});

test('the founder key of the older credit (JP1.…) is ours too, a typed key is theirs', () => {
  assert.equal(ownSecretsPresent(storage({ANTHROPIC_API_KEY: 'JP1.old.token'})).ANTHROPIC_API_KEY, false);
  const own = storage({ANTHROPIC_API_KEY: 'sk-ant-api03-typed'});
  assert.equal(ownSecretsPresent(own).ANTHROPIC_API_KEY, true);
  assert.match(ownSecretHints(own).ANTHROPIC_API_KEY, /^•{12}ped$|^•{12}.{4}$/);
});

test('the window\'s state carries ownSecrets and Settings\' "Connected" line reads it (the hints come already filtered from the handler)', () => {
  assert.match(fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8'), /ownSecrets: ownSecretsPresent\(storage\)/);
  assert.match(fs.readFileSync(new URL('../renderer/pages/profile.js', import.meta.url), 'utf8'), /\(shared\.state\.ownSecrets \|\| shared\.state\.secrets\)\[line\.dataset\.secret\]/);
});

// The upgraded install of the Windows tester, on a real data folder (the store's own files, no fake): Free AI on, the Claude Code card picked, Free AI's token in secrets.json.
test('an installed copy with Free AI on and its token saved: the window\'s state says no own key, the hint is empty (real storage on disk)', async () => {
  const {default: os} = await import('node:os'), {default: path} = await import('node:path');
  const {createStorage} = await import('../lib/storage.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-secrets-'));
  try {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({setupDone: true, aiFree: true, aiEngine: 'cli'}));
    const store = createStorage(dir, {encrypt: value => value, decrypt: value => value});
    store.setSecret('ANTHROPIC_API_KEY', 'JPF1.8a1f.q3VnZk1hcmtlcg-CwAA');
    assert.equal(store.secretsPresent().ANTHROPIC_API_KEY, true, 'the app holds Free AI\'s token (that is what the old line read)');
    assert.equal(ownSecretsPresent(store).ANTHROPIC_API_KEY, false, 'the API key card must not say Connected');
    assert.deepEqual(ownSecretHints(store), {});
    store.setSecret('ANTHROPIC_API_KEY', 'sk-ant-api03-own-key-AAAA');   // the person pastes their own key: now it is theirs
    assert.equal(ownSecretsPresent(store).ANTHROPIC_API_KEY, true);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('the app passes itself to the setup handlers, so "Copy details" names the real version', () => {
  assert.match(fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8'), /registerSetupHandlers\(\{app, /);
});

test('the window\'s secretHints answer comes from ownSecretHints, and the wizard reads the person\'s own key (review of #3014: the wizard still said "Your key is saved" for Free AI\'s token)', () => {
  const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  assert.match(read('../lib/apply-handlers.js'), /ipcMain\.handle\('secretHints', \(\) => ownSecretHints\(storage\)\)/);
  const wizard = read('../renderer/pages/wizard.js');
  assert.doesNotMatch(wizard, /secrets\.ANTHROPIC_API_KEY && !\$\('anthropic-key'\)\.value/);
  assert.match(wizard, /ownKeys\(shared\.state\)\.ANTHROPIC_API_KEY && !\$\('anthropic-key'\)\.value/);
});

test('a window focus re-verifies only a CLI that said "signed out" (free); a failed or unknown check never costs a paid call per focus (review of #3014)', () => {
  const page = fs.readFileSync(new URL('../renderer/pages/ai-engine.js', import.meta.url), 'utf8');
  assert.match(page, /again === true && family === which && statuses\[which\]\?\.state === 'sign-in' && statuses\[which\]\?\.login === 'signed-out'/);
  assert.doesNotMatch(page, /\['sign-in', 'check-failed', 'broken'\]\.includes/);
});
