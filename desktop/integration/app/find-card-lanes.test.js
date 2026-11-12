// Layer 2 (the app's own modules, no window): the Find jobs card shows what LinkedIn jobs did, one chip and one Live updates line per lane that really runs (issue #3705;
// owner, 10 Nov 2026: "I don't see any feedback about the Linkedin Jobs. It should be a separated lane/progress showing me feedback about how many roles it found").
// Real: the LinkedIn step (lib/linkedin-headless.js) saying its own lines, the run's log as the window gets it (renderer/run-lines.js keepRunLine) and the card's model
// (renderer/find-card-model.js findCard). Stood in: the hidden browser, its CDP, the extension's read (visits.runAll), the session (a FAKE value) and the engine's own lines.
// Nothing here reads a Keychain, opens a browser or reaches LinkedIn. Spec: docs/superpowers/specs/2026-10-31-linkedin-headless-design.md (States "Card says", Acceptance 3).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {linkedinStep} from '../../lib/linkedin-headless.js';
import {keepRunLine} from '../../renderer/run-lines.js';
import {findCard} from '../../renderer/find-card-model.js';

const SEARCHES = [1, 2, 3].map(n => ({name: `role${n}`, url: `https://www.linkedin.example/jobs/search/?keywords=role${n}`}));
const ENGINE = ['⏳ Searching job boards', 'Job boards: done, 15 job(s) for your search', '⏳ Reading employer job sites: 40 of 120',
  'Employers: read 120 of 120 sites in the time, best first; the other 0 are read first next time.'];

// One Find jobs press with LinkedIn jobs on: the engine's lines and the step's lines in one run log, the card drawn from it. `during` sees the card while a search is read.
async function press({on = true, session = {li_at: 'FAKE-LI-AT-1'}, ready = true, results = [], status = 0, runError = null, aborted = false, during = null, refresh = null} = {}) {
  const settings = {linkedinJobs: {on}}, log = [];
  const storage = {settings: () => settings, saveSettings: patch => Object.assign(settings, patch)};
  const say = line => keepRunLine(log, line);
  const card = () => findCard({running: {kind: 'search', log: [...log]}});
  ENGINE.forEach(say);
  const listeners = [];
  const browser = {ready: () => ready, start: async () => ({}), targetSocket: async id => `ws://127.0.0.1:1/${id}`,
    send: async method => (method === 'Target.createTarget' ? {targetId: 'T1'} : method === 'Storage.getCookies' ? {cookies: []} : {})};
  const openCdp = async () => ({send: async method => { if (method === 'Page.navigate' && status) listeners.forEach(fn => fn({type: 'Document', response: {url: 'https://www.linkedin.com/jobs/', status}})); return {}; },
    on: (event, fn) => listeners.push(fn), detach: async () => {}});
  let n = 0;
  const run = async (sites, options) => {
    if (runError) throw runError;
    options.openTab(`${sites[0].url}#jp-read-abcd1234`);
    if (n === 1 && during) during(card());
    options.tee(`  ✓ ${sites[0].name} · 10 jobs`);   // the read's per-search line: the Technical log's, never Live updates
    return [{answered: true, ok: true, pages: 1, ...sites[0], ...(results[n++] ?? {jobs: 10, fits: 0})}];   // the real result of a read: ok and pages say a page was read (visits.js), which the step counts as answered (#3710)
  };
  const controller = new AbortController();
  if (aborted) controller.abort();
  const result = await linkedinStep({storage, browser, openCdp, run, end: () => {}, tee: say, signal: controller.signal, searches: async () => SEARCHES, readSession: () => session,
    port: 1, token: 't', pause: async () => {}, refresh: refresh && (options => refresh(options, card))});
  return {result, card: card()};
}

const linkedinChips = model => model.chips.filter(chip => /LinkedIn/.test(chip.label));
const linkedinLines = model => model.lines.filter(line => /LinkedIn/.test(line));

