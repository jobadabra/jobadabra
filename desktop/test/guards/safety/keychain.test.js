// What a test run or a live-test twin may reach of this Mac's Keychain (lib/keychain.js). 8 Oct 2026: a local e2e run that reached an account page
// overwrote the owner's real job-site password: the engine's writes were not isolated and the app's reads (lib/credentials.js, lib/site-password.js) never were.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as keychain from '../../../lib/keychain.js';
import * as pipeline from '../../../lib/pipeline.js';
import {forget, list} from '../../../lib/credentials.js';

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-keychain-'));
const spy = answer => { const calls = []; const exec = (cmd, args) => { calls.push([cmd, ...args]); return answer(args); }; return {calls, exec}; };
const realItem = service => `keychain: "/Users/x/login.keychain-db"\nclass: "genp"\nattributes:\n    "acct"<blob>="jobadabra"\n    "cdat"<timedate>=0x00  "20261008115402Z\\000"\n    "icmt"<blob>="email=owner@example.com"\n    "svce"<blob>="${service}"\n`;
const save = (dir, items) => fs.writeFileSync(path.join(dir, 'isolated-secrets.json'), JSON.stringify(items));

test('a test run never calls `security`: reads, comments and the item list come from its own file', () => {
  const dir = folder(), env = {JOBADABRA_E2E: '1', JOBADABRA_USER_DATA: dir};
  save(dir, {'jobadabra.e2e.test.password': {value: 'Test-Pass-11', account: 'jobadabra', comment: 'email=e2e@example.com', created: '20261008120000'}});
  const {calls, exec} = spy(() => 'real-secret');
  assert.equal(keychain.read('jobadabra.e2e.test.password', {env, exec, platform: 'darwin'}), 'Test-Pass-11');
  assert.equal(keychain.read('jobadabra.sites.password', {env, exec, platform: 'darwin'}), null);   // the owner's job-site password is not there
  assert.equal(keychain.read('jobadabra.google.refresh-token', {env, exec, platform: 'darwin'}), null);
  assert.equal(keychain.comment('jobadabra.e2e.test.password', {env, exec, platform: 'darwin'}), 'email=e2e@example.com');
  assert.match(keychain.dump({env, exec, platform: 'darwin'}), /jobadabra\.e2e\.test\.password/);
  assert.deepEqual(calls, []);
});

test('an isolated run without its own folder reads nothing, and still never the Keychain', () => {
  const {calls, exec} = spy(() => 'real-secret');
  assert.equal(keychain.read('jobadabra.sites.password', {env: {JOBADABRA_E2E: '1'}, exec, platform: 'darwin'}), null);
  assert.equal(keychain.dump({env: {JOBADABRA_E2E: '1'}, exec, platform: 'darwin'}), '');
  assert.deepEqual(calls, []);
});

test('the twin reads the real job-site passwords (docs/live-test.md) after its own file, and nothing else of the owner\'s', () => {
  const dir = folder(), env = {JOBADABRA_TWIN: '1', JOBADABRA_USER_DATA: dir};
  save(dir, {'jobadabra.made-by-twin.example.password': {value: 'Twin-Pass-12', account: 'jobadabra', comment: '', created: '20261008120000'}});
  const {calls, exec} = spy(args => (args[0] === 'dump-keychain'
    ? realItem('jobadabra.coop.example.password') + realItem('jobadabra.google.refresh-token') + realItem('jobadabra.mac-sign.password') : 'real-secret\n'));
  assert.equal(keychain.read('jobadabra.made-by-twin.example.password', {env, exec, platform: 'darwin'}), 'Twin-Pass-12');
  assert.equal(calls.length, 0);   // its own file first
  assert.equal(keychain.read('jobadabra.coop.example.password', {env, exec, platform: 'darwin'}), 'real-secret');
  assert.equal(keychain.read('jobadabra.sites.password', {env, exec, platform: 'darwin'}), 'real-secret');
  const before = calls.length;
  assert.equal(keychain.read('jobadabra.google.refresh-token', {env, exec, platform: 'darwin'}), null);
  assert.equal(keychain.read('jobadabra.report.token', {env, exec, platform: 'darwin'}), null);
  assert.equal(calls.length, before);   // the Google sign-in and the report token are never asked for
  const text = keychain.dump({env, exec, platform: 'darwin'});
  assert.match(text, /coop\.example/);
  assert.match(text, /made-by-twin/);
  assert.doesNotMatch(text, /google|mac-sign/);
});

