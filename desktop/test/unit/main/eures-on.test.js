// EURES is a Find jobs source only in an installed beta or stable build; a run from source and every CI or test run search without it (lib/eures-on.js).
// Owner, 10 Nov 2026: "In the beta/stable releases it should be on... But local and on CI ... it should be off".
import test from 'node:test';
import assert from 'node:assert/strict';
import {euresOn} from '../../../lib/eures-on.js';
import {pipelineEnv, setInstalledBuild} from '../../../lib/pipeline-env.js';

const storage = {settings: () => ({}), saveSettings: () => ({}), path: name => name, secret: () => ''};

test('one rule: on in an installed build (beta or stable), off from source, on CI and in every test run', () => {
  assert.equal(euresOn({}, {packaged: true}), true, 'an installed beta or stable build');
  assert.equal(euresOn({}, {packaged: false}), false, 'the app run from a checkout (npm start, practice)');
  for (const env of [{CI: 'true'}, {GITHUB_ACTIONS: 'true'}, {JOBADABRA_E2E: '1'}, {JOBADABRA_SMOKE: '1'}, {JOBADABRA_PTY_SMOKE: '1'}, {JOBADABRA_TWIN: '1'}]) {
    assert.equal(euresOn(env, {packaged: true}), false, `${Object.keys(env)[0]}: an installed build under test is still a test`);
  }
});

test('the engine is told JOBADABRA_EURES=1 only by an installed build; a developer shell cannot pass it through', () => {
  try {
    setInstalledBuild(false);
    assert.equal(pipelineEnv(storage, {JOBADABRA_EURES: '1'}).JOBADABRA_EURES, undefined, 'from source: the parent\'s variable is not on the whitelist');
    setInstalledBuild(true);
    assert.equal(pipelineEnv(storage, {}).JOBADABRA_EURES, '1');
    assert.equal(pipelineEnv(storage, {CI: 'true'}).JOBADABRA_EURES, undefined, 'an installed build on CI (the beta gate) searches without EURES');
  } finally { setInstalledBuild(false); }
});

test('Always on gets the same answer: an installed app sends the variable, a source run removes it; daily.yml hands it on, pinned in tests/unit/sources/test_eures.py (review of oe 1/3, 10 Nov 2026)', async () => {
  const github = await import('../../../lib/github.js');
  const store = {settings: () => ({}), saveSettings: () => {}, readText: () => '', secret: () => '', setSecret: () => {}};
  try {
    setInstalledBuild(true);
    assert.equal(github.payload(store).variables.JOBADABRA_EURES, '1');
    setInstalledBuild(false);
    const off = github.payload(store);
    assert.equal(off.variables.JOBADABRA_EURES, undefined);
    assert.ok(off.removed.includes('JOBADABRA_EURES'), 'a repo that had it loses it when the app no longer says so');
  } finally { setInstalledBuild(false); }
});
