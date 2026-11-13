/* global document */
// Jobs, layer 2: the tester's Inbound list (owner, 2 Nov 2026: "why the jobs list are showing in such a broken state?", then on the first fix: "there should not be much
// difference between inbound jobs and normal jobs", "the same structure, the same height as normal jobs cards", "for the content we're missing, we should add N/A").
// The store held two opportunities the Gmail check recorded (a recruiter's reply, titled by who wrote; a rejection) and one new match. Under Inbound each row must be built
// exactly like the match's row (the same parts in the same order, the same height, the buttons in the same place), a part with nothing to say says N/A, and nothing says
// "Not checked" or "Not scored" about a job that is not waiting for you; no "Find more jobs" card over a list a search cannot add to; the rejection says what it is about.
// Wide (1280) and narrow (780, the stacked card). The pure half (every filter x every kind of row): test/unit/renderer/job-row-model.test.js. The app's window on fictional rows, no Notion, no AI.
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const row = {location: '', work_mode: '', posted_at: '2099-01-01', first_seen_at: '2099-01-01', reason: '', skills: [], notion_url: ''};
const JOBS = [
  {...row, id: 1, code: 'r1', title: 'Reply from Fincruit', company: '', via: 'Fincruit', origin: 'Inbound', stage: 'Applied', status: 'applied', fit: null, url: 'https://mail.example/inbound/1', rank: 1},
  {...row, id: 2, code: 'r2', title: 'Audit Manager', company: 'PwC', location: 'Luxembourg', origin: 'Inbound', stage: 'Rejected', status: 'applied', fit: null,
    rejection: 'Unclear', url: 'https://mail.example/inbound/2', rank: 2},
  {...row, id: 3, code: 'r3', title: 'Site Reliability Engineer', company: 'Acme', location: 'Zurich', work_mode: 'Hybrid', origin: 'Outbound', stage: null, status: 'unreviewed', fit: 82,
    skills: ['Kubernetes', 'Go'], url: 'https://jobs.inbound-list.example/3', rank: 3},
];
const screens = {};

// In the window (serialised: no closure over this file): what each row draws, as a person sees it and as the layout measures it.
const probe = width => probeWindow({env: {JOBADABRA_SHOT_WIDTH: String(width)}, files: {'jobs.json': {jobs: JOBS, total: JOBS.length, filtered: JOBS.length}}, timeout: 180000, script: async kit => {
  await kit.until(() => document.querySelector('.nav[data-view=jobs]:not([hidden])'), 'the menu');
  await kit.go('jobs');
  const rows = () => [...document.querySelectorAll('article.job-row')];
  const parts = node => [...node.children].map(child => child.className.split(' ')[0]).join(',');   // the first class of each child: the structure, not the state
  const read = () => ({
    findCardShown: !document.getElementById('find-card').hidden,
    rows: rows().map(item => {
      const box = item.getBoundingClientRect(), actions = item.querySelector('.row-actions .ui-more')?.getBoundingClientRect();
      return {title: item.querySelector('.title-line a')?.textContent.trim(), text: item.innerText, structure: `${parts(item)} | ${parts(item.querySelector('.role'))}`,
        height: Math.round(box.height), actionsTop: actions ? Math.round(actions.top - box.top) : -1, actionsLeft: actions ? Math.round(actions.left - box.left) : -1,
        actionsGap: actions ? Math.round(box.right - actions.right) : -1,
        ring: item.querySelector('.fit-ring')?.textContent.trim(), roleChips: [...item.querySelectorAll('.role > .chip-tag')].map(chip => chip.textContent.trim()),
        meta: `${item.querySelector('.company')?.innerText} ${item.querySelector('.place')?.innerText}`.replace(/\s+/g, ' ').trim(), blankLogos: item.querySelectorAll('.logo.is-blank').length, logos: [...item.querySelectorAll('.logo')].map(logo => logo.textContent.trim()),
        tags: [...item.querySelectorAll('.tags .ui-tag')].map(tag => tag.textContent.trim())};
    }),
  });
  await kit.until(() => rows().length >= 1, 'the job rows');
  // The Inbound card is gone (df 2/2, owner 13 Nov 2026: four cards): the list is the Show menu's Inbound, ticked alone like a person would.
  document.getElementById('filter-status').click();
  await kit.until(() => document.querySelector('.ui-multi [data-id=inbound]'), 'the Show menu');
  const ticked = [...document.querySelectorAll('.ui-multi [aria-checked="true"]')].map(node => node.dataset.id);
  document.querySelector('.ui-multi [data-id=inbound]').click();
  for (const other of ticked) document.querySelector(`.ui-multi [data-id="${other}"]`).click();
  await kit.until(() => rows().length === 2, 'the two Inbound rows');
  const inbound = read();
  document.querySelector('[data-mode=board]').click();
  await kit.until(() => !document.getElementById('jobs-board').hidden, 'the board');
  const board = [...document.querySelectorAll('#jobs-board .board-card')].map(card => ({text: card.innerText.replace(/\s+/g, ' ').trim(), chips: card.querySelectorAll('.chip-tag').length}));
  document.querySelector('[data-mode=list]').click();
  await kit.until(() => document.getElementById('jobs-board').hidden, 'the list again');
  document.querySelector('[data-stat=total]').click();
  await kit.until(() => rows().length === 1 && rows()[0].dataset.url.includes('inbound-list'), 'the one new match');
  return {inbound, board, matches: read()};
}});

