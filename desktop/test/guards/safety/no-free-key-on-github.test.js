// Guard: money + security — a Free AI key (JPF1.<install>.<token>) in a user's GitHub repo spends that install's Free AI budget from outside the app (owner, 3 Nov 2026).
// Spec: docs/superpowers/specs/2026-11-03-no-free-ai-key-on-github.md. Run: node --test test/guards/safety/no-free-key-on-github.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {REPO_KEY, TRIAL_KEY, ensureRepoKey} from '../../../lib/ai-free.js';
import * as github from '../../../lib/github.js';
import {SECRET_NAMES} from '../../../lib/storage.js';
import {createStorage} from '../../../lib/storage.js';
import {bindings} from '../../../lib/telegram-cloud.js';

const FREE = 'JPF1.install-0001.abcd', OWN = 'sk-ant-own', REPO = 'JPT1.0123456789abcdef0123456789abcdef.fedcba9876543210fedcba9876543210';
const store = (settings, secrets) => ({settings: () => settings, saveSettings: patch => Object.assign(settings, patch), readText: () => '', secret: name => secrets[name] || '', setSecret(name, value) { if (!SECRET_NAMES.includes(name)) throw new Error(`Unknown secret ${name}`); secrets[name] = value; }});
const everyValue = ({secrets, variables}) => [...Object.values(secrets), ...Object.values(variables)].map(String);

test('a Free AI install sends no AI key, no Free AI address and no JPF1 anywhere; it asks GitHub to delete the copies', () => {
  const sent = github.payload(store({aiFree: true, firstRunAt: '2026-10-01T00:00:00.000Z'}, {ANTHROPIC_API_KEY: FREE, [REPO_KEY]: REPO}));
  assert.equal(sent.secrets.ANTHROPIC_API_KEY, undefined);
  assert.equal(sent.variables.JOBADABRA_AI_BASE_URL, undefined);
  assert.ok(sent.removed.includes('JOBADABRA_AI_BASE_URL'));
  assert.ok(sent.removedSecrets.includes('ANTHROPIC_API_KEY'));
  assert.equal(sent.secrets.JOBADABRA_TRIAL_KEY, REPO, 'the trial status runs on the repo key');
  assert.equal(sent.variables.JOBADABRA_FIRST_RUN, '2026-10-01T00:00:00.000Z');
  assert.ok(!sent.variables.JOBADABRA_SCORE_MODEL, 'no AI on GitHub until the user adds a key: no model variables');
});

test('an own key goes as before, and the repo key replaces the old trial key', () => {
  const sent = github.payload(store({}, {ANTHROPIC_API_KEY: OWN, [TRIAL_KEY]: FREE, [REPO_KEY]: REPO}));
  assert.equal(sent.secrets.ANTHROPIC_API_KEY, OWN);
  assert.equal(sent.secrets.JOBADABRA_TRIAL_KEY, REPO);
  assert.ok(!sent.removedSecrets.includes('ANTHROPIC_API_KEY'));
  assert.ok(sent.variables.JOBADABRA_SCORE_MODEL);
});

test('no repo key yet: the app\'s own trial key is never sent in its place, and the copy already there is deleted', () => {
  const sent = github.payload(store({}, {ANTHROPIC_API_KEY: OWN, [TRIAL_KEY]: FREE}));
  assert.equal(sent.secrets.JOBADABRA_TRIAL_KEY, undefined);
  assert.ok(sent.removedSecrets.includes('JOBADABRA_TRIAL_KEY'));
});

test('class: whatever the install holds, no value sent to GitHub is a JPF1 key (the older JP1 credit key never goes as an AI key either)', () => {
  for (const secrets of [{ANTHROPIC_API_KEY: FREE}, {ANTHROPIC_API_KEY: FREE, [TRIAL_KEY]: FREE}, {ANTHROPIC_API_KEY: OWN, [TRIAL_KEY]: FREE}, {[TRIAL_KEY]: FREE}, {ANTHROPIC_API_KEY: 'JP1.old.credit'}, {OPENAI_API_KEY: FREE}]) {
    for (const settings of [{aiFree: true}, {}, {license: {key: 'JP1.a.b'}}]) {
      const sent = github.payload(store(settings, {...secrets, [REPO_KEY]: REPO}));
      assert.deepEqual(everyValue(sent).filter(value => /^JPF1\./.test(value)), [], JSON.stringify({secrets, settings}));
      assert.equal(sent.secrets.ANTHROPIC_API_KEY === 'JP1.old.credit', false);
    }
  }
});

// A fake GitHub: every call, and the repo's secrets and variables it holds.
function fakeGitHub(held = {secrets: {ANTHROPIC_API_KEY: 'copied', JOBADABRA_TRIAL_KEY: 'copied'}, variables: {JOBADABRA_AI_BASE_URL: 'https://www.jobadabra.top/api/ai'}}) {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    const method = options.method || 'GET', route = new URL(url).pathname;
    calls.push(`${method} ${route}`);
    const json = (body, status = 200) => new Response(JSON.stringify(body), {status});
    if (route.endsWith('/actions/secrets/public-key')) return json({key: Buffer.alloc(32, 7).toString('base64'), key_id: 'k1'});
    const secret = route.match(/\/actions\/secrets\/([\w]+)$/)?.[1], variable = route.match(/\/actions\/variables\/([\w]+)$/)?.[1];
    if (secret && method === 'PUT') { held.secrets[secret] = 'sealed'; return json({}); }
    if (secret && method === 'DELETE') { const had = secret in held.secrets; delete held.secrets[secret]; return had ? json({}) : json({message: 'Not Found'}, 404); }
    if (variable && method === 'DELETE') { const had = variable in held.variables; delete held.variables[variable]; return had ? json({}) : json({message: 'Not Found'}, 404); }
    if (route.endsWith('/contents/.github/workflows') && method === 'GET') return json([]);
    if (route.includes('/contents/') && method === 'GET') return json({message: 'Not Found'}, 404);
    return json({});
  };
  return {calls, fetcher, held};
}

