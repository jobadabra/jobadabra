// Job boards that refuse plain reading, read in Jobadabra's own headless Chrome during a Find jobs press (owner, 12 Nov 2026: "Yes, as boards (Recommended)"): one board at a
// time, only loading its page (the tab's commands are a fixed short list), the engine's AI says what the page is, a refusal status skips the AI, a passive check is only
// waited for, a captcha or sign-in page is passed on as a stop, a busy AI is never a guess, and Stop leaves the boards not reached for the next press.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {boardsStep, mayRead, MAX_BOARDS} from '../../../lib/headless-boards.js';

const JOBS = '<html><title>Jobs</title><body>Nurse, Exampletown</body></html>';
const board = n => ({url: `https://board${n}.example.net/jobs?q=nurse`, name: `Board ${n}`, kind: 'board'});

// A fake owned browser: each tab answers Page.navigate with `pages[url]` = {status, html}, and Runtime.evaluate with that page.
function fakeBrowser(pages, {ready = true} = {}) {
  const calls = [], tabCalls = [];
  let open = 0;
  const browser = {
    ready: () => ready,
    send: async method => { calls.push(method); return method === 'Target.createTarget' ? {targetId: `t${++open}`} : {}; },
    targetSocket: async id => `ws://127.0.0.1:9/${id}`,
  };
  const openCdp = async () => {
    const listeners = {};
    let page = {status: 0, html: ''}, url = '';
    return {
      on: (event, fn) => { (listeners[event] ||= []).push(fn); },
      detach: async () => { tabCalls.push('detach'); },
      send: async (method, params) => {
        tabCalls.push(method);
        if (method === 'Page.navigate') {
          url = params.url;
          page = pages[url] || {status: 0, html: ''};
          (listeners['Network.responseReceived'] || []).forEach(fn => fn({type: 'Document', response: {status: page.status, url}}));
          (listeners['Page.loadEventFired'] || []).forEach(fn => fn({}));
        }
        return method === 'Runtime.evaluate' ? {result: {value: JSON.stringify({html: page.html, title: 'Jobs', final: url})}} : {};
      },
    };
  };
  return {browser, openCdp, calls, tabCalls};
}

function run(list, pages, {judgeStates = {}, signal = null, ready = true, now = Date.now, outcomeFor = () => ({ok: true, state: 'read', jobs: 3, fits: 2}), share = Infinity} = {}) {
  const fake = fakeBrowser(pages, {ready});
  const judged = [], outcomes = [], lines = [];
  let started = 0, begun = 0;
  const begin = async () => begun++ < share;
  const judge = async page => { judged.push(page.url); if (!(page.url in judgeStates)) return 'page'; const answer = judgeStates[page.url]; return Array.isArray(answer) ? answer.shift() : answer; };
  const outcome = async page => { outcomes.push(page); return outcomeFor(page); };
  const done = boardsStep({browser: fake.browser, start: async () => { started++; }, queue: async () => list, begin, judge, outcome, openCdp: fake.openCdp,
    tee: line => lines.push(line), signal, now, sleep: async () => {}});
  return done.then(result => ({result, judged, outcomes, lines, started: () => started, ...fake}));
}

test('a board judged a page is read once with the headless step and its jobs are counted and listed', async () => {
  const b = board(1);
  const {result, outcomes, lines, tabCalls, calls} = await run([b], {[b.url]: {status: 200, html: JOBS}});
  assert.deepEqual(result, {state: 'done', jobs: 3, fits: 2, read: 1, of: 1});
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].step, 'headless');
  assert.equal(outcomes[0].status, 200);
  assert.equal(outcomes[0].html, JOBS);
  assert.equal(outcomes[0].judged, 'page', 'the AI\'s answer as it came: the engine says what it means');
  assert.ok(lines.some(line => line.includes('Board 1: 3 jobs read')), 'each read is a line of the Find jobs run (Recent activity)');
  assert.deepEqual([...new Set(tabCalls)].sort(), ['Network.enable', 'Page.enable', 'Page.navigate', 'Runtime.evaluate', 'detach'].sort(), 'only loading and reading the page: no click, key or cookie');
  assert.ok(calls.includes('Target.closeTarget'), 'the tab is closed after the board');
});