// Each state of the spec's table: how the step is brought there, the chip it shows (state, words) and the one Live updates line (the step's own sentence).
const STATES = [
  ['done', {}, 'done', /^LinkedIn · 30 jobs read$/, /^LinkedIn: 30 jobs read$/],
  ['done, none new', {results: [{jobs: 0}, {jobs: 0}, {jobs: 0}]}, 'done', /^LinkedIn · none new$/, /^LinkedIn: none new$/],
  ['no-session', {session: null}, 'failed', /^LinkedIn · sign in$/, /^LinkedIn: sign in to LinkedIn/],
  ['signed-out', {results: [{jobs: 0, blocked: 'login'}]}, 'failed', /^LinkedIn · sign in$/, /^LinkedIn: sign in again/],
  ['check', {results: [{jobs: 0, blocked: 'check'}]}, 'failed', /^LinkedIn · asked for a check$/, /^LinkedIn asked for a check/],
  ['limited', {status: 429}, 'skipped', /^LinkedIn · asked to slow down$/, /^LinkedIn asked us to slow down/],
  ['no-browser', {ready: false}, 'failed', /^LinkedIn · browser to download$/, /download Jobadabra's browser/],
  ['failed', {runError: new Error('tab gone')}, 'failed', /^LinkedIn · not read$/, /^LinkedIn: could not be read this time$/],
  ['stopped', {aborted: true}, 'skipped', /^LinkedIn · stopped$/, /^LinkedIn: stopped$/],
];

test('LinkedIn jobs on: every state of the step gives the card one LinkedIn chip and one line in its words', async () => {
  for (const [name, how, state, label, line] of STATES) {
    const {result, card} = await press(how);
    assert.equal(result.state, name.split(',')[0], `${name}: the step reached the state`);
    const chips = linkedinChips(card), lines = linkedinLines(card);
    assert.equal(chips.length, 1, `${name}: one LinkedIn chip`);
    assert.equal(chips[0].state, state, `${name}: chip state`);
    assert.match(chips[0].label, label, `${name}: chip words`);
    assert.equal(lines.length, 1, `${name}: one LinkedIn line in Live updates (${lines.join(' | ')})`);
    assert.match(lines[0], line, `${name}: the step's own sentence`);
    assert.ok(card.lines.some(text => /^Job boards: done/.test(text)), `${name}: the engine's lines stay`);
  }
});

test('LinkedIn jobs on, while it reads: the chip says which search, and Live updates holds one LinkedIn line, the newest', async () => {
  let seen = null;
  await press({during: card => { seen = card; }});
  assert.ok(seen, 'the card was drawn while the second search was read');
  assert.deepEqual(linkedinChips(seen).map(chip => [chip.state, chip.label]), [['active', 'LinkedIn · search 2 of 3']]);
  assert.deepEqual(linkedinLines(seen), ['LinkedIn: reading search 2 of 3']);
});

test('LinkedIn jobs on, the sign-in copied again first: the chip works while it is copied, then says the result', async () => {
  let seen = null;   // lib/linkedin-refresh.js says its one note through the step's tee before any search (Gitar on #3860)
  const {card} = await press({refresh: async ({say}, draw) => { say('LinkedIn: copying your sign-in from Chrome again'); seen = draw(); }});
  assert.deepEqual(linkedinChips(seen).map(chip => [chip.state, chip.label]), [['active', 'LinkedIn']]);
  assert.deepEqual(linkedinLines(seen), ['LinkedIn: copying your sign-in from Chrome again']);
  assert.deepEqual(linkedinChips(card).map(chip => [chip.state, chip.label]), [['done', 'LinkedIn · 30 jobs read']], 'the note never stays as the lane\'s newest line');
  assert.deepEqual(linkedinLines(card), ['LinkedIn: 30 jobs read']);
});

test('LinkedIn jobs off: the card says nothing about LinkedIn', async () => {
  const {result, card} = await press({on: false});
  assert.equal(result.state, 'off');
  assert.deepEqual(linkedinChips(card), []);
  assert.deepEqual(linkedinLines(card), []);
  assert.ok(card.chips.length >= 3, 'the engine\'s own chips are still drawn');
});
