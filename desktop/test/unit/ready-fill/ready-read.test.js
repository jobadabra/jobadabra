// The cloud runner's read task (desktop/ready-fill/read-night.mjs, read-commands.mjs; spec docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md): each job's form is read the way the app's Apply readiness
// reads it (the extension's background poll, lib/triage-reader.js, the page kind from the Mac's AI rung through the site), the read goes to the site, nothing is filled or held, and the log has no question text.
// The site is faked at fetch (its /api/ready/ai answers as a model would) and the browser by a small stand-in whose worker plays the extension's side: it asks the page kind and judges with the extension's own verdictOf.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {verdictOf} from '../../../../extension/triage-verdict.js';
import {createTriageReader} from '../../../lib/triage-reader.js';
import {NIGHT_OWNER, readAnswer} from '../../../ready-fill/read-commands.mjs';

const job = id => ({id, url: `https://boards.example.com/${id}`, title: 'SRE', company: 'Acme', kit: {}, cv: '', letterPdf: ''});
// Each job's page as the extension's sketch sees it, the kind the model says, and the page's control counts.
const PAGES = {
  j1: {sketch: {title: 'Apply: SRE', headings: ['Apply'], controls: [{type: 'text', label: 'Name', required: true}, {type: 'textarea', label: 'Why do you want this role?', required: true}], buttons: ['Submit application']},
    model: {kind: 'form', confidence: 0.95}, counts: {fields: 1, textareas: 1}, questions: ['Why do you want this role?']},
  j2: {sketch: {title: 'Sign in', headings: ['Sign in'], controls: [{type: 'email', label: 'Email', required: true}, {type: 'password', label: 'Password', required: true}], buttons: ['Sign in']},
    model: {kind: 'account', account_step: 'sign_in', confidence: 0.95}, counts: {fields: 1, passwords: 1}},
};

// A browser with no pages: its worker answers the night's poll kick the way the extension does (poll, take the read, ask the page kind, judge, report the read).
function fakeChromium(seen) {
  let port = 0, storage = {};
  const call = async (route, body) => (await fetch(`http://127.0.0.1:${port}${route}`, {method: 'POST', body: JSON.stringify(body)})).json();
  const worker = {evaluate: async (fn, values) => {
    if (values?.workerUrl) { port = Number(new URL(values.workerUrl).port); storage = values; seen.storage = values; return true; }
    if (!String(fn).includes('__jobPilottoBackgroundSessions')) return true;   // the storage check
    const owner = storage.backgroundOwner, polled = await call('/extension/background-apply', {action: 'poll', owner});
    for (const command of polled.jobs || []) {
      seen.commands.push(command);
      const page = PAGES[new URL(command.url).pathname.slice(1)], session = command.session;
      await call('/extension/background-apply', {action: 'triage-step', owner, session, step: 'looking'});
      const kind = await call('/extension/page-kind', {url: command.url.split('#')[0], ...page.sketch});
      seen.kinds.push(kind.role || null);
      const verdict = verdictOf(kind?.role ? kind : null, page.counts);
      await call('/extension/background-apply', {action: 'triage-read', owner, session, ...verdict, ...(verdict.simple ? {questions: page.questions} : {})});
    }
    return true;
  }};
  return {launchPersistentContext: async (_profile, options) => { seen.args = options.args; return {serviceWorkers: () => [worker], route: async () => {}, newPage: async () => { seen.pages++; return {}; }, close: async () => {}}; }};
}

// The site: the batch, the live line (a Stop for `stopAt`), the results, and its AI route answering each page-kind ask as the model would (or refusing, as a spent cap does).
function site({stopAt = null, aiStatus = 200, over = false} = {}) {
  const calls = [];
  let asked = 0;
  const fetchImpl = async (url, init = {}) => {
    const route = new URL(url).pathname.replace('/api/ready/', ''), body = init.body ? JSON.parse(init.body) : null;
    calls.push([route, body]);
    const answer = (data, status = 200) => ({ok: status === 200, status, json: async () => data});
    if (route === 'batch') return asked++ === 0 ? answer({ok: true, night: '2026-11-08', contact: {}, jobs: [job('j1'), job('j2')]}) : answer(over ? {ok: false, error: 'unauthorized'} : {ok: true, jobs: []});
    if (route === 'progress') return answer({ok: true, stop: stopAt !== null && body.job === stopAt});
    if (route === 'ai') {
      if (aiStatus !== 200) return answer({ok: false}, aiStatus);
      const said = body.messages[0].content.includes('Sign in') ? PAGES.j2.model : PAGES.j1.model;
      return answer({stop_reason: 'end_turn', usage: {input_tokens: 10, output_tokens: 10}, content: [{type: 'text', text: JSON.stringify(said)}]});
    }
    return answer({ok: true, stop: false});
  };
  return {calls, fetchImpl};
}
const fresh = () => ({commands: [], kinds: [], pages: 0});