test('at the next start the copied Free AI key, its address and the old trial key leave the repo; once, named, never valued; the repo key goes in', async () => {
  const settings = {aiFree: true, cloud: {repo: 'me/private'}}, secrets = {GITHUB_TOKEN: 'ghu_x', ANTHROPIC_API_KEY: FREE, [REPO_KEY]: REPO}, storage = store(settings, secrets);
  const gh = fakeGitHub();
  const changed = await github.updateRepo(storage, {fetcher: gh.fetcher});
  assert.ok(!('ANTHROPIC_API_KEY' in gh.held.secrets) && !('JOBADABRA_AI_BASE_URL' in gh.held.variables));
  assert.equal(gh.held.secrets.JOBADABRA_TRIAL_KEY, 'sealed', 'replaced, not just deleted: the trial status keeps working');
  assert.ok(changed.includes('removed secret ANTHROPIC_API_KEY'), changed.join(', '));
  assert.ok(!changed.join(' ').includes(FREE));
  const again = fakeGitHub({secrets: {...gh.held.secrets}, variables: {}});
  assert.deepEqual((await github.updateRepo(storage, {fetcher: again.fetcher})).filter(name => /secret|variable/.test(name)), []);
  assert.ok(!again.calls.some(call => /actions\/(secrets|variables)/.test(call)), again.calls.join('\n'));
});

test('ensureRepoKey asks the site once with the install\'s own key as proof, keeps the repo key, and ignores any other answer', async () => {
  const secrets = {ANTHROPIC_API_KEY: FREE}, asked = [];
  const answer = body => async (url, init) => { asked.push({url, key: init.headers['x-api-key'], body: JSON.parse(init.body)}); return Response.json(body); };
  const st = store({}, secrets);
  await ensureRepoKey(st, answer({ok: true, key: 'JPF1.install-0001.stolen'}));
  assert.equal(secrets[REPO_KEY], undefined, 'only a JPT1 key is kept');
  await ensureRepoKey(st, answer({ok: true, key: REPO}));
  await ensureRepoKey(st, () => assert.fail('asked again'));
  assert.equal(secrets[REPO_KEY], REPO);
  assert.ok(!JSON.stringify(st.settings()).includes(REPO), 'one copy: the repo key is in the encrypted secret, never in the plain settings file');
  assert.deepEqual(asked[1], {url: 'https://www.jobadabra.top/api/install-token', key: FREE, body: {install: 'install-0001', purpose: 'trial'}});
  await ensureRepoKey(store({}, {}), () => assert.fail('no proof of the install: not asked'));
});

// Why (code review, 3 Nov 2026): an earlier fake store accepted any secret name, so a name missing from lib/storage.js SECRET_NAMES (setSecret throws "Unknown secret") went unseen and the repo key was never kept on a real install.
// The fake above now refuses unknown names like the real storage; this test keeps the real storage in the loop too.
test('on the real storage the repo key and the app\'s trial key can be kept, and ensureRepoKey keeps the key the site returns', async () => {
  const real = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-key-')), {encrypt: v => v, decrypt: v => v});
  real.setSecret('ANTHROPIC_API_KEY', FREE);
  await ensureRepoKey(real, async () => Response.json({ok: true, key: REPO}));
  assert.equal(real.secret(REPO_KEY), REPO);
  real.setSecret(TRIAL_KEY, FREE);
  assert.equal(real.secret(TRIAL_KEY), FREE);
  assert.equal(github.payload(real).secrets.JOBADABRA_TRIAL_KEY, REPO);
});

test('the one-time deletion is part of the digest: the same secrets and variables with different deletions are a different sync', () => {
  const base = {secrets: {A: '1'}, variables: {B: '2'}, removed: ['C']};
  assert.notEqual(github.fingerprint({...base, removedSecrets: ['JOBADABRA_TRIAL_KEY']}), github.fingerprint({...base, removedSecrets: []}));
  assert.equal(github.fingerprint({...base, removedSecrets: ['X', 'Y']}), github.fingerprint({...base, removedSecrets: ['Y', 'X']}));
});

test('the user\'s own Cloudflare Worker never gets a Free AI key either; an own key still goes', () => {
  const worker = key => bindings(store({telegramChatId: 5, cloud: {repo: 'me/private'}}, {TELEGRAM_BOT_TOKEN: 't', ANTHROPIC_API_KEY: key}), 'hook');
  assert.equal(worker(FREE).some(binding => binding.name === 'ANTHROPIC_API_KEY'), false);
  assert.equal(worker(OWN).find(binding => binding.name === 'ANTHROPIC_API_KEY').text, OWN);
});

test('ensureRepoKey never throws when the store refuses the secret (the failure goes to the app log)', async () => {
  const refusing = {...store({}, {ANTHROPIC_API_KEY: FREE}), setSecret() { throw new Error('Unknown secret'); }};
  await assert.doesNotReject(() => ensureRepoKey(refusing, async () => Response.json({ok: true, key: REPO})));
});