test('a user\'s app reads the Keychain as before', () => {
  const {calls, exec} = spy(() => 'real-secret\n');
  assert.equal(keychain.read('jobadabra.sites.password', {account: 'jobadabra', env: {}, exec, platform: 'darwin'}), 'real-secret');
  assert.deepEqual(calls[0], ['security', 'find-generic-password', '-a', 'jobadabra', '-s', 'jobadabra.sites.password', '-w']);
});

test('Settings → Credentials in a test run lists the run\'s own accounts, never the owner\'s', () => {
  const dir = folder();
  save(dir, {'jobadabra.e2e.wd3.myworkdayjobs.com.password': {value: 'x', account: 'jobadabra', comment: 'email=e2e@example.com job=https://x', created: '20261008140534'},
    'jobadabra.sites.password': {value: 'y', account: 'jobadabra', comment: '', created: '20261008140534'}});
  const saved = {...process.env};
  Object.assign(process.env, {JOBADABRA_E2E: '1', JOBADABRA_USER_DATA: dir});
  try {
    const {calls, exec} = spy(() => realItem('jobadabra.coop.example.password'));
    assert.deepEqual(list('darwin', exec).rows.map(row => [row.host, row.email]), [['e2e.wd3.myworkdayjobs.com', 'e2e@example.com']]);
    assert.deepEqual(calls, []);
  } finally { for (const name of ['JOBADABRA_E2E', 'JOBADABRA_USER_DATA']) if (name in saved) process.env[name] = saved[name]; else delete process.env[name]; }
});

test('the engine gets the run\'s own secrets file in a test run or a twin, and never for a user', () => {
  const storage = {settings: () => ({}), secret: () => '', path: name => '/tmp/' + name, secretsPresent: () => ({}), saveSettings: () => {}};
  const dir = folder();
  assert.equal(pipeline.pipelineEnv(storage, {PATH: '/usr/bin', JOBADABRA_E2E: '1', JOBADABRA_USER_DATA: dir}).JOBADABRA_ISOLATED_SECRETS, path.join(dir, 'isolated-secrets.json'));
  assert.equal(pipeline.pipelineEnv(storage, {PATH: '/usr/bin', JOBADABRA_TWIN: '1', JOBADABRA_USER_DATA: dir}).JOBADABRA_ISOLATED_SECRETS, path.join(dir, 'isolated-secrets.json'));
  assert.equal(pipeline.pipelineEnv(storage, {PATH: '/usr/bin', JOBADABRA_USER_DATA: dir}).JOBADABRA_ISOLATED_SECRETS, undefined);
});

