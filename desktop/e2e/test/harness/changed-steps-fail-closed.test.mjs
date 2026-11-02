// The PR check must fail closed: when the picker cannot read the diff, pr-e2e-steps.yml's Plan step goes red; it must never read as "no step changed" (Gitar on #2980: that is how a step
// reaches main without ever running, #2954/#2963). The other modes keep their soft fallback ("nothing reported", exit 0).
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';

const cli = new URL('../../pr-suites.mjs', import.meta.url).pathname;
const run = (...flags) => spawnSync('node', [cli, '--base', 'no-such-ref-for-this-test', ...flags], {encoding: 'utf8', timeout: 60000});

test('--changed-steps with an unreadable diff exits non-zero and prints no suites= line', () => {
  const out = run('--plan', '--changed-steps');
  assert.match(out.stdout, /could not read the diff/, 'positive control: the failure happened where the test says');
  assert.notEqual(out.status, 0);
  assert.doesNotMatch(out.stdout, /^suites=/m);
});

test('the after-merge and table modes keep the soft fallback: same failure, exit 0', () => {
  for (const flags of [['--plan'], []]) {
    const out = run(...flags);
    assert.match(out.stdout, /could not read the diff/);
    assert.equal(out.status, 0, `pr-suites ${flags.join(' ')}`);
  }
});
