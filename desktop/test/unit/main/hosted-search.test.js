// Hosted Always on in the app (lib/hosted-search.js, lib/hosted-handlers.js, renderer/pages/hosted.js): the calls to the site with the install key, the config it pushes, the inbox merge,
// delete on turn off, and the wizard step's place and words.
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {wizardFixture} from '../../setup-step-fixture.js';
import {canRun, config, exportTo, pullInbox, pushConfig, state, testRead, testStart, turnOff, turnOn} from '../../../lib/hosted-search.js';
import {strictSetSecret} from '../../strict-set-secret.js';

const FREE = 'JPF1.install-0001.tok';
function store(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-hosted-')), mine = {...settings};
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config', 'search.json'), JSON.stringify({role_keywords: ['sre']}));
  fs.writeFileSync(path.join(dir, 'profile.md'), 'My profile');
  return {dir, settings: () => mine, saveSettings: patch => Object.assign(mine, patch), secret: name => (name === 'ANTHROPIC_API_KEY' ? FREE : ''), setSecret: strictSetSecret(), path: name => path.join(dir, name)};
}
function site(routes) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const route = new URL(url).pathname, key = `${init.method || 'GET'} ${route}`;
    calls.push({key, key_header: init.headers?.['x-api-key'], body: init.body && JSON.parse(init.body)});
    const answer = routes[key];
    return answer ? Response.json(answer.body ?? answer, {status: answer.status || 200}) : Response.json({ok: false, error: 'no route'}, {status: 404});
  };
  return {calls, fetcher};
}

test('turning on sends the e-mail and the profile (never a news answer) with the install key, and remembers it', async () => {
  const st = store(), s = site({'PUT /api/hosted/schedule': {ok: true}, 'PUT /api/hosted/config': {ok: true}});
  assert.deepEqual(await turnOn(st, {email: 'bad'}, {fetcher: s.fetcher}), {ok: false, error: 'Enter an email address like you@example.com.'});
  assert.deepEqual(await turnOn(st, {email: ' A@Example.com '}, {fetcher: s.fetcher}), {ok: true});
  assert.deepEqual(s.calls.map(c => c.key), ['PUT /api/hosted/schedule', 'PUT /api/hosted/config']);
  assert.deepEqual(s.calls[0].body, {on: true, email: 'A@Example.com', freqHours: 4});   // How often (default 4 h) reaches the schedule (ap 2/6)
  assert.deepEqual(s.calls[1].body, {search: {role_keywords: ['sre']}, profile: 'My profile', cv: ''});
  assert.ok(s.calls.every(c => c.key_header === FREE));
  assert.deepEqual([state(st).on, state(st).email], [true, 'A@Example.com']);
});

test('the site refusing leaves it off with the site\'s own words', async () => {
  const st = store(), s = site({'PUT /api/hosted/schedule': {status: 409, body: {ok: false, error: 'This device belongs to another account.'}}});
  assert.deepEqual(await turnOn(st, {email: 'a@example.com'}, {fetcher: s.fetcher}), {ok: false, status: 409, error: 'This device belongs to another account.'});
  assert.equal(state(st).on, false);
});

test('turning off deletes what the server holds, then stops the schedule', async () => {
  const st = store({hostedSearch: {on: true, email: 'a@example.com', after: 9}}), s = site({'DELETE /api/hosted/data': {ok: true, receipt: {objects: 2}}, 'PUT /api/hosted/schedule': {ok: true}});
  const done = await turnOff(st, {fetcher: s.fetcher});
  assert.deepEqual(s.calls.map(c => c.key), ['DELETE /api/hosted/data', 'PUT /api/hosted/schedule']);
  assert.deepEqual([done.ok, state(st).on, state(st).after], [true, false, 0]);
});

test('turning off what was never on makes no call (Skip in the wizard, and e2e, never reach the site)', async () => {
  const s = site({});
  assert.deepEqual(await turnOff(store(), {fetcher: s.fetcher}), {ok: true, receipt: null});
  assert.deepEqual(s.calls, []);
});