test('every Keychain call of the app goes through lib/keychain.js (a new one would skip the isolation)', () => {
  const lib = path.join(import.meta.dirname, '../../../lib');
  const direct = fs.readdirSync(lib).filter(name => name.endsWith('.js') && name !== 'keychain.js')
    .filter(name => /execFile(?:Sync)?\(\s*'security'|\['find-generic-password'|'dump-keychain'|'add-generic-password'/.test(fs.readFileSync(path.join(lib, name), 'utf8')));
  assert.deepEqual(direct, []);
});

// Settings → Credentials → Delete (owner, 9 Oct 2026): a test run or the twin deletes only from its own file; a user's app deletes the one item it names.
test('Delete: isolated runs delete from their own file only; the app deletes the named item; a bad host is refused', () => {
  for (const env of [{JOBADABRA_E2E: '1'}, {JOBADABRA_TWIN: '1'}]) {
    const dir = folder(); env.JOBADABRA_USER_DATA = dir;
    save(dir, {'jobadabra.e2e.test.password': {value: 'Test-Pass-11', account: 'jobadabra'}});
    const {calls, exec} = spy(() => '');
    assert.equal(keychain.remove('jobadabra.e2e.test.password', {account: 'jobadabra', env, exec, platform: 'darwin'}), true);
    assert.equal(keychain.remove('jobadabra.career2.successfactors.eu.password', {account: 'jobadabra', env, exec, platform: 'darwin'}), false);   // a real item: never
    assert.deepEqual(calls, []);
    assert.deepEqual(keychain.isolatedItems(env), {});
  }
  const {calls, exec} = spy(() => '');
  assert.equal(keychain.remove('jobadabra.e2e.wd3.myworkdayjobs.com.password', {account: 'jobadabra', env: {}, exec, platform: 'darwin'}), true);
  assert.deepEqual(calls, [['security', 'delete-generic-password', '-a', 'jobadabra', '-s', 'jobadabra.e2e.wd3.myworkdayjobs.com.password'],
    ['security', 'delete-generic-password', '-a', 'job-pilotto', '-s', 'job-pilotto.e2e.wd3.myworkdayjobs.com.password']]);   // both names: the old item must not bring it back
  const none = spy(() => '');
  assert.equal(forget('sites', 'darwin', none.exec), false);   // the shared job-site password is not a site row
  assert.equal(forget('a b.com; rm', 'darwin', none.exec), false);
  assert.deepEqual(none.calls, []);
});

test('the twin also reads the one Ready to send owner secret item, read-only, and no other jobadabra item', () => {
  const dir = folder(), env = {JOBADABRA_TWIN: '1', JOBADABRA_USER_DATA: dir};
  const {calls, exec} = spy(() => 'real-secret\n');
  assert.equal(keychain.read('jobadabra.ready.owner_secret', {env, exec, platform: 'darwin'}), 'real-secret');
  for (const other of ['jobadabra.ready.other', 'jobadabra.anthropic.ready_key', 'jobadabra.cloudflare.api_token', 'jobadabra.notion.token-desktop-real']) {
    const before = calls.length;
    assert.equal(keychain.read(other, {env, exec, platform: 'darwin'}), null, other);
    assert.equal(calls.length, before);
  }
  assert.equal(keychain.read('jobadabra.ready.owner_secret', {env: {JOBADABRA_E2E: '1', JOBADABRA_USER_DATA: dir}, exec, platform: 'darwin'}), null);   // an e2e run never reaches it
});

// Owner, 14 Nov 2026 (asked via AskUserQuestion: "Read my Keychain item (Recommended)"): the twin's Easy Apply proof run reads the owner's LinkedIn sign-in, never writes or keeps one.
test('the twin reads the LinkedIn sign-in item read-only, never writes it to its file on disk, and an e2e run never reaches it', async () => {
  assert.equal((await import('../../../lib/linkedin-session.js')).SERVICE, keychain.TWIN_LINKEDIN_SESSION, 'the twin allows the very item the app uses');
  const dir = folder(), env = {JOBADABRA_TWIN: '1', JOBADABRA_USER_DATA: dir};
  const {calls, exec} = spy(() => '{"li_at":"fake"}\n');
  assert.equal(keychain.read(keychain.TWIN_LINKEDIN_SESSION, {env, exec, platform: 'darwin'}), '{"li_at":"fake"}');
  assert.equal(keychain.write(keychain.TWIN_LINKEDIN_SESSION, '{"li_at":"fresh"}', {account: 'linkedin-jobs', env, exec, platform: 'darwin'}), false);
  assert.equal(fs.existsSync(path.join(dir, 'isolated-secrets.json')), false, 'no LinkedIn session in a file');
  assert.ok(calls.every(call => call[1] === 'find-generic-password'), 'the real item is only read');
  assert.equal(keychain.read('jobadabra.linkedin-jobs.session', {env: {JOBADABRA_E2E: '1', JOBADABRA_USER_DATA: dir}, exec, platform: 'darwin'}), null);
});

test('a test that passes no fake exec can never change the real Keychain (24 Oct 2026: a Python test wrote the owner\'s Keychain)', () => {
  assert.throws(() => keychain.write('jobadabra.x.token', 'v', {env: {NODE_TEST_CONTEXT: 'child-v8'}, platform: 'darwin'}), /real Keychain/);
  assert.throws(() => keychain.remove('jobadabra.x.token', {env: {NODE_TEST_CONTEXT: 'child-v8'}, platform: 'darwin'}), /real Keychain/);
  const {calls, exec} = spy(() => '');
  assert.equal(keychain.write('jobadabra.x.token', 'v', {env: {NODE_TEST_CONTEXT: 'child-v8'}, exec, platform: 'darwin'}), true);   // a fake exec is fine
  assert.equal(calls.length, 1);
});

// #3711 (10 Nov 2026): a unit test that passed no fake read the owner's real LinkedIn session item; reads were not refused, only changes.
test('a test that passes no fake exec reads nothing from the real Keychain; a fake exec still reads', () => {
  const env = {NODE_TEST_CONTEXT: 'child-v8'};
  assert.equal(keychain.read('jobadabra.linkedin-jobs.session', {account: 'linkedin-jobs', env, platform: 'darwin'}), null);
  assert.equal(keychain.comment('jobadabra.x.token', {env, platform: 'darwin'}), '');
  assert.equal(keychain.dump({env, platform: 'darwin'}), null);
  assert.equal(keychain.read('jobadabra.x.token', {env: {JOBADABRA_UNDER_TEST: '1'}, platform: 'darwin'}), null);
  const {calls, exec} = spy(() => 'fake-value\n');
  assert.equal(keychain.read('jobadabra.x.token', {env, exec, platform: 'darwin'}), 'fake-value');   // positive control: the same call with a fake reaches it
  assert.equal(calls.length, 1);
});

// Rename to Jobadabra (1 Nov 2026, owner: "small fallbacks"): an install made before it keeps its items under job-pilotto.* with account job-pilotto.
test('an item an older install stored under job-pilotto.* is still read; the new name wins; nothing is written under the old name', () => {
  const items = {'job-pilotto|job-pilotto.notion.token': 'old-secret', 'job-pilotto|job-pilotto.google.scopes': 'old-scopes'};
  const key = args => `${args[args.indexOf('-a') + 1]}|${args[args.indexOf('-s') + 1]}`;
  const {calls, exec} = spy(args => (args[0] === 'find-generic-password' && items[key(args)]) || (() => { throw new Error('not found'); })());
  const env = {};
  assert.equal(keychain.read('jobadabra.notion.token', {account: 'jobadabra', env, exec, platform: 'darwin'}), 'old-secret');
  assert.equal(calls.length, 2);   // the new name first, then the old one
  items['jobadabra|jobadabra.notion.token'] = 'new-secret';
  assert.equal(keychain.read('jobadabra.notion.token', {account: 'jobadabra', env, exec, platform: 'darwin'}), 'new-secret');
  assert.deepEqual(keychain.legacyName('jobadabra.sites.password', 'jobadabra'), {service: 'job-pilotto.sites.password', account: 'job-pilotto'});
  assert.equal(keychain.legacyName('other.name', 'x'), null);
  assert.ok(!calls.some(call => call.includes('add-generic-password')));
});

// Owner, 14 Nov 2026: "jobadabra should not store the linkedin credentials on disk... Let's store them in Keychain/Credentials Manager (windows)".
test('Windows keeps a secret in its Credential Manager through the engine\'s store: the secret on stdin, never on a command line or in a file', () => {
  const calls = [];
  const exec = (cmd, args, opts) => { calls.push({cmd, args, opts}); return args[2] === 'get' ? 'S3CRET-value' : ''; };
  const at = {account: 'linkedin-jobs', env: {}, exec, platform: 'win32'};
  assert.equal(keychain.write('jobadabra.linkedin-jobs.session', 'S3CRET-value', at), true);
  assert.equal(keychain.read('jobadabra.linkedin-jobs.session', at), 'S3CRET-value');
  assert.equal(keychain.remove('jobadabra.linkedin-jobs.session', at), true);
  assert.deepEqual(calls.map(call => call.args), ['put', 'get', 'delete'].map(verb => ['-m', 'src.secret_store', verb, 'jobadabra.linkedin-jobs.session', '--account', 'linkedin-jobs']));
  for (const call of calls) {
    assert.match(call.cmd, /python(\.exe)?$/);
    assert.equal(call.opts.cwd, pipeline.REPO);
    assert.equal(call.opts.windowsHide, true);   // no console window flashes
    assert.ok(!JSON.stringify([call.cmd, call.args]).includes('S3CRET'), 'the secret never rides on the command line');
  }
  assert.equal(calls[0].opts.input, 'S3CRET-value');
  assert.equal(keychain.write('jobadabra.x.token', 'v', {env: {}, exec, platform: 'win32'}), true);
  assert.deepEqual(calls.at(-1).args.slice(-2), ['--account', 'jobadabra']);   // the Mac's default account
  assert.equal(keychain.read('jobadabra.report.token', {env: {}, exec, platform: 'win32'}), 'S3CRET-value');
  assert.deepEqual(calls.at(-1).args, ['-m', 'src.secret_store', 'get', 'jobadabra.report.token']);   // no account: any, as `security` without -a
  assert.equal(keychain.hasStore('win32'), true);
});

test('Windows: a store that fails reads nothing and keeps nothing; a test or an isolated run never starts it; Linux has no store', () => {
  const fails = () => { throw new Error('exit 1'); };
  const at = {account: 'linkedin-jobs', env: {}, exec: fails, platform: 'win32'};
  assert.equal(keychain.read('jobadabra.linkedin-jobs.session', at), null);
  assert.equal(keychain.write('jobadabra.linkedin-jobs.session', 'v', at), false);
  assert.equal(keychain.remove('jobadabra.linkedin-jobs.session', at), false);
  const {calls, exec} = spy(() => 'real-secret');
  const dir = folder();
  assert.equal(keychain.read('jobadabra.linkedin-jobs.session', {env: {JOBADABRA_E2E: '1', JOBADABRA_USER_DATA: dir}, exec, platform: 'win32'}), null);
  assert.equal(keychain.write('jobadabra.linkedin-jobs.session', 'v', {env: {JOBADABRA_E2E: '1', JOBADABRA_USER_DATA: dir}, exec, platform: 'win32'}), true);   // its own file
  assert.equal(keychain.read('jobadabra.linkedin-jobs.session', {env: {}, exec, platform: 'linux'}), null);
  assert.equal(keychain.write('jobadabra.linkedin-jobs.session', 'v', {env: {}, exec, platform: 'linux'}), false);
  assert.equal(keychain.hasStore('linux'), false);
  assert.deepEqual(calls, []);
  assert.equal(keychain.read('jobadabra.linkedin-jobs.session', {env: {NODE_TEST_CONTEXT: 'child'}, platform: 'win32'}), null);   // the genuine exec under a test reads nothing
  assert.throws(() => keychain.write('jobadabra.linkedin-jobs.session', 'v', {env: {NODE_TEST_CONTEXT: 'child'}, platform: 'win32'}), /real Keychain/);
});
