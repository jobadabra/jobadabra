/* global document */
// Jobs, layer 2: after a strategy change the old scores stay, marked, with one call to re-score (a row of the Jobs bar since 5 Nov 2026: "let's move this into this card"), and a Find jobs press asks "Score first" (owner, 2 Nov 2026: "there should be the old scored"
// · "a very visible call to action" · "pressing 'Find jobs' should open a dialog saying: Score first"). The app's window on the engine's own read shape (`stale` on rows and `outdated` on the payload,
// src/desktop_strategy.py mark_outdated, played with a real engine in integration/store/stale-scores-stay.test.mjs); the demo's jobs.json carries it here. No Notion, no AI. In demo mode the engine's
// re-score is blocked (lib/demo.js), so what runs after the person's "Find jobs without re-scoring" is the demo search, which is what the press must reach.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const demoJobs = JSON.parse(fs.readFileSync(new URL('../../demo/jobs.json', import.meta.url), 'utf8'));
const staleJobs = {...demoJobs, jobs: demoJobs.jobs.map(job => (job.fit != null && job.fit >= 70 ? {...job, stale: true} : {...job, stale: false})), outdated: {count: 2, method: 2, places: 0}};
const freshJobs = {...demoJobs, jobs: demoJobs.jobs.map(job => ({...job, stale: false})), outdated: {count: 0, method: 0, places: 0}};
let stale, fresh;

// In the window (serialised: no closure over this file).
const rescoreKit = base => {
  const dialog = () => document.getElementById('score-first-dialog');
  const call = () => document.getElementById('jobs-unscored');
  const press = label => [...dialog().querySelectorAll('button')].find(button => button.textContent.trim().startsWith(label)).click();
  return {
    openJobs: async () => { await base.until(() => document.querySelector('.nav[data-view=jobs]:not([hidden])'), 'the menu'); await base.go('jobs'); await base.until(() => !/Loading/.test(document.getElementById('jobs-stats').textContent), 'the jobs list'); },
    call: () => ({shown: !call().hidden, text: call().innerText}),
    // The old-scores row of the Jobs bar: its sentence, its button, the folded line and the bullets (renderer/rescore-entry.js).
    row: async () => base.until(() => {
      const li = document.querySelector('#jobs-suggestions-list [data-suggestion="rescore"]');
      return li && {text: li.textContent.trim(), button: li.querySelector('button')?.textContent.trim(), line: document.getElementById('jobs-suggestions-title').textContent,
        bullets: [...document.querySelectorAll('#jobs-suggestions-bullets .severity-bullet')].map(chip => chip.getAttribute('aria-label')), toggle: document.getElementById('jobs-suggestions-count').textContent};
    }, 'the old-scores row in the Jobs bar'),
    rowGone: () => !document.querySelector('#jobs-suggestions-list [data-suggestion="rescore"]'),
    rows: () => [...document.querySelectorAll('#jobs-body .job-row .fit-cell')].map(cell => ({stale: cell.classList.contains('is-stale'), ring: cell.querySelector('.fit-ring')?.textContent.trim(), badge: !!cell.querySelector('.fit-ring.is-old .fit-old-badge'), label: cell.querySelector('.fit-label')?.textContent.trim() || '', tip: cell.title})),
    pressFind: () => document.getElementById('refresh').click(),
    dialogOpen: async () => base.until(() => dialog().open && {title: document.getElementById('score-first-title').textContent, lead: document.getElementById('score-first-lead').textContent,
      buttons: [...dialog().querySelectorAll('button')].map(button => button.textContent.trim())}, 'the Score first dialog'),
    choose: label => press(label),
    dialogClosed: async () => base.until(() => !dialog().open, 'the dialog to close'),
    searchState: () => document.body.dataset.findCard,
    searchStarted: async () => base.until(() => ['searching', 'done'].includes(document.body.dataset.findCard) && document.body.dataset.findCard, 'a search to start'),
  };
};

before(() => {
  if (needsElectron.skip) return;
  stale = probeWindow({files: {'jobs.json': staleJobs}, use: [rescoreKit], timeout: 240000, script: async kit => {
    await kit.openJobs();
    const out = {call: kit.call(), row: await kit.row(), rows: kit.rows(), severe: kit.severe('jobs')};
    const before = kit.searchState();
    kit.pressFind();
    out.dialog = await kit.dialogOpen();
    out.startedWithDialogOpen = kit.searchState() !== before;
    kit.choose('Cancel');
    await kit.dialogClosed();
    out.afterCancel = kit.searchState() === before;
    kit.pressFind();
    await kit.dialogOpen();
    kit.choose('Find jobs without re-scoring');
    await kit.dialogClosed();
    out.afterSkip = await kit.searchStarted();
    return out;
  }}).result;
  fresh = probeWindow({files: {'jobs.json': freshJobs}, use: [rescoreKit], timeout: 240000, script: async kit => {
    await kit.openJobs();
    const out = {call: kit.call()};
    kit.pressFind();
    out.afterPress = await kit.searchStarted();
    out.dialogShown = document.getElementById('score-first-dialog').open;
    out.rowGone = kit.rowGone();
    return out;
  }}).result;
});

test('after a strategy change every fit stays on its row as a dashed ring with a refresh badge and no word; the others look as before', live, () => {
  const marked = stale.rows.filter(row => row.stale);
  assert.ok(marked.length > 0, 'no row is marked as scored with the previous strategy');
  for (const row of marked) { assert.match(row.ring, /^\d+$/, 'the old fit number is still shown'); assert.equal(row.badge, true, 'the refresh badge marks it old'); assert.equal(row.label, '', 'no word under the ring'); assert.match(row.tip, /Re-score/, 'the tooltip says what to do'); }
  assert.ok(stale.rows.some(row => !row.stale && !row.badge && /^\d+$/.test(row.ring)), 'a current score was marked too');
  assert.deepEqual(stale.severe, [], 'the call or the marks break the Jobs layout');
});

test('Jobs carries one call, a row of the Jobs bar: the Strategy notice\'s sentence, the same count, a Re-score button, a yellow bullet; the yellow bar above the list is gone', live, () => {
  assert.match(stale.row.text, /^2 jobs were scored using previous search settings\./);
  assert.equal(stale.row.button, 'Re-score 2');
  assert.match(stale.row.line, /2 old scores/, 'the folded line names it');
  assert.ok(stale.row.bullets.some(label => /warning/.test(label)), 'the yellow bullet counts it');
  assert.equal(stale.row.toggle, 'Show');
  assert.doesNotMatch(stale.call.text, /previous search settings/, 'no second notice above the list');
});

test('Find jobs with scores from the previous strategy asks "Score first" and starts nothing; Cancel starts nothing; "without re-scoring" finds', live, () => {
  assert.equal(stale.dialog.title, 'Score first');
  assert.match(stale.dialog.lead, /2 jobs were scored using previous search settings/);
  assert.deepEqual(stale.dialog.buttons, ['Cancel', 'Find jobs without re-scoring', 'Re-score 2']);
  assert.equal(stale.startedWithDialogOpen, false, 'the search started before the person chose');
  assert.equal(stale.afterCancel, true, 'Cancel started a search');
  assert.ok(['searching', 'done'].includes(stale.afterSkip));
});

test('nothing outdated: no call, and Find jobs finds at once with no dialog (the first run is never held)', live, () => {
  assert.equal(fresh.rowGone, true, 'no old-scores row when nothing is outdated');
  assert.ok(['searching', 'done'].includes(fresh.afterPress));
  assert.equal(fresh.dialogShown, false);
});