test('the inbox goes to the engine\'s merge and the app remembers how far it read', async () => {
  const st = store({hostedSearch: {on: true, email: 'a@example.com', after: 4}});
  const s = site({'GET /api/hosted/inbox': {ok: true, matches: [{id: 5, job: 'j', title: 'T', url: 'https://a/1'}, {id: 7, job: 'k', title: 'U', url: 'https://a/2'}]}});
  const ran = [];
  const done = await pullInbox(st, async args => { ran.push([...args]); assert.deepEqual(JSON.parse(fs.readFileSync(args[3], 'utf8')).map(m => m.id), [5, 7]); return {code: 0, stdout: 'hosted merge: 2 new matches added'}; }, {fetcher: s.fetcher});
  assert.deepEqual([done.ok, done.added, state(st).after], [true, 2, 7]);
  assert.deepEqual(ran[0].slice(0, 3), ['src', 'hosted', '--merge']);
  assert.equal(s.calls[0].key, 'GET /api/hosted/inbox');
  assert.deepEqual(await pullInbox(store(), async () => { throw new Error('never'); }, {fetcher: s.fetcher}), {ok: true, added: 0});   // off: no call at all
});

test('without a regular install key nothing is sent, and export writes the data to the chosen file', async () => {
  const none = {...store(), secret: () => ''};
  assert.equal((await pushConfig(none, {fetcher: async () => { throw new Error('never'); }})).ok, false);
  const st = store({hostedSearch: {on: true}}), s = site({'GET /api/hosted/export': {ok: true, inbox: [{title: 'T'}], config: null, stateTgzBase64: null}});
  const file = path.join(st.dir, 'out.json');
  assert.deepEqual(await exportTo(st, file, {fetcher: s.fetcher}), {ok: true, file});
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).inbox, [{title: 'T'}]);
  assert.deepEqual(config(st).profile, 'My profile');
});

test('Always on stays in Settings while setup ends after strategy with the shared finish action', async () => {
  const view = wizardFixture();
  assert.deepEqual(view.list.children.map(item => item.textContent), ['Welcome', 'AI', 'Your CV', 'Your strategy']);
  view.goStep('draft');
  await view.saveDraft();
  assert.equal(view.document.getElementById('finish').closest('.step').dataset.step, 'draft');
  await view.click('finish');
  assert.equal(view.settings.setupDone, true);
  const page = readScreenSource(new URL('../../../renderer/pages/hosted.js', import.meta.url), 'utf8');
  assert.match(page, /export function init\(\) \{ mountCard\(\); mountChoice\(\); mountDeviceOnly\(\); \}/);
  assert.match(page, /\$\('setting-cloud'\)\.after\(card\)/);
  assert.match(page, /window\.pilot\.hostedOn\(\{\}\)/, 'Settings retains the shared notification-address turn-on action');
});

test('an install can run Always on only with the in-house key; an own API key alone cannot (the offers never show then)', () => {
  assert.equal(canRun(store()), true);
  assert.equal(canRun({...store(), secret: name => (name === 'ANTHROPIC_API_KEY' ? 'sk-ant-own' : '')}), false);
  assert.equal(canRun({...store(), secret: () => ''}), false);
});

test('the Test on our servers starts one run and reads the site\'s steps in the shape the Test row draws', async () => {
  const st = store(), steps = [{key: 'on', label: 'Always on is on for you', state: 'ok'}, {key: 'found', label: 'New jobs found', state: 'ok', note: '4'}, {key: 'mail', label: 'The e-mail was sent', state: 'running'}];
  const s = site({'POST /api/hosted/test': {ok: true, run: 'run_1'}, 'GET /api/hosted/test': {ok: true, run: {id: 'run_1', status: 'running', found: 4, steps}}});
  assert.deepEqual(await testStart(st, {fetcher: s.fetcher}), {ok: true, run: 'run_1'});
  const read = await testRead(st, 'run_1', {fetcher: s.fetcher});
  assert.deepEqual([read.found, read.verdict, read.runId], [true, 'running', 'run_1']);
  assert.deepEqual(read.steps.map(step => [step.id, step.title, step.state, step.line]), [['on', 'Always on is on for you', 'ok', ''], ['found', 'New jobs found', 'ok', '4 new'], ['mail', 'The e-mail was sent', 'running', '']]);
  assert.ok(s.calls.every(c => c.key_header === FREE));
});

