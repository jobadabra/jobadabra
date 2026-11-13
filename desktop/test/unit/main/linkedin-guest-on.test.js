// LinkedIn's public job search is read by the installed desktop app only, never with the signed-in switch on (that read replaces it) or while LinkedIn is paused;
// its slow-down line pauses both LinkedIn reads a day (lib/linkedin-guest-on.js; spec docs/superpowers/specs/2026-11-13-linkedin-guest-search-design.md).
// Owner, 13 Nov 2026, asked via AskUserQuestion: "On each person's Mac (Recommended)", "Public for all, sign-in replaces (Recommended)", "Shared 1-day pause (Recommended)".
import test from 'node:test';
import assert from 'node:assert/strict';
import {guestOn, guestEnv, watchGuest, SLOW_DOWN} from '../../../lib/linkedin-guest-on.js';
import {pipelineEnv, setInstalledBuild} from '../../../lib/pipeline-env.js';
import * as session from '../../../lib/linkedin-session.js';

const NOW = Date.parse('2026-11-13T12:00:00Z');
function store(linkedinJobs = {}) {
  let settings = {linkedinJobs};
  return {settings: () => settings, saveSettings: patch => { settings = {...settings, ...patch}; return settings; }, path: name => name, secret: () => ''};
}

test('on only in an installed build with the signed-in switch off and LinkedIn not paused', () => {
  assert.equal(guestOn(store(), {}, {packaged: true, now: NOW}), true);
  assert.equal(guestOn(store(), {}, {packaged: false, now: NOW}), false, 'from source: off, as EURES');
  for (const env of [{CI: 'true'}, {GITHUB_ACTIONS: 'true'}, {JOBADABRA_E2E: '1'}, {JOBADABRA_TWIN: '1'}]) {
    assert.equal(guestOn(store(), env, {packaged: true, now: NOW}), false, `${Object.keys(env)[0]}: a test run never reads LinkedIn`);
  }
  assert.equal(guestOn(store({on: true}), {}, {packaged: true, now: NOW}), false, 'the signed-in read runs instead: one LinkedIn read a press');
  assert.equal(guestOn(store({pauseUntil: new Date(NOW + 3600e3).toISOString()}), {}, {packaged: true, now: NOW}), false, 'paused');
  assert.equal(guestOn(store({pauseUntil: new Date(NOW - 1).toISOString()}), {}, {packaged: true, now: NOW}), true, 'a pause that ended');
  assert.deepEqual(guestEnv(store(), {}, {packaged: true, now: NOW}), {JOBADABRA_LINKEDIN_GUEST: '1'});
  assert.deepEqual(guestEnv(store(), {}, {packaged: false, now: NOW}), {});
});

test('the engine is told only by an installed build; a developer shell cannot pass the flag through', () => {
  try {
    setInstalledBuild(false);
    assert.equal(pipelineEnv(store(), {JOBADABRA_LINKEDIN_GUEST: '1'}).JOBADABRA_LINKEDIN_GUEST, undefined);
    setInstalledBuild(true);
    const kept = Object.fromEntries(['CI', 'GITHUB_ACTIONS', 'JOBADABRA_E2E', 'JOBADABRA_SMOKE', 'JOBADABRA_PTY_SMOKE', 'JOBADABRA_TWIN'].map(name => [name, process.env[name]]));
    for (const name of Object.keys(kept)) delete process.env[name];
    try {
      assert.equal(pipelineEnv(store(), {}).JOBADABRA_LINKEDIN_GUEST, '1');
      assert.equal(pipelineEnv(store({on: true}), {}).JOBADABRA_LINKEDIN_GUEST, undefined);
    } finally { for (const [name, value] of Object.entries(kept)) if (value !== undefined) process.env[name] = value; }
    assert.equal(pipelineEnv(store(), {CI: 'true'}).JOBADABRA_LINKEDIN_GUEST, undefined, 'an installed build on CI (the beta gate)');
  } finally { setInstalledBuild(false); }
});

test('the engine\'s slow-down line pauses both LinkedIn reads a day; every line still reaches the log', () => {
  const mine = store(), seen = [];
  const onLine = watchGuest(mine, line => seen.push(line), () => NOW);
  onLine('LinkedIn: 12 job(s) from the public search');
  assert.equal(session.pausedUntil(mine), 0, 'a read that worked pauses nothing');
  onLine(`${SLOW_DOWN}: left alone for now (HTTP 429)`);
  assert.equal(session.pausedUntil(mine), NOW + 24 * 3600e3);
  assert.equal(mine.settings().linkedinJobs.last.state, 'limited');
  assert.equal(seen.length, 2);
  assert.equal(guestOn(mine, {}, {packaged: true, now: NOW + 3600e3}), false, 'the next press within the day reads no LinkedIn');
});

test('the line the app watches is the engine\'s own (src/sources/linkedin_guest.py SLOW_DOWN)', async () => {
  const {readFileSync} = await import('node:fs');
  const engine = readFileSync(new URL('../../../../src/sources/linkedin_guest.py', import.meta.url), 'utf8');
  assert.match(engine, new RegExp(`^SLOW_DOWN = '${SLOW_DOWN}'$`, 'm'));
});