test('a 401, 403 or 429 goes to the engine with no AI asked; the engine keeps the stop or the wait', async () => {
  for (const status of [401, 403, 429]) {
    const b = board(status);
    const answer = status === 429 ? {ok: true, state: 'waiting', why: 'asked us to slow down'} : {ok: true, state: 'stopped', why: `HTTP ${status}`, final: true};
    const {judged, outcomes, lines} = await run([b], {[b.url]: {status, html: ''}}, {outcomeFor: () => answer});
    assert.deepEqual(judged, [], `${status}: no AI call`);
    assert.equal(outcomes[0].status, status);
    assert.equal(lines.at(-1), status === 429 ? `Job boards: Board ${status}: asked us to slow down`
      : `Job boards: Board ${status}: turned Jobadabra's browser away, so its browser will not open this board again`, 'Recent activity says it in the person\'s words');
    assert.ok(!lines.some(line => /HTTP \d/.test(line)), 'no status code in Recent activity');
  }
});

test('a passive check is only waited for: judged again until it is a page; one that lasts is passed on as a stop', async () => {
  const b = board(1);
  const cleared = await run([b], {[b.url]: {status: 200, html: JOBS}}, {judgeStates: {[b.url]: ['passive_check', 'passive_check', 'page']}});
  assert.equal(cleared.judged.length, 3);
  assert.equal(cleared.outcomes[0].judged, 'page');
  let clock = 0;
  const lasting = await run([b], {[b.url]: {status: 200, html: JOBS}}, {judgeStates: {[b.url]: 'passive_check'}, now: () => (clock += 10000)});
  assert.equal(lasting.outcomes[0].judged, 'passive_check');
  assert.ok(!lasting.tabCalls.some(method => /^Input\./.test(method)), 'never a click or a key');
});

test('a captcha, a sign-in or refused page go to the engine as the AI said them; a busy AI is never a guess', async () => {
  const [a, b, c, d] = [1, 2, 3, 4].map(board);
  const pages = Object.fromEntries([a, b, c, d].map(item => [item.url, {status: 200, html: JOBS}]));
  const {outcomes} = await run([a, b, c, d], pages, {judgeStates: {[a.url]: 'captcha', [b.url]: 'login', [c.url]: 'refused', [d.url]: null}});
  assert.equal(outcomes[0].judged, 'captcha');
  assert.equal(outcomes[1].judged, 'login');
  assert.equal(outcomes[2].judged, 'refused');
  assert.ok(!('judged' in outcomes[3]) && !('captcha' in outcomes[3]), 'not judged: the engine floors decide, no verdict is made up');
});

test('Stop after the first board: the next is never opened and waits for the next press', async () => {
  const stop = new AbortController();
  const [a, b] = [board(1), board(2)];
  const {result, outcomes, tabCalls} = await run([a, b], {[a.url]: {status: 200, html: JOBS}, [b.url]: {status: 200, html: JOBS}},
    {signal: stop.signal, outcomeFor: () => { stop.abort(); return {ok: true, state: 'read', jobs: 1, fits: 0}; }});
  assert.equal(result.state, 'stopped');
  assert.equal(outcomes.length, 1);
  assert.equal(tabCalls.filter(method => method === 'Page.navigate').length, 1);
});

test('nothing queued: nothing starts and nothing is said; no browser yet: one line, nothing starts', async () => {
  const empty = await run([], {});
  assert.deepEqual(empty.result, {state: 'off', jobs: 0});
  assert.equal(empty.started(), 0);
  assert.deepEqual(empty.lines, []);
  const missing = await run([board(1)], {}, {ready: false});
  assert.equal(missing.result.state, 'no-browser');
  assert.equal(missing.started(), 0);
  assert.match(missing.lines[0], /download Jobadabra's browser/);
});

test('at most MAX_BOARDS boards a press, and only boards the gate allows', async () => {
  const list = [...Array.from({length: 8}, (_, n) => board(n + 1)), {url: 'https://careers.example.com/jobs', name: 'Employer', kind: 'employer'}];
  const {outcomes} = await run(list, {});
  assert.equal(outcomes.length, MAX_BOARDS);
  assert.equal(mayRead(list[8]), false, 'employer sites stay with the button until PR 2');
});

test('today\'s share is spent before each page loads: when the engine says it is used, nothing more is opened', async () => {
  const list = [board(1), board(2), board(3)];
  const {outcomes, lines, tabCalls} = await run(list, {}, {share: 1});
  assert.equal(outcomes.length, 1);
  assert.equal(tabCalls.filter(method => method === 'Page.navigate').length, 1);
  assert.match(lines.at(-1), /today's reads in Jobadabra's browser are used/);
});

test('an engine answer that never came is not counted as a board read', async () => {
  const {result, lines} = await run([board(1)], {}, {outcomeFor: () => { throw new Error('the engine broke'); }});
  assert.deepEqual(result, {state: 'done', jobs: 0, fits: 0, read: 0, of: 1});
  assert.match(lines.at(-1), /Board 1: not read/);
});
