// Job: report health
// Guard: privacy — nothing leaves the Mac without CI's key (a local run sends nothing) and only a run on main is a night (owner, 6 Nov 2026: "Am I getting alerted? I'm not alerted"); the verdict goes with the key and the UTC night,
// a refused or unreachable site is one line and never throws, and the line carries counts only. The route itself is guarded in jobadabra-web (test/unit/admin/search/search-night.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MAX_BYTES, SEARCH_NIGHT_SITE, SEARCH_WEEK_SITE, uploadSearchNight} from '../../lib/search-night-upload.mjs';

const NOW = new Date('2026-11-07T04:10:00Z'), CI = {CI: 'true', GITHUB_REF_NAME: 'main', REPLAYS_PUBLISH_KEY: 'k'};
const verdictFile = (body = JSON.stringify({state: 'success', head: 'measured 2 of 6', rows: [{persona: 1, kind: 'measured'}]})) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'search-night-')), 'verdict.json');
  fs.writeFileSync(file, body);
  return file;
};

test('a local run, a run without the key, a missing run id or no verdict file sends nothing', async () => {
  const calls = [];
  const fetcher = async (...args) => { calls.push(args); return {ok: true, json: async () => ({})}; };
  const file = verdictFile();
  assert.match(await uploadSearchNight(file, '42133678718', {env: {REPLAYS_PUBLISH_KEY: 'k', GITHUB_REF_NAME: 'main'}, fetcher, now: NOW}), /local run/);
  assert.match(await uploadSearchNight(file, '42133678718', {env: {CI: 'true', GITHUB_REF_NAME: 'main'}, fetcher, now: NOW}), /no REPLAYS_PUBLISH_KEY/);
  for (const ref of ['gi-night-upload', 'fd/some-fix', undefined]) assert.match(await uploadSearchNight(file, '42133678718', {env: {...CI, GITHUB_REF_NAME: ref}, fetcher, now: NOW}), /only a run on main is a night/, `a run on ${ref}`);
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

// Why (12 Nov 2026, owner's 06:30 alert "Night search: no result last night"): the first night that measured all 18 people was 106,067 bytes as gate.py writes it (indented, with the
// per-person results under `personas`, which only gate.py's own compare reads), over the cap, so Admin got no night. What is sent is compact and carries what the site reads.
test('a fully measured night fits: the verdict is sent compact, without the per-person results the site never reads', async () => {
  const row = n => ({persona: n, kind: 'measured', label: `Example role ${n}`, found: 40, local: 12, sources: {a: 1}, step_yield: 'x'.repeat(285), scout: 'y'.repeat(253)});
  const verdict = {state: 'success', head: 'measured 18 of 18', eures: 'off', floors: {f: 1}, rows: Array.from({length: 18}, (_, i) => row(i + 1)), personas: Object.fromEntries(Array.from({length: 18}, (_, i) => [i + 1, {jobs: 'z'.repeat(5000)}]))};
  const file = verdictFile(JSON.stringify(verdict, null, 1));
  assert.ok(fs.statSync(file).size > MAX_BYTES, 'the file as written is over the cap, as on 12 Nov');
  let sent;
  const line = await uploadSearchNight(file, '43124127967', {env: CI, now: NOW, fetcher: async (url, init) => { sent = String(init.body); return {ok: true, json: async () => ({measured: 18, total: 18})}; }});
  assert.match(line, /sent night 2026-11-07 \(measured 18 of 18\)/);
  const {personas: _unread, ...kept} = verdict;
  assert.deepEqual(JSON.parse(sent), kept, 'everything but `personas` arrives unchanged');
  assert.equal(sent, JSON.stringify(kept), 'compact: no indent');
});

test('a by-hand run sends by_hand=1 and says it is stored beside the nights; the scheduled run does not (a by-hand run must never replace the night)', async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push(url); return {ok: true, json: async () => ({ok: true, byHand: true})}; };
  const line = await uploadSearchNight(verdictFile(), '42133678718', {env: {...CI, SEARCH_NIGHT_BY_HAND: 'yes'}, fetcher, now: NOW});
  assert.equal(calls[0], `${SEARCH_NIGHT_SITE}?night=2026-11-07&run=42133678718&by_hand=1`);
  assert.match(line, /sent a by-hand run of 2026-11-07 \(stored beside the nights/);
  await uploadSearchNight(verdictFile(), '42133678718', {env: {...CI, SEARCH_NIGHT_BY_HAND: 'no'}, fetcher, now: NOW});
  assert.doesNotMatch(calls[1], /by_hand/);
  assert.match(await uploadSearchNight(verdictFile(), '42133678718', {env: {...CI, JP_CI_ROWS_DRY: '1', SEARCH_NIGHT_BY_HAND: 'yes'}, fetcher, now: NOW}), /would send \d+ bytes for a by-hand run 2026-11-07/);
  assert.equal(calls.length, 2, 'the dry run sends nothing');
});

test('the week (5 runs a person, 2/3) goes to its own route, never the night\'s; a site without that route yet is one line', async () => {
  const calls = [];
  const fetcher = async url => { calls.push(url); return url.startsWith(SEARCH_WEEK_SITE) ? {ok: false, status: 404} : {ok: true, json: async () => ({})}; };
  const line = await uploadSearchNight(verdictFile(), '42133678718', {env: {...CI, SEARCH_CHECK_SERIES: 'weekly', SEARCH_NIGHT_BY_HAND: 'no'}, fetcher, now: NOW});
  assert.equal(calls[0], `${SEARCH_WEEK_SITE}?week=2026-11-07&run=42133678718`);
  assert.doesNotMatch(calls[0], /\/search-check\/night/, 'a week filed as a night would replace it and alert');
  assert.equal(line, 'search week: not sent (the site answered 404)');
});
