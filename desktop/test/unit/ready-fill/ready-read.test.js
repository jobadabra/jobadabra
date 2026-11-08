// The cloud runner's read task (desktop/ready-fill/read-night.mjs, read-commands.mjs; spec docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md): each job's form is read the way the app's Apply readiness
// reads it (the extension's background poll and lib/triage-reader.js), the read goes to the site, nothing is filled or held, and the log has no question text. The site is faked at fetch and the browser by a
// small stand-in whose worker plays the extension's side of the poll (no Chrome).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {createTriageReader} from '../../../lib/triage-reader.js';
import {NIGHT_OWNER, readAnswer} from '../../../ready-fill/read-commands.mjs';

const job = id => ({id, url: `https://boards.example.com/${id}`, title: 'SRE', company: 'Acme', kit: {}, cv: '', letterPdf: ''});
// What each job's page "says" to the extension's light read: a simple form with one required question, or a sign-in page.
const PAGES = {j1: {simple: true, why: '', questions: ['Why do you want this role?']}, j2: {unreadable: true, why: 'login'}};

// A browser with no pages: its worker answers the night's poll kick the way the extension does (poll, take the read command, report a step, report the read).
function fakeChromium(seen) {
  let port = 0, storage = {};
  const call = async body => (await fetch(`http://127.0.0.1:${port}/extension/background-apply`, {method: 'POST', body: JSON.stringify(body)})).json();
  const worker = {evaluate: async (fn, values) => {
    if (values?.workerUrl) { port = Number(new URL(values.workerUrl).port); storage = values; seen.storage = values; return true; }
    if (!String(fn).includes('__jobPilottoBackgroundSessions')) return true;   // the storage check
    const polled = await call({action: 'poll', owner: storage.backgroundOwner});
    for (const command of polled.jobs || []) {
      seen.commands.push(command);
      const id = new URL(command.url).pathname.slice(1), session = command.session;
      await call({action: 'triage-step', owner: storage.backgroundOwner, session, step: 'looking'});
      await call({action: 'triage-read', owner: storage.backgroundOwner, session, ...PAGES[id]});
    }
    return true;
  }};
  return {launchPersistentContext: async (_profile, options) => { seen.args = options.args; return {serviceWorkers: () => [worker], route: async () => {}, newPage: async () => { seen.pages++; return {}; }, close: async () => {}}; }};
}

function site(stopAt = null) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const route = new URL(url).pathname.replace('/api/ready/', ''), body = init.body ? JSON.parse(init.body) : null;
    calls.push([route, body]);
    const answer = data => ({status: 200, json: async () => data});
    if (route === 'batch') return answer({ok: true, night: '2026-11-08', contact: {}, jobs: [job('j1'), job('j2')]});
    if (route === 'progress') return answer({ok: true, stop: stopAt !== null && body.job === stopAt});
    return answer({ok: true, stop: false});
  };
  return {calls, fetchImpl};
}

test('a read night reads each form through the app\'s own read, tells the site each read, opens no page itself and logs no question', async () => {
  const {runNight} = await import('../../../ready-fill/night.mjs');
  const seen = {commands: [], pages: 0}, logs = [], {calls, fetchImpl} = site();
  const night = await runNight({chromium: fakeChromium(seen), site: 'https://site.example', token: 't', task: 'readiness', fetchImpl, log: (...line) => logs.push(JSON.stringify(line))});
  const results = calls.filter(([route]) => route === 'result').map(([, body]) => body);
  assert.deepEqual(results.map(body => [body.job, body.task, body.state, body.why]), [['j1', 'readiness', 'read', ''], ['j2', 'readiness', 'unreadable', 'login']]);
  assert.deepEqual(results[0].read.questions, ['Why do you want this role?'], 'the read goes to the site (it keeps it encrypted)');
  assert.equal(results[0].read.simple, true);
  assert.ok(seen.commands.every(command => command.mode === 'read' && command.url.endsWith(`#jobpilotto-fill=${command.session}`)), 'each read is handed out as a read, its tab marked with its own id');
  assert.equal(seen.storage.backgroundOwner, NIGHT_OWNER, 'the extension polls as the night');
  const copy = seen.args.find(arg => arg.startsWith('--load-extension=')).split('=')[1];
  assert.ok(fs.existsSync(path.join(copy, 'owned-bootstrap.js')), 'the copy is the app-owned kind, as the Mac\'s hidden browser');
  assert.equal(seen.pages, 0, 'the night opens no page of its own: the extension opens the read');
  assert.equal(night.held.size, 0, 'a read holds nothing for the morning');
  assert.ok(logs.length && !logs.some(line => line.includes('Why do you want')), 'the log has counts and words, never a question');
  assert.ok(calls.some(([route, body]) => route === 'progress' && body.job === 'j1' && body.step === 'opening'), 'the live line moves');
});

test('a job the owner stops while it is read sends no result, and the next job is still read', async () => {
  const {runNight} = await import('../../../ready-fill/night.mjs');
  const seen = {commands: [], pages: 0}, {calls, fetchImpl} = site('j1');
  await runNight({chromium: fakeChromium(seen), site: 'https://site.example', token: 't', task: 'readiness', fetchImpl});
  assert.deepEqual(calls.filter(([route]) => route === 'result').map(([, body]) => body.job), ['j2']);
});

test('a task that is not built (Full automation\'s `auto`) is refused before the site is asked anything', async () => {
  const {runNight} = await import('../../../ready-fill/night.mjs');
  const {calls, fetchImpl} = site();
  await assert.rejects(runNight({chromium: fakeChromium({commands: []}), site: 'https://site.example', token: 't', task: 'auto', fetchImpl}), /unknown night task: auto/);
  assert.deepEqual(calls, []);
});

test('the poll answers only the night\'s owner, one read at a time, and refuses every application action', () => {
  const reader = createTriageReader({uuid: () => 'aaaaaaaa-1', set: () => 0, clear: () => {}});
  reader.read('https://boards.example.com/j1');
  reader.read('https://boards.example.com/j2');
  assert.deepEqual(readAnswer(reader, {action: 'poll', owner: 'someone'}), {ok: false});
  assert.deepEqual(readAnswer(null, {action: 'poll', owner: NIGHT_OWNER}), {ok: false}, 'a fill night has no reader');
  const first = readAnswer(reader, {action: 'poll', owner: NIGHT_OWNER});
  assert.equal(first.jobs.length, 1);
  assert.deepEqual(readAnswer(reader, {action: 'poll', owner: NIGHT_OWNER}).jobs, [], 'the second waits until the first answered');
  for (const action of ['ready', 'manual', 'fill', 'submit']) assert.deepEqual(readAnswer(reader, {action, owner: NIGHT_OWNER, session: first.jobs[0].session}), {ok: false}, action);
});
