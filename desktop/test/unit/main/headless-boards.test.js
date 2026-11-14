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

function run(list, pages, {judgeStates = {}, signal = null, ready = true, now = Date.now, outcomeFor = () => ({ok: true, state: 'read', jobs: 3, fits: 2}), share = Infinity, ask = null, told = null} = {}) {
  const fake = fakeBrowser(pages, {ready});
  const judged = [], outcomes = [], lines = [];
  let started = 0, begun = 0;
  const begin = async () => begun++ < share;
  const judge = async page => { judged.push(page.url); if (!(page.url in judgeStates)) return 'page'; const answer = judgeStates[page.url]; return Array.isArray(answer) ? answer.shift() : answer; };
  const outcome = async page => { outcomes.push(page); return outcomeFor(page); };
  const done = boardsStep({browser: fake.browser, start: async () => { started++; }, queue: async () => list, begin, judge, outcome, ask, told, openCdp: fake.openCdp,
    tee: line => lines.push(line), signal, now, sleep: async () => {}});
  return done.then(result => ({result, judged, outcomes, lines, started: () => started, begun: () => begun, ...fake}));
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

// A first press: the queue is empty at second 0 and the plain reader is refused by a board at ~30 s (night 43313523472: p1's Jobs.bg at 28 s, p3's Jobat at 33 s).
// The step asks the queue again each time the board memory changes, until Stop or the press's deadline; the caps hold for the whole press.
function later(lists, {changes = lists.length - 1, share = Infinity} = {}) {
  const fake = fakeBrowser({});
  const asked = [], outcomes = [], lines = [];
  let started = 0, begun = 0, told = 0;
  const queue = async () => { asked.push(asked.length); return lists[Math.min(asked.length - 1, lists.length - 1)]; };
  const changed = async () => told++ < changes;
  return boardsStep({browser: fake.browser, start: async () => { started++; }, queue, changed, begin: async () => begun++ < share, judge: async () => 'page',
    outcome: async page => { outcomes.push(page.url); return {ok: true, state: 'read', jobs: 2, fits: 1}; }, openCdp: fake.openCdp, tee: line => lines.push(line), sleep: async () => {}})
    .then(result => ({result, asked, outcomes, lines, started: () => started}));
}

test('a board refused later in the same press is read when the board memory changes', async () => {
  const a = board(1);
  const {result, outcomes, asked, started} = await later([[], [a]]);
  assert.deepEqual(outcomes, [a.url]);
  assert.equal(asked.length, 2, 'asked at the start, then once after the change');
  assert.equal(started(), 1, 'the browser starts only when a board is due');
  assert.deepEqual(result, {state: 'done', jobs: 2, fits: 1, read: 1, of: 1});
});

test('the queue is not asked again while the board memory is unchanged; nothing due: nothing starts', async () => {
  const {result, asked, started, lines} = await later([[]], {changes: 0});
  assert.equal(asked.length, 1);
  assert.equal(started(), 0);
  assert.deepEqual(lines, []);
  assert.deepEqual(result, {state: 'off', jobs: 0});
});

test('a board already read in this press is never opened again, and MAX_BOARDS holds across the queue\'s answers', async () => {
  const first = [board(1), board(2), board(3)];
  const {outcomes} = await later([first, [...first, board(4), board(5), board(6), board(7)], [board(8)]]);
  assert.deepEqual(outcomes, [1, 2, 3, 4, 5].map(n => board(n).url));
});

test('today\'s share spent on a board named later: nothing more is opened and the step ends', async () => {
  const {outcomes, asked, lines} = await later([[board(1)], [board(2)], [board(3)]], {share: 1});
  assert.deepEqual(outcomes, [board(1).url]);
  assert.equal(asked.length, 2, 'not asked again after the engine said the share is used');
  assert.match(lines.at(-1), /today's reads in Jobadabra's browser are used/);
});

test('the board memory watch: true once the file changed, false at the engine\'s end with nothing new, one last look first', async () => {
  const {memoryWatch} = await import('../../../lib/headless-boards-beside.js');
  let stamp = 1;
  const ended = new AbortController();
  const looks = [];
  const watch = memoryWatch('/nowhere/found_boards.json', {sleep: async () => {}, stat: async () => { looks.push(stamp); return stamp; }});
  await watch.mark();
  stamp = 2;
  assert.equal(await watch.changed(null, ended.signal), true, 'a write since the mark');
  ended.abort();
  stamp = 3;
  assert.equal(await watch.changed(null, ended.signal), true, 'the engine ended right after its last write: still seen');
  assert.equal(await watch.changed(null, ended.signal), false, 'ended and nothing new: the step ends');
  const stop = new AbortController();
  stop.abort();
  assert.equal(await watch.changed(stop.signal, null), false, 'Stop: no look at all');
});

test('Gitar on #3944: with today\'s share already used, no board is said to be read and none is counted', async () => {
  const {result, lines} = await run([board(1), board(2)], {}, {share: 0});
  assert.deepEqual(result, {state: 'done', jobs: 0, fits: 0, read: 0, of: 0});
  assert.ok(!lines.some(text => /reading \d/.test(text)), lines.join('\n'));
  assert.match(lines.at(-1), /today's reads in Jobadabra's browser are used/);
});

// CI's shared mark (tools/persona-search/board-mark.mjs; owner, 14 Nov 2026: "Once per search page (Recommended)"): `ask` decides before anything is spent or loaded.
test('CI: a page another CI search read today is reused from its jobs (cards): no share spent, no page loaded, its jobs counted', async () => {
  const b = board(1), cards = [{title: 'Nurse', url: 'https://board1.example.net/job/1', lines: ['Exampletown']}];
  const {result, outcomes, lines, tabCalls, begun} = await run([b], {[b.url]: {status: 200, html: JOBS}}, {ask: async () => ({go: false, cards}), outcomeFor: () => ({ok: true, state: 'read', jobs: 1, fits: 1})});
  assert.equal(begun(), 0, 'the day share is not spent');
  assert.ok(!tabCalls.includes('Page.navigate'), 'no request to the board');
  assert.deepEqual(outcomes.map(page => [page.url, page.html, page.cards]), [[b.url, '', cards]]);
  assert.equal(result.jobs, 1);
  assert.match(lines.join('\n'), /another CI search read today, nothing sent/);
});

test('CI: a page the mark refuses is skipped with its reason and the next board is still read; a read tells the mark how it ended', async () => {
  const [b1, b2] = [board(1), board(2)], told = [];
  const ask = async item => (item.url === b1.url ? {go: false, why: 'turned CI\'s browser away before, so no CI search opens it again'} : {go: true});
  const {outcomes, lines, begun} = await run([b1, b2], {[b1.url]: {status: 200, html: JOBS}, [b2.url]: {status: 200, html: JOBS}}, {ask, told: async (item, answer) => { told.push([item.url, answer.state]); }});
  assert.deepEqual(outcomes.map(page => page.url), [b2.url], 'b1 never loaded nor sent to the engine');
  assert.equal(begun(), 1);
  assert.deepEqual(told, [[b2.url, 'read']]);
  assert.match(lines.join('\n'), /Board 1: turned CI's browser away before/);
});

test('CI: a mark that throws is a skip, never a read on a guess', async () => {
  const b = board(1);
  const {outcomes, tabCalls, lines} = await run([b], {[b.url]: {status: 200, html: JOBS}}, {ask: async () => { throw new Error('HTTP 503'); }});
  assert.equal(outcomes.length, 0); assert.ok(!tabCalls.includes('Page.navigate'));
  assert.match(lines.join('\n'), /shared CI mark did not answer/);
});
