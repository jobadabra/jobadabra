/* global document, window */
// "See which jobs can apply automatically" while it runs, layer 2 (#3519): the demo window on fictional jobs whose form read is held by the test, so every press follows a state, never a delay.
// The owner's scenario (7 Nov 2026, two screenshots): press Check 10 jobs -> an empty grey bar, no words, an inline Cancel AND Close AND a greyed Check, the number still an input.
// Expected: at once "Checking 1 of N · <company>", a bar that moves, ONE footer (Close + Stop), the count read-only; Stop says it is stopping; afterwards the idle dialog is back.
// The read is the page's own `runTriage` fed a held read (the preload bridge is frozen, so a test cannot replace window.pilot.triageRead); Stop is the real wired button.
// Every wait has a 15 s cap (hang guard, named by what it waited for): nine of them stay inside the window's 180 s timeout, so a stall is reported by stage, not by a killed launch.
// Job: serve stored answers
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const COMPANIES = ['Alder Works', 'Birch Labs', 'Cedar Group'];
const JOBS = COMPANIES.map((company, index) => ({id: index + 1, code: `r${index + 1}`, title: `Running Engineer ${index + 1}`, company, stage: null, location: 'Zurich', work_mode: 'Hybrid',
  url: `https://jobs.triage-running.example/roles/${index + 1}`, posted_at: '2099-01-01', first_seen_at: '2099-01-01', status: 'unreviewed', fit: 90 - index, reason: 'A fictional match.', rank: 100 - index, skills: []}));
let screen;

before(() => {
  if (needsElectron.skip) return;
  screen = probeWindow({files: {'jobs.json': {jobs: JOBS, total: JOBS.length, filtered: JOBS.length}}, timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu', 15000);
    await kit.go('jobs');
    await kit.until(() => (window.__jp.shared.allJobs || []).length >= 3, 'the three jobs to be listed', 15000);
    const {runTriage} = await import('./pages/jobs-triage.js');
    const shown = element => !!element && !element.hidden && element.offsetParent !== null;
    const look = () => {
      const dialog = document.getElementById('triage-dialog'), field = document.getElementById('triage-n');
      return {
        footer: [...dialog.querySelectorAll('.dialog-foot button')].filter(shown).map(button => button.textContent.trim()),
        inline: [...dialog.querySelectorAll('#triage-progress button')].filter(shown).length,
        elapsed: document.getElementById('triage-elapsed').textContent.trim(), results: [...document.querySelectorAll('#triage-results li')].map(li => li.textContent.trim()),
        words: shown(document.getElementById('triage-progress')) ? document.getElementById('triage-progress-text').textContent.trim() : '',
        width: document.getElementById('triage-bar').style.width, sliding: document.querySelector('#triage-progress .bar')?.classList.contains('is-sliding') === true,
        fieldLocked: field.disabled || field.readOnly, stopDisabled: document.getElementById('triage-cancel').disabled,
        count: shown(document.getElementById('triage-count')),
      };
    };
    document.getElementById('triage-open').click();
    await kit.until(() => document.getElementById('triage-dialog').open, 'the popup', 15000);
    await kit.until(() => document.getElementById('triage-start').textContent.trim() === 'Check 3 jobs', 'the popup to offer Check 3 jobs', 15000);
    const idle = look();
    const jobs = (window.__jp.shared.allJobs || []).slice(0, 3), gates = new Map();
    const read = job => new Promise(release => gates.set(job.url, release));
    const run = runTriage(jobs, read);
    const first = await kit.until(() => { const now = look(); return now.words ? now : ''; }, 'words on the progress while the first read is held', 15000);
    // The owner's case: the first read is still held and the dialog must still change by itself (the seconds), not only when a read ends.
    const ticked = await kit.until(() => { const now = look(); return now.elapsed !== first.elapsed ? now : ''; }, 'the seconds to move while the first read is held', 15000);
    gates.get(jobs[0].url)({eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: true});
    const second = await kit.until(() => { const now = look(); return /2 of 3/.test(now.words) ? now : ''; }, 'the second job to be named while its read is held', 15000);
    document.getElementById('triage-cancel').click();
    const stopping = await kit.until(() => { const now = look(); return now.stopDisabled ? now : ''; }, 'Stop to say it is stopping', 15000);
    gates.get(jobs[1].url)(null);
    const done = await run;
    const after = await kit.until(() => { const now = look(); return now.words === '' ? now : ''; }, 'the idle dialog to come back', 15000);
    // L2a (owner 7 Nov 2026, three statuses): a read that could not be made is listed as "Couldn't read" with its reason, counted apart, and offered again; the others are unchanged.
    const reads = {[jobs[1].url]: {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: null, simple: true, why: ''}, [jobs[2].url]: {unreadable: true, why: 'timeout'}};
    const mixed = await runTriage([jobs[1], jobs[2]], async job => reads[job.url]);
    const rows = [...document.querySelectorAll('#triage-results li')].map(li => li.textContent.replace(/\s+/g, ' ').trim());
    const again = (await import('./pages/jobs-triage.js')).readOf(jobs[2].url);
    // Gitar on #3556: the re-offer and the reason were never asserted (the old `read !== null` would pass the line above too): the idle dialog must offer the unreadable job again, and the chip's tooltip is the reason.
    const offered = (await kit.until(() => { const now = look(); return now.words === '' ? now : ''; }, 'the idle dialog after the mixed run', 15000)).footer;
    const reason = document.querySelectorAll('#triage-results li')[1]?.querySelector('[title]')?.title;
    // L2b: once every read is in, the simple forms' questions go to ONE match: the dialog says so, has no Stop (a call cannot be stopped), and the form's line is drawn again with what it lacks.
    const asks = {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: null, simple: true, why: '', questions: ['Start date']};
    let answerMatch; const held = new Promise(resolve => { answerMatch = resolve; }), asked = [];
    const matched = runTriage([jobs[0]], async () => asks, async reads => { asked.push(reads); return held; });
    const matching = await kit.until(() => { const now = look(); return now.words === 'Matching your saved answers…' ? now : ''; }, 'the matching words while the match is held', 15000);
    answerMatch({[jobs[0].url]: {missing: [{kind: 'detail', label: 'Notice period'}], unjudged: 0}});
    await matched;
    const split = document.querySelector('#triage-results li [title]')?.title;
    const splitChip = document.querySelector('#triage-results li')?.textContent.replace(/\s+/g, ' ').trim();
    return {idle, first, ticked, second, stopping, done, after, order: jobs.map(job => job.company), gated: [...gates.keys()].length, mixed, rows, again, offered, reason, matching: matching.footer, asked, split, splitChip};
  }});
});