before(() => {
  if (needsElectron.skip) return;
  for (const width of [1280, 780]) screens[width] = probe(width);
});

for (const width of [1280, 780]) {
  test(`${width}px, Inbound: the reply and the rejection are built like a normal job card (same parts, same height, the buttons in the same place)`, live, () => {
    const {inbound, matches} = screens[width].result;
    const normal = matches.rows[0];
    assert.equal(inbound.rows.length, 2);
    for (const item of inbound.rows) {
      assert.equal(item.structure, normal.structure, `${item.title}: its parts differ from a job match's`);
      assert.ok(Math.abs(item.height - normal.height) <= 2, `${item.title}: ${item.height}px high, a job match is ${normal.height}px`);
      assert.ok(Math.abs(item.actionsTop - normal.actionsTop) <= 2 && Math.abs(item.actionsLeft - normal.actionsLeft) <= 2, `${item.title}: its ⋯ button sits at ${item.actionsLeft},${item.actionsTop}, a job match's at ${normal.actionsLeft},${normal.actionsTop}`);
    }
    // The card uses its whole width (owner, 2 Nov 2026: "Why we crowd all the buttons on the left of the card, and on the right is empty"): the ⋯ button ends at the card's right padding.
    for (const item of [...inbound.rows, normal]) assert.ok(item.actionsGap >= 0 && item.actionsGap <= 24, `${item.title}: its ⋯ button ends ${item.actionsGap}px from the card's right edge`);
  });
}

test('Inbound: what a job has nothing to say about says N/A, never "Not checked" or "Not scored"', live, () => {
  const {rows, findCardShown} = screens[1280].result.inbound;
  for (const item of rows) {
    assert.equal(item.ring, 'N/A', `${item.title}: its score ring`);
    assert.deepEqual(item.roleChips, ['N/A'], `${item.title}: its apply read`);
    assert.doesNotMatch(item.text, /Not checked|Not scored/, item.title);
  }
  const reply = rows.find(item => item.title.startsWith('Reply from'));
  assert.match(reply.meta, /Fincruit.*N\/A/, 'the sender\'s company, and N/A for the place');
  assert.equal(findCardShown, false, 'a "Find more jobs" card over a list a search cannot add to');
});

test('Inbound: a reply with no employer names the sender\'s company, no "!" logo and no subject for a title', live, () => {
  const reply = screens[1280].result.inbound.rows.find(item => item.title.startsWith('Reply from'));
  assert.equal(reply.title, 'Reply from Fincruit');
  assert.ok(!reply.logos.some(text => text === '!' || text === '?'), `logos: ${reply.logos}`);   // the old empty-company badge drew "?" (or "!" on Windows)
});

test('Inbound: "Unclear" says what it is about', live, () => {
  const rejected = screens[1280].result.inbound.rows.find(item => item.title === 'Audit Manager');
  assert.ok(rejected.tags.some(text => text.includes('Rejection reason unclear')), `tags: ${rejected.tags}`);
  assert.ok(!rejected.tags.some(text => /^🔎\s*Unclear$/.test(text)), 'the bare verdict');
});

test('Board: the two cards carry no apply chip', live, () => {
  const {board} = screens[1280].result;
  assert.equal(board.length >= 2, true, JSON.stringify(board));
  for (const card of board) assert.equal(card.chips, 0, card.text);
});

test('All matches: the new match keeps its apply chip and score, and the Find more jobs card is back', live, () => {
  const {rows, findCardShown} = screens[1280].result.matches;
  assert.deepEqual(rows[0].roleChips, ['Not checked']);
  assert.equal(rows[0].ring, '82');
  assert.equal(findCardShown, true);
});
