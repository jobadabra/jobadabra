// Always on shares the free trial with the app (16 Oct 2026): a Free AI install's runs use its own key and lane; any install sends its trial key, first-run day and license to the repo.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {TRIAL_KEY, ensureTrialKey} from '../../../lib/ai-free.js';
import * as github from '../../../lib/github.js';
import {SECRET_NAMES} from '../../../lib/storage.js';
import {strictSetSecret} from '../../strict-set-secret.js';

const FREE = 'JPF1.install-0001.abcd', OWN = 'sk-ant-own', OLD = 'JP1.old.credit';
const store = (settings, secrets) => ({settings: () => settings, saveSettings: () => {}, readText: () => '', secret: name => secrets[name] || '', setSecret: strictSetSecret((name, value) => { secrets[name] = value; })});

// Superseded 3 Nov 2026 (owner: no Free AI key on the user's GitHub): the old tests sent the Free AI key and address; test/guards/safety/no-free-key-on-github.test.js holds the new rules.
test('a Free AI install sends the first-run day, but no AI key and no Free AI address', () => {
  const {secrets, variables} = github.payload(store({aiFree: true, firstRunAt: '2026-10-01T00:00:00.000Z'}, {ANTHROPIC_API_KEY: FREE}));
  assert.equal(secrets.ANTHROPIC_API_KEY, undefined);
  assert.equal(variables.JOBADABRA_AI_BASE_URL, undefined);
  assert.equal(variables.JOBADABRA_FIRST_RUN, '2026-10-01T00:00:00.000Z');
});

test('an own key goes to Anthropic directly; the license still goes, so the wall holds, and the app\'s own trial key does not', () => {
  const {secrets, variables, removed} = github.payload(store({license: {key: 'JP1.a.b'}}, {ANTHROPIC_API_KEY: OWN, [TRIAL_KEY]: FREE}));
  assert.equal(secrets.ANTHROPIC_API_KEY, OWN);
  assert.equal(secrets.JOBADABRA_TRIAL_KEY, undefined);
  assert.equal(secrets.JOBADABRA_LICENSE_KEY, 'JP1.a.b');
  assert.equal(variables.JOBADABRA_AI_BASE_URL, undefined);
  assert.ok(removed.includes('JOBADABRA_AI_BASE_URL') && removed.includes('JOBADABRA_FIRST_RUN'));
});

test('the older credit key (JP1.…) is still never sent as an Anthropic key', () => {
  assert.equal(github.payload(store({}, {ANTHROPIC_API_KEY: OLD})).secrets.ANTHROPIC_API_KEY, undefined);
});

test('ensureTrialKey mints once for an own-key install and never for a Free AI one', async () => {
  const secrets = {ANTHROPIC_API_KEY: OWN}, asked = [];
  const fetcher = async (url, init) => { asked.push([url, JSON.parse(init.body).purpose]); return Response.json({token: 'tok'}); };
  const st = store({}, secrets);
  await ensureTrialKey(st, fetcher);
  await ensureTrialKey(st, fetcher);
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0][1], 'ai');
  assert.match(secrets[TRIAL_KEY], /^JPF1\..+\.tok$/);
  await ensureTrialKey(store({}, {ANTHROPIC_API_KEY: FREE}), () => assert.fail('asked'));
});
