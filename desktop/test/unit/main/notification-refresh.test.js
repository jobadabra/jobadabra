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
  settings.cloud.repo = 'fictional/another';
  await refreshScheduledLanguage(storage, fetcher);
  assert.equal(calls.length, 2, 'another repo requires its own acknowledgement');
  assert.ok(calls[1].url.includes('/repos/fictional/another/'));
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

test('the initial repository payload and all scheduled workflows carry the same display-language variable', () => {
  const storage = {settings: () => ({displayLanguage: 'it', telemetryId: 'fictional-id'}), secret: () => '', readText: () => '', saveSettings: () => assert.fail('fixture already has its install ID')};
  assert.equal(payload(storage).variables.JOBADABRA_NOTIFICATION_LANGUAGE, 'it');
  for (const workflow of ['daily', 'mail', 'scout']) {
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

test('each request in a real bot language redeploy gets a fresh timeout through webhook acknowledgement', async () => {
  const signals = [], settings = {displayLanguage: 'ru', cloud: {repo: 'fictional/always-on'}, telegramChatId: 42, telegramCloud: {deployed: 'old'}};
  const keys = {TELEGRAM_BOT_TOKEN: 'fake-bot', GITHUB_TOKEN: 'fake-gh', CLOUDFLARE_API_TOKEN: 'fake-cf'};
  const storage = {settings: () => settings, secret: name => keys[name] || '', setSecret: (name, value) => { keys[name] = value; }, saveSettings: value => Object.assign(settings, value)};
  const fetcher = async (url, init) => {
    signals.push(init.signal);
    if (url.includes('api.telegram.org')) return new Response(JSON.stringify({ok: true, result: true}));
    const result = url.endsWith('/accounts') ? [{id: 'fictional'}] : url.endsWith('/workers/subdomain') ? {subdomain: 'fictional'} : {};
    return new Response(JSON.stringify({success: true, result}));
  };
  const service = async () => ({ok: true}), scheduled = service;
  assert.equal((await refreshDeliveryLanguage(storage, {cloud: true, fetcher, service, scheduled})).ok, true);
  assert.ok(signals.length >= 5, 'exercise Worker upload and Telegram setWebhook');
  assert.equal(new Set(signals).size, signals.length, 'each request owns its timeout instead of sharing the deployment deadline');
  assert.notEqual(settings.telegramCloud.deployed, 'old');
});
