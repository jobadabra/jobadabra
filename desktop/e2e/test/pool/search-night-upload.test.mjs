// Job: report health
// Guard: the nightly Search check's verdict reaches the Admin store (owner, 6 Nov 2026: "Am I getting alerted? I'm not alerted"): sent with CI's key and the UTC night, nothing leaves the Mac without it (a local run sends nothing),
// a refused or unreachable site is one line and never throws, and the line carries counts only. The route itself is guarded in jobadabra-web (test/unit/admin/search/search-night.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MAX_BYTES, SEARCH_NIGHT_SITE, uploadSearchNight} from '../../lib/search-night-upload.mjs';

const NOW = new Date('2026-11-07T04:10:00Z'), CI = {CI: 'true', REPLAYS_PUBLISH_KEY: 'k'};
const verdictFile = (body = JSON.stringify({state: 'success', head: 'measured 2 of 6', rows: [{persona: 1, kind: 'measured'}]})) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'search-night-')), 'verdict.json');
  fs.writeFileSync(file, body);
  return file;
};

test('a local run, a run without the key, a missing run id or no verdict file sends nothing', async () => {
  const calls = [];
  const fetcher = async (...args) => { calls.push(args); return {ok: true, json: async () => ({})}; };
  const file = verdictFile();
  assert.match(await uploadSearchNight(file, '42133678718', {env: {REPLAYS_PUBLISH_KEY: 'k'}, fetcher, now: NOW}), /local run/);
  assert.match(await uploadSearchNight(file, '42133678718', {env: {CI: 'true'}, fetcher, now: NOW}), /no REPLAYS_PUBLISH_KEY/);
  assert.match(await uploadSearchNight(file, 'local', {env: CI, fetcher, now: NOW}), /no run id/);
  assert.match(await uploadSearchNight(path.join(os.tmpdir(), 'no-such-verdict.json'), '42133678718', {env: CI, fetcher, now: NOW}), /no verdict\.json/);
  assert.match(await uploadSearchNight(file, '42133678718', {env: {...CI, JP_CI_ROWS_DRY: '1'}, fetcher, now: NOW}), /dry run: would send \d+ bytes for night 2026-11-07/);
  assert.equal(calls.length, 0);
});

test('in CI with the key the verdict goes to the route with the key, the run and the UTC night; the line says what the Worker decided, counts only', async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push({url, init}); return {ok: true, json: async () => ({ok: true, night: '2026-11-07', measured: 2, total: 6, dropped: true, alert: 'sent'})}; };
  const line = await uploadSearchNight(verdictFile(), '42133678718', {env: CI, fetcher, now: NOW});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${SEARCH_NIGHT_SITE}?night=2026-11-07&run=42133678718`);
  assert.deepEqual([calls[0].init.method, calls[0].init.headers.Authorization], ['PUT', 'Bearer k']);
  assert.match(String(calls[0].init.body), /measured 2 of 6/);
  assert.equal(line, 'search night: sent night 2026-11-07 (measured 2 of 6, dropped; alert: sent) to /admin/job-search/lab?tab=night');
  assert.doesNotMatch(line, /Truck|Sofia|Brussels|employer/, 'counts only: no persona, job or employer name');
});

test('a refused, unreachable or oversized upload is one line and never throws', async () => {
  const refused = await uploadSearchNight(verdictFile(), '42133678718', {env: CI, now: NOW, fetcher: async () => ({ok: false, status: 404})});
  assert.equal(refused, 'search night: not sent (the site answered 404)');
  assert.match(await uploadSearchNight(verdictFile(), '42133678718', {env: CI, now: NOW, fetcher: async () => { throw new Error('offline'); }}), /not sent \(offline\)/);
  assert.match(await uploadSearchNight(verdictFile('x'.repeat(MAX_BYTES + 1)), '42133678718', {env: CI, now: NOW, fetcher: async () => assert.fail('over the cap: not sent')}), /over 65536/);
  assert.equal(await uploadSearchNight(verdictFile(), '42133678718', {env: CI, now: NOW, fetcher: async () => ({ok: true, json: async () => { throw new Error('not json'); }})}), 'search night: sent night 2026-11-07 (stored) to /admin/job-search/lab?tab=night');
});
