// The CLI's own answer to "am I signed in" (lib/plan-login.js), from recorded outputs: no real CLI, nothing started. Why (2 Nov 2026, owner, a Windows tester: Claude Code found, "Not signed in"):
// the sign-in verdict came from a regex over a failed AI call; the CLI's own status command decides now, a contradiction is a neutral failed check.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loginStatus, readLogin} from '../lib/plan-login.js';

test('claude auth status --json: loggedIn true / false; anything else is unknown (an older CLI)', () => {
  assert.equal(readLogin('claude', '{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.c"}'), 'signed-in');
  assert.equal(readLogin('claude', '{"loggedIn":false}', '', true), 'signed-out');
  assert.equal(readLogin('claude', '', "error: unknown command 'auth'", true), 'unknown');
  assert.equal(readLogin('claude', 'Logged in as someone', ''), 'unknown', 'text is not the JSON contract');
  assert.equal(readLogin('claude', '{"loggedIn":"yes"}'), 'unknown');
});

test('codex login status: "Logged in using ChatGPT" / "Not logged in"; an error or silence is unknown', () => {
  assert.equal(readLogin('openai', 'Logged in using ChatGPT\n'), 'signed-in');
  assert.equal(readLogin('openai', 'Not logged in\n', '', true), 'signed-out');
  assert.equal(readLogin('openai', '', 'Not logged in', true), 'signed-out');
  assert.equal(readLogin('openai', '', 'error: unrecognized subcommand', true), 'unknown');
  assert.equal(readLogin('openai', 'Logged in using ChatGPT', '', true), 'unknown', 'a non-zero exit is not a sign-in');
});

test('loginStatus asks the right command with the given environment and never throws', async () => {
  const seen = [];
  const run = (file, args, options, done) => { seen.push([file, args, options.env.MARK]); done(null, '{"loggedIn":true}', ''); };
  assert.equal(await loginStatus('claude', 'C:\\Users\\Ann\\.local\\bin\\claude.exe', {run, env: {MARK: 'x'}}), 'signed-in');
  assert.deepEqual(seen, [['C:\\Users\\Ann\\.local\\bin\\claude.exe', ['auth', 'status', '--json'], 'x']]);
  assert.equal(await loginStatus('openai', '/x/codex', {run: () => { throw new Error('EINVAL'); }}), 'unknown');
});
