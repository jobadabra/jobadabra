// Which store the app under test keeps its data in (lib/store.mjs, spec 2026-10-09-store-adapters.md P7): no token by default, this Mac's store on CI
// too (the stand-in only when pinned), and only a suite that pins it on the real workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {pickFamily} from '../../lib/engine.mjs';
import {notionFarSide, pickStore, runToken, STORES, storeSettings} from '../../lib/store.mjs';
import {E2E} from '../../lib/app.mjs';
import {SUITES} from '../../lib/context.mjs';
import {suiteFacts} from '../../plan-run.mjs';
import * as quality from '../../suites/quality.mjs';
import * as wander from '../../suites/wander.mjs';

test('a Mac runs on its own store (what a new install gets) unless pinned; E2E_NOTION_STANDIN=1 still means the stand-in', () => {
  assert.equal(pickStore({env: {}}), 'sqlite');
  assert.equal(pickStore({env: {E2E_STORE: 'standin'}}), 'standin');
  assert.equal(pickStore({env: {E2E_STORE: 'sqlite'}}), 'sqlite');
  assert.equal(pickStore({env: {E2E_NOTION_STANDIN: '1'}}), 'standin');
});

test('the real workspace is never picked from the environment, only by a suite', () => {
  assert.throws(() => pickStore({env: {E2E_STORE: 'notion'}}), /only for a suite that pins it/);
  assert.equal(pickStore({env: {E2E_STORE: 'sqlite'}, suiteStore: 'notion'}), 'notion');
  assert.throws(() => pickStore({suiteStore: 'cloud'}), /not "cloud"/);
});

// Why (3 Nov 2026, owner: "Mac Store only"): CI alternated runs 0,1 sqlite and 2,3 stand-in, so half of main's and the beta's runs went through the Notion path.
test('CI runs on this Mac\'s store whatever the run number or AI family; only a pin runs the stand-in; "alternate" is gone', () => {
  const families = new Set();
  for (const run of [0, 1, 2, 3, 6, 985, 987]) {
    const env = {CI: 'true', GITHUB_RUN_NUMBER: String(run), E2E_OPENAI_KEY: 'k'};
    families.add(pickFamily(env));
    assert.equal(pickStore({env}), 'sqlite', `run ${run}`);
  }
  assert.deepEqual([...families].sort(), ['claude', 'openai'], 'positive control: the AI family still alternates over the same runs');
  assert.equal(pickStore({env: {CI: 'true', GITHUB_RUN_NUMBER: '2', E2E_STORE: 'standin'}}), 'standin', 'the Notion path by hand');
  assert.throws(() => pickStore({env: {CI: 'true', E2E_STORE: 'alternate'}}), /sqlite or standin/);
});

test('quality pins SQLite for every CI store alternation so recorded answers use one path', () => {
  assert.equal(quality.store, 'sqlite');
  for (const run of [...Array(16).keys(), 985, 987]) { // 985 and 987 are beta 3 and beta 4's run numbers
    assert.equal(pickStore({env: {CI: 'true', GITHUB_RUN_NUMBER: String(run)}, suiteStore: quality.store}), 'sqlite', 'run ' + run);
  }
});

for (const [name, suite] of [['wander', wander]]) {
  test(`${name} keeps its Notion faults reachable on the stand-in across CI store alternation and environment pins`, () => {
    assert.equal(suite.store, 'standin');
    for (const run of [0, 1, 2, 3]) {
      for (const E2E_STORE of ['', 'sqlite', 'standin']) {
        assert.equal(pickStore({env: {CI: 'true', GITHUB_RUN_NUMBER: String(run), E2E_STORE}, suiteStore: suite.store}), 'standin');
      }
    }
  });
}

test('every stored-answer backbone suite pins its store or bypasses store alternation', async () => {
  // The suites that declare aiAnswers = 'backbone', the one list every workflow reads through the matrix (plan-run.mjs; beta 41078746088).
  const {backbone: suites} = await suiteFacts();
  assert.ok(suites.length > 0, 'stored answers must name at least one suite');
  assert.ok(suites.includes('quality'), 'quality must use stored backbone answers');
  for (const name of suites) {
    const suite = await import(`../../suites/${name}.mjs`);
    // Why (29 Oct 2026, ap): notion=false bypasses context's store alternation (the suite sets up its own store; the `stores` suite did, until it left e2e on 1 Nov 2026).
    assert.ok(STORES.includes(suite.store) || suite.notion === false, `${name}: stored answers require a store pin or no store alternation`);
  }
});

test('only the sqlite store is written into a fresh profile; the Notion store is the app\'s default', () => {
  assert.deepEqual(storeSettings('sqlite'), {store: 'sqlite'});
  assert.deepEqual(storeSettings('standin'), {store: 'notion'}, 'a Notion run says so: the app would give an empty profile this Mac');
});

test('every suite that pins a store names a known one, and only notion-real uses the real workspace', async () => {
  for (const name of SUITES) {
    const source = fs.readFileSync(path.join(E2E, 'suites', `${name}.mjs`), 'utf8');
    const pinned = source.match(/^export const store = '([^']*)'/m)?.[1];
    if (!pinned) continue;
    assert.ok(STORES.includes(pinned), `${name}: store '${pinned}'`);
    if (pinned === 'notion') assert.equal(name, 'notion-real', `${name} pins the real Notion workspace: only notion-real may (P7: every suite runs token-free)`);
  }
});

test('Notion\'s far side is real only on the real workspace: the stand-in, or a dead local port on this Mac\'s store', () => {
  assert.equal(notionFarSide({store: 'standin', standIn: 'http://127.0.0.1:5000'}), 'http://127.0.0.1:5000');
  assert.equal(notionFarSide({store: 'sqlite'}), 'http://127.0.0.1:9');
  assert.equal(notionFarSide({store: 'notion'}), 'https://api.notion.com');
  for (const store of ['standin', 'sqlite']) assert.doesNotMatch(notionFarSide({store, standIn: store === 'standin' ? 'http://127.0.0.1:1' : ''}), /notion\.com/);
});

test('a real token in the environment reaches a run only on the real workspace', () => {
  const fromEnv = () => 'ntn_real_from_the_keychain';
  assert.equal(runToken({store: 'sqlite', fromEnv}), '');
  assert.equal(runToken({store: 'standin', standIn: {token: 'ntn_e2e_x'}, fromEnv}), 'ntn_e2e_x');
  assert.equal(runToken({store: 'sqlite', standIn: {token: 'ntn_e2e_y'}, fromEnv}), 'ntn_e2e_y', 'a SQLite suite with a stand-in to move into');
  assert.equal(runToken({store: 'notion', fromEnv}), 'ntn_real_from_the_keychain');
  assert.equal(runToken({store: 'sqlite', light: true, fromEnv}), '');
});

test('a gate\'s second store files its findings under the suite\'s own name (triage.mjs suiteOf)', async () => {
  const {suiteOf} = await import('../../triage.mjs');
  assert.deepEqual(['e2e-artifacts-jobs', 'e2e-artifacts-jobs-standin', 'e2e-artifacts-windows-focusdismiss', '/tmp/x/e2e-artifacts-applycv-standin'].map(suiteOf),
    ['jobs', 'jobs', 'focusdismiss', 'applycv']);
});