test('a read night reads each form through the app\'s own read and page-kind AI (through the site), tells the site each read, opens no page itself and logs no question', async () => {
  const {runNight} = await import('../../../ready-fill/night.mjs');
  const seen = fresh(), logs = [], {calls, fetchImpl} = site();
  const night = await runNight({chromium: fakeChromium(seen), site: 'https://site.example', token: 't', task: 'readiness', fetchImpl, log: (...line) => logs.push(JSON.stringify(line))});
  const results = calls.filter(([route]) => route === 'result').map(([, body]) => body);
  assert.deepEqual(results.map(body => [body.job, body.task, body.state]), [['j1', 'readiness', 'read'], ['j2', 'readiness', 'read']]);
  assert.deepEqual([results[0].read.simple, results[0].read.questions], [true, ['Why do you want this role?']], 'a simple form, its question for the site (which keeps it encrypted)');
  assert.deepEqual([results[1].read.simple, results[1].read.login], [false, true], 'a sign-in page reads as a login');
  assert.deepEqual(seen.kinds, ['form', 'account'], 'each page kind came from the AI rung');
  assert.equal(calls.filter(([route]) => route === 'ai').length, 2, 'each ask went through the site\'s AI (the night token, its cost cap)');
  assert.ok(seen.commands.every(command => command.mode === 'read' && command.url.endsWith(`#jobpilotto-fill=${command.session}`)), 'each read is handed out as a read, its tab marked with its own id');
  assert.equal(seen.storage.backgroundOwner, NIGHT_OWNER, 'the extension polls as the night');
  const copy = seen.args.find(arg => arg.startsWith('--load-extension=')).split('=')[1];
  assert.ok(fs.existsSync(path.join(copy, 'owned-bootstrap.js')), 'the copy is the app-owned kind, as the Mac\'s hidden browser');
  assert.equal(seen.pages, 0, 'the night opens no page of its own: the extension opens the read');
  assert.equal(night.held.size, 0, 'a read holds nothing for the morning');
  assert.ok(logs.length && !logs.some(line => line.includes('Why do you want')), 'the log has counts and words, never a question');
});

test('a refused AI (the night\'s cap spent) gives no kind: each form reads as not simple, "unknown", as on the Mac, never a guess', async () => {
  const {runNight} = await import('../../../ready-fill/night.mjs');
  const {calls, fetchImpl} = site({aiStatus: 402});
  await runNight({chromium: fakeChromium(fresh()), site: 'https://site.example', token: 't', task: 'readiness', fetchImpl});
  assert.deepEqual(calls.filter(([route]) => route === 'result').map(([, body]) => [body.state, body.read?.simple, body.read?.why]), [['read', false, 'unknown'], ['read', false, 'unknown']]);
});

test('a job the owner stops while it is read sends no result, and the next job is still read; a night that is over reads no more', async () => {
  const {runNight} = await import('../../../ready-fill/night.mjs');
  const one = site({stopAt: 'j1'});
  await runNight({chromium: fakeChromium(fresh()), site: 'https://site.example', token: 't', task: 'readiness', fetchImpl: one.fetchImpl});
  assert.deepEqual(one.calls.filter(([route]) => route === 'result').map(([, body]) => body.job), ['j2']);
  const ended = site({stopAt: 'j1', over: true}), seen = fresh();
  await runNight({chromium: fakeChromium(seen), site: 'https://site.example', token: 't', task: 'readiness', fetchImpl: ended.fetchImpl});
  assert.deepEqual(ended.calls.filter(([route]) => route === 'result'), [], 'nothing reported');
  assert.equal(seen.commands.length, 1, 'j2 was never handed to the extension');
});

test('a task the night does not have is refused before the site is asked anything', async () => {
  const {runNight} = await import('../../../ready-fill/night.mjs');
  const {calls, fetchImpl} = site();
  await assert.rejects(runNight({chromium: fakeChromium(fresh()), site: 'https://site.example', token: 't', task: 'submit', fetchImpl}), /unknown night task: submit/);
  assert.deepEqual(calls, []);
});

test('the poll answers only the night\'s owner, one read at a time, and refuses every application action', () => {
  const reader = createTriageReader({uuid: () => 'aaaaaaaa-1', set: () => 0, clear: () => {}});
  reader.read('https://boards.example.com/j1');
  reader.read('https://boards.example.com/j2');
  assert.deepEqual(readAnswer(reader, {action: 'poll', owner: 'someone'}), {ok: false});
  const first = readAnswer(reader, {action: 'poll', owner: NIGHT_OWNER});
  assert.equal(first.jobs.length, 1);
  assert.deepEqual(readAnswer(reader, {action: 'poll', owner: NIGHT_OWNER}).jobs, [], 'the second waits until the first answered');
  for (const action of ['ready', 'manual', 'fill', 'submit']) assert.deepEqual(readAnswer(reader, {action, owner: NIGHT_OWNER, session: first.jobs[0].session}), {ok: false}, action);
});

test('the fill night\'s files load without the read\'s: night.mjs and stand-in.mjs import nothing from desktop/lib but the form address (the image carries only that until web 2/4)', () => {
  const here = path.resolve(import.meta.dirname, '../../../ready-fill');
  for (const file of ['night.mjs', 'stand-in.mjs', 'night-browser.mjs', 'fill-job.mjs']) {
    const lib = [...fs.readFileSync(path.join(here, file), 'utf8').matchAll(/^import [^;]*from '(\.\.\/\.\.\/desktop\/lib\/[^']+)'/gm)].map(match => match[1]);
    assert.ok(lib.every(spec => spec.endsWith('/form-address.js')), `${file}: ${lib.join(', ')}`);
  }
});