test('the Test on our servers: a finished run passes, a failed step or status fails with the site\'s note, a refusal says why', async () => {
  const st = store(), done = status => site({'GET /api/hosted/test': {ok: true, run: {id: 'r', status, steps: [{key: 'finished', label: 'The search finished', state: status === 'ok' ? 'ok' : 'failed', note: 'the search stopped'}]}}});
  assert.equal((await testRead(st, 'r', {fetcher: done('ok').fetcher})).verdict, 'passed');
  const failed = await testRead(st, 'r', {fetcher: done('failed').fetcher});
  assert.deepEqual([failed.verdict, failed.steps[0].line], ['failed', 'the search stopped']);
  const skipped = site({'GET /api/hosted/test': {ok: true, run: {id: 'r', status: 'ok', steps: [{key: 'found', label: 'New jobs found', state: 'failed'}]}}});
  assert.equal((await testRead(st, 'r', {fetcher: skipped.fetcher})).verdict, 'failed');   // an ok run with a failed step is still a failed test
  const refused = site({'POST /api/hosted/test': {status: 429, error: 'Wait 10 minutes between tests.'}});
  assert.deepEqual(await testStart(st, {fetcher: refused.fetcher}), {ok: false, status: 429, error: 'Wait 10 minutes between tests.'});
  const offline = await testRead(st, 'r', {fetcher: async () => { throw new Error('down'); }});
  assert.deepEqual([offline.found, offline.verdict], [false, 'running']);   // a failed read keeps polling; the row's limit ends it
});

test('a lasting refusal while reading ends the test with its reason; a blip or a busy site keeps polling', async () => {
  const st = store(), answer = (status, error) => site({'GET /api/hosted/test': {status, error}}).fetcher;
  const revoked = await testRead(st, 'r', {fetcher: answer(401, 'Bad key.')});
  assert.deepEqual([revoked.found, revoked.verdict, revoked.error], [true, 'failed', 'Bad key.']);
  assert.equal((await testRead(st, 'r', {fetcher: answer(404, 'Not open.')})).verdict, 'failed');
  for (const status of [429, 408, 500, 503]) assert.deepEqual([(await testRead(st, 'r', {fetcher: answer(status, 'later')})).found, status], [false, status]);
  const nokey = await testRead({...store(), secret: () => ''}, 'r', {fetcher: answer(200, '')});
  assert.deepEqual([nokey.found, nokey.verdict], [true, 'failed']);   // the key was removed mid-test: nothing to wait for
});

test('the Test on our servers reads the first search apart from the verdict: running, done with a count, failed with the site\'s note, absent on an older site', async () => {
  const st = store(), answer = search => site({'GET /api/hosted/test': {ok: true, run: {id: 'r', status: 'ok', steps: [{key: 'on', label: 'Always on is on for you', state: 'ok'}], search}}}).fetcher;
  const running = await testRead(st, 'r', {fetcher: answer({status: 'running', found: null, steps: [{key: 'finished', state: 'running'}]})});
  assert.deepEqual([running.verdict, running.search], ['passed', {state: 'running', found: 0, note: ''}]);   // the verdict does not wait for the search
  assert.deepEqual((await testRead(st, 'r', {fetcher: answer({status: 'ok', found: 3, steps: []})})).search, {state: 'ok', found: 3, note: ''});
  assert.deepEqual((await testRead(st, 'r', {fetcher: answer({status: 'failed', found: null, steps: [{key: 'finished', state: 'failed', note: 'It did not report back.'}]})})).search, {state: 'failed', found: 0, note: 'It did not report back.'});
  assert.equal((await testRead(st, 'r', {fetcher: answer(undefined)})).search, null);
});

test('the Test on our servers keeps the site\'s "check your notification settings" mark on a step', async () => {
  const st = store(), s = site({'GET /api/hosted/test': {ok: true, run: {id: 'r', status: 'failed', steps: [{key: 'ai', label: 'The AI answers', state: 'ok'}, {key: 'mail', label: 'A test e-mail was sent to you', state: 'failed', note: 'No e-mail address is set.', settings: true}]}}});
  const read = await testRead(st, 'r', {fetcher: s.fetcher});
  assert.deepEqual(read.steps.map(step => [step.id, step.settings, step.line]), [['ai', false, ''], ['mail', true, 'No e-mail address is set.']]);
});