test('the moment a check starts the dialog says which job it is reading, with a bar that is moving', live, () => {
  const {first} = screen.result;
  assert.match(first.words, /^Checking 1 of 3 · Alder Works$/);
  assert.equal(first.sliding, true, 'before the first read ends the bar slides, so a running check never looks still');
});

test('while the first read is still held the dialog keeps changing by itself: the seconds count up and the words stay', live, () => {
  const {first, ticked} = screen.result;
  assert.match(first.elapsed, /^\d+:\d\d$/);
  assert.notEqual(ticked.elapsed, first.elapsed);
  assert.equal(ticked.words, first.words);
  assert.deepEqual(first.results, [], 'nothing finished yet');
});

test('after one read the bar shows its share and names the next job', live, () => {
  const {second} = screen.result;
  assert.match(second.words, /^Checking 2 of 3 · Birch Labs$/);
  assert.equal(second.width, '33%');
  assert.equal(second.sliding, false);
  assert.equal(second.results.length, 1, 'the finished job is listed as soon as it lands');
  assert.match(second.results[0], /^Alder Works · Running Engineer 1/);
});

test('while it runs there is one footer: Close and Stop, no stale Check, no inline Cancel, and the count cannot be edited', live, () => {
  const {idle, first, second} = screen.result;
  assert.deepEqual(idle.footer, ['Close', 'Check 3 jobs']);
  for (const state of [first, second]) {
    assert.deepEqual(state.footer, ['Close', 'Stop']);
    assert.equal(state.inline, 0, 'no second Cancel inside the progress');
    assert.equal(state.fieldLocked, true, 'the count is read-only while the check runs');
    assert.equal(state.count, false, 'the "about N minutes" guess gives way to the progress');
  }
  assert.equal(idle.fieldLocked, false);
});

test('Stop says it is stopping, reads nothing more, and the idle dialog comes back with Check', live, () => {
  const {stopping, done, after, gated} = screen.result;
  assert.match(stopping.words, /^Stopping/);
  assert.equal(stopping.stopDisabled, true);
  assert.deepEqual(done, {read: 1, failed: 0}, 'only the one finished read counts');
  assert.equal(gated, 2, 'the third job was never read');
  assert.deepEqual(after.footer, ['Close', 'Check 2 jobs'], 'the one job read is no longer offered');
  assert.equal(after.fieldLocked, false);
  assert.equal(after.inline, 0);
});

test('a read that could not be made is listed as Couldn\'t read with its reason, counted apart from the reads, and the others say Simple form', live, () => {
  const {mixed, rows, again} = screen.result;
  assert.deepEqual(mixed, {read: 1, failed: 1});
  assert.equal(rows.length, 2);
  assert.match(rows[0], /Birch Labs.*Simple form/);
  assert.match(rows[1], /Cedar Group.*Couldn't read/);
  assert.equal(again.unreadable, true, 'the unreadable read is kept, so the chip can say why');
});

test('the job that could not be read is offered again by the next Check, and its chip says why in words', live, () => {
  const {offered, reason} = screen.result;
  assert.deepEqual(offered, ['Close', 'Check 1 job'], 'only the unreadable job is left to offer (the two reads that worked are not)');
  assert.equal(reason, 'took too long', 'the reason for a timeout, in words, never the raw id');
});

test('after the reads the dialog matches the questions once, says so, has no Stop, and the form that lacks a detail says which', live, () => {
  const {matching, asked, split, splitChip} = screen.result;
  assert.deepEqual(matching, ['Close'], 'while matching there is no Stop: the call cannot be stopped');
  assert.deepEqual(asked, [[{url: 'https://jobs.triage-running.example/roles/1', questions: ['Start date']}]], 'one match, for the simple form\'s questions');
  assert.equal(split, 'needs your details: Notice period');
  assert.match(splitChip, /Alder Works.*Simple form/);
});
