// Guard: safety — without it a board read in Jobadabra's headless Chrome could start outside the person's own Find jobs press, reach a login-wall site, hide that it is
// an automated browser, or leave the read's profile (cookies a site set) on disk. Owner, 12 Nov 2026, asked via AskUserQuestion: "Yes, accept it (Recommended)" (read during
// every Find jobs press, in Jobadabra's own headless Chrome, fresh profile, no cookies or logins, honest user agent, no stealth, only loading the listing page, never the
// login-wall sites); rule: CLAUDE.md, the refused-sites exception.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {besideSteps, setBoardsStep, setLinkedinStep} from '../../../lib/search-beside.js';
import {boardsStep, mayRead} from '../../../lib/headless-boards.js';
import {boardReadBrowser, boardsSeams, FOLDER} from '../../../lib/headless-boards-beside.js';
import {browserArguments} from '../../../lib/background-browser.js';

const lib = new URL('../../../lib/', import.meta.url);
const read = file => fs.readFileSync(new URL(file, lib), 'utf8');
const BOARD = {url: 'https://board.example.net/jobs?q=nurse', name: 'Example board', kind: 'board'};

test('only a person\'s own Find jobs press runs the boards step: never the timer, a re-score, Find more employers or a noted run', async () => {
  const presses = [
    [{mode: 'run', trigger: 'you'}, true], [{mode: 'run', trigger: 'first'}, true],
    [{mode: 'run', trigger: 'timer'}, false], [{mode: 'rescore', trigger: 'you'}, false],
    [{mode: 'run', trigger: 'you', employers: true}, false], [{mode: 'run', trigger: 'you', note: 'Search wider'}, false]];
  for (const [press, reads] of presses) {
    let ran = 0;
    setLinkedinStep(null);
    setBoardsStep(async () => { ran++; return {state: 'off', jobs: 0}; });
    try { await besideSteps({}, () => {}, null, press, async () => ({code: 0})); } finally { setBoardsStep(null); }
    assert.equal(ran, reads ? 1 : 0, JSON.stringify(press));
  }
});

test('the step is registered in one place and started by nothing else', () => {
  const files = fs.readdirSync(lib, {recursive: true}).filter(file => /\.m?js$/.test(file)).map(file => file.split(path.sep).join('/'));
  const using = pattern => files.filter(file => pattern.test(read(file))).sort();
  assert.deepEqual(using(/setBoardsStep\(/), ['visits-handlers.js'], 'registered once, by the visits handlers');
  assert.deepEqual(using(/await boardsStep\(\{/), ['headless-boards-beside.js'], 'run only through the registered seams');
  assert.deepEqual(using(/from '\.\/headless-boards-beside\.js'/), ['visits-handlers.js']);
  assert.match(read('visits-handlers.js'), /if \(!DEMO\) setBoardsStep\(boardsSeams\(storage\)\.step\);/);
});

test('never a login-wall site, an address that is not https, or an employer site (they stay with the button)', async () => {
  for (const host of ['www.linkedin.com', 'de.indeed.com', 'www.glassdoor.com', 'www.levels.fyi', 'www.reddit.com', 'www.xing.com']) assert.equal(mayRead({...BOARD, url: `https://${host}/jobs`}), false, host);
  assert.equal(mayRead({...BOARD, url: 'http://board.example.net/jobs'}), false);
  assert.equal(mayRead({...BOARD, kind: 'employer'}), false);
  assert.equal(mayRead(BOARD), true);
  const opened = [];
  const browser = {ready: () => true, send: async (method, params) => { opened.push(params?.url); return {targetId: 't'}; }, targetSocket: async () => 'ws://127.0.0.1:9/t'};
  await boardsStep({browser, start: async () => {}, queue: async () => [{...BOARD, url: 'https://www.linkedin.com/jobs'}], begin: async () => true, judge: async () => 'page', outcome: async () => ({}), sleep: async () => {}});
  assert.deepEqual(opened, [], 'a queue that names a login-wall site opens nothing');
});

test('an honest browser: no user agent override, no flag or command that hides automation, no click, key or cookie', () => {
  const args = browserArguments('/tmp/profile', '/tmp/extension', {});
  assert.ok(args.includes('--enable-automation'), 'the browser says it is automated');
  assert.ok(args.includes('--headless=new'));
  for (const arg of args) assert.doesNotMatch(arg, /user-agent|AutomationControlled|stealth|disable-blink-features/i, arg);
  const source = read('headless-boards.js') + read('headless-boards-beside.js');
  assert.doesNotMatch(source, /UserAgentOverride|Emulation\.|Input\.|setCookies|navigator\.webdriver|addScriptToEvaluateOnNewDocument/);
});

test('the read\'s profile is deleted before and after, whatever ended the step', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-board-read-'));
  const storage = {path: name => path.join(home, name), settings: () => ({})};
  const folder = storage.path(FOLDER);
  const seen = {};
  try {
    for (const ending of ['no-browser', 'throws']) {
      fs.mkdirSync(path.join(folder, 'profile', 'Default'), {recursive: true});
      fs.writeFileSync(path.join(folder, 'profile', 'Default', 'Cookies'), 'a cookie a site set last time');
      const makeBrowser = s => {
        const real = boardReadBrowser(s, {find: () => null});   // no runtime downloaded: nothing is ever spawned
        return ending === 'throws' ? {...real, ready: () => { seen.before = fs.existsSync(folder); throw new Error('broke'); }} : {...real, ready: () => { seen.before = fs.existsSync(folder); return false; }};
      };
      const run = async () => ({code: 0, stdout: JSON.stringify({ok: true, sites: [BOARD]})});
      const {step} = boardsSeams(storage, {makeBrowser, run});
      await step(null, () => {}).catch(() => {});
      assert.equal(seen.before, false, `${ending}: a leftover profile is gone before the read`);
      assert.equal(fs.existsSync(folder), false, `${ending}: the profile is gone after the read`);
    }
  } finally { fs.rmSync(home, {recursive: true, force: true}); }
});
