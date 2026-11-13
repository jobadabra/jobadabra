/* global document */
// A chip on a Jobs board card never splits a word, layer 2: the app's demo window on fictional Saved jobs whose stored checks give long "Needs you · <why>" chips, on the Board view
// (a ~150 px column). Each chip's value must sit on one line, the detail under it when there is no room.
// Why (13 Nov 2026, owner: "Ship it (Recommended)"): with the value and the detail side by side and overflow-wrap: anywhere (renderer/chips.css), the board showed "Need / s you".
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {pack} from '../../lib/apply-readiness.js';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const POSTED = '2099-01-01';
const clean = {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: null};
const STORED = [{...clean, login: true, simple: false, why: 'login'}, {...clean, accountCreation: true, simple: false, why: 'account'}];
const JOBS = STORED.map((stored, index) => ({id: index + 1, code: `b${index + 1}`, title: `Board Chip Engineer ${index + 1}`, company: 'Board chip fixtures', stage: 'Saved',
  location: 'Zurich', work_mode: 'Hybrid', url: `https://jobs.board-chip.example/roles/${index + 1}`, posted_at: POSTED, first_seen_at: POSTED, status: 'saved', fit: 90 - index,
  reason: 'A fictional match.', rank: 100 - index, skills: ['Go'], apply_readiness: pack(stored, {posted: POSTED})}));
let seen;

before(() => {
  if (needsElectron.skip) return;
  // Serialised into the window with the script (window-probe.js `use`): no closure over this file.
  const boardOf = base => ({chips: async () => {
    await base.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await base.go('jobs');
    await base.until(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Board'), 'the Board switch');
    [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Board').click();
    await base.until(() => document.querySelectorAll('.board-card .chip-tag .chip-value').length >= 2, 'two board cards with a check chip');
    // Lines a text takes: distinct tops of its laid-out boxes (a word split over two lines gives two).
    const lines = node => { const range = document.createRange(); range.selectNodeContents(node); return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size; };
    return [...document.querySelectorAll('.board-card .chip-tag')].map(chip => ({text: chip.textContent.trim(), valueLines: lines(chip.querySelector('.chip-value')),
      cardWidth: Math.round(chip.closest('.board-card').getBoundingClientRect().width)}));
  }});
  seen = probeWindow({files: {'jobs.json': {jobs: JOBS, total: JOBS.length, filtered: JOBS.length}}, use: [boardOf], timeout: 180000, script: kit => kit.chips()}).result;
});

test('a board card\'s check chip keeps its value ("Needs you") on one line', live, () => {
  assert.ok(seen.length >= 2, `two check chips on the board: ${JSON.stringify(seen)}`);
  for (const chip of seen) assert.equal(chip.valueLines, 1, `"${chip.text}" in a ${chip.cardWidth} px card: its value takes ${chip.valueLines} lines`);
});
