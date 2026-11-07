// Startup/change refresh uses fake transports, skips demo and updates only the user's notification-language repository variable.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {payload} from '../../../lib/github.js';
import {refreshDeliveryLanguage, refreshScheduledLanguage} from '../../../lib/notification-refresh.js';

test('scheduled refresh writes one resolved variable without touching secrets, workflows or preferences', async () => {
  const calls = [], settings = {displayLanguage: 'ro', cloud: {repo: 'fictional/always-on', enabled: false}};
  const storage = {settings: () => settings, secret: name => { assert.equal(name, 'GITHUB_TOKEN'); return 'fake-token'; }, saveSettings: () => assert.fail('no preference writes')};
  const fetcher = async (url, init) => { calls.push({url, method: init.method, body: JSON.parse(init.body)}); return {ok: true, status: 201, json: async () => ({})}; };
  assert.equal((await refreshScheduledLanguage(storage, fetcher)).ok, true);
  assert.deepEqual(calls, [{url: 'https://api.github.com/repos/fictional/always-on/actions/variables', method: 'POST', body: {name: 'JOBADABRA_NOTIFICATION_LANGUAGE', value: 'ro'}}]);
  assert.equal(settings.cloud.enabled, false);
});

test('demo skips all transport work; a service failure never prevents the scheduled refresh or a later normal retry', async () => {
  const storage = {settings: () => ({})}, calls = [];
  const service = () => { calls.push('service'); if (calls.length <= 2) throw new Error('fictional cache failure'); return {ok: true}; };
  const scheduled = async () => { calls.push('scheduled'); return {ok: true}; };
  assert.deepEqual(await refreshDeliveryLanguage(storage, {demo: true, service, scheduled}), {ok: true, skipped: true});
  assert.deepEqual(calls, []);
  assert.equal((await refreshDeliveryLanguage(storage, {service, scheduled})).ok, false);
  assert.equal((await refreshDeliveryLanguage(storage, {service, scheduled})).ok, true);
  assert.deepEqual(calls, ['service', 'scheduled', 'service', 'scheduled']);
});

test('the initial repository payload and both scheduled workflows carry the same display-language variable', () => {
  const storage = {settings: () => ({displayLanguage: 'it', telemetryId: 'fictional-id'}), secret: () => '', readText: () => '', saveSettings: () => assert.fail('fixture already has its install ID')};
  assert.equal(payload(storage).variables.JOBADABRA_NOTIFICATION_LANGUAGE, 'it');
  for (const workflow of ['daily', 'mail']) {
    const source = fs.readFileSync(new URL(`../../../../.github/workflows/${workflow}.yml`, import.meta.url), 'utf8');
    assert.ok(source.includes('JOBADABRA_NOTIFICATION_LANGUAGE: ${{ vars.JOBADABRA_NOTIFICATION_LANGUAGE }}'));
  }
});

test('an explicit language change refreshes the deployed bot while startup leaves that work to the existing startup owner', async () => {
  const storage = {settings: () => ({})}, calls = [];
  const service = async () => ({ok: true}), scheduled = async () => ({ok: true});
  const bot = async () => { calls.push('bot'); return {ok: true}; };
  await refreshDeliveryLanguage(storage, {service, scheduled, bot});
  assert.deepEqual(calls, []);
  await refreshDeliveryLanguage(storage, {service, scheduled, bot, cloud: true});
  assert.deepEqual(calls, ['bot']);
});
