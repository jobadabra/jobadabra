/* global document */
// The chips on a Jobs board card read cleanly, layer 2: the app's demo window on fictional Saved jobs with a stored sign-in or account check, on the Board view (a ~150 px column).
// Each card shows "Needs you" and "Account needed", each on one line, with no reason text (it is in the tooltip, the list and the job's page), 8 px under the line above and 4 px apart.
// Why (13 Nov 2026, owner: "Still bad UI. Lack of spacing/margin/padding", picked "B: short chip"): the board split "Need / s you", then a wrapped blob 2 px from its neighbours.
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
    // Lines a chip's text takes: distinct tops of its text boxes only (a word split over two lines gives two; an inner element's own box is not a line).
    const lines = node => {
      const walker = document.createTreeWalker(node, 4), tops = new Set();   // 4: NodeFilter.SHOW_TEXT
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        const range = document.createRange(); range.selectNodeContents(text);
        for (const rect of range.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top));
      }
      return tops.size;
    };
    return [...document.querySelectorAll('.board-card')].map(card => {
      const row = card.querySelector('.chip-row'), chips = [...(row?.children || [])], above = row?.previousElementSibling;
      const box = node => node.getBoundingClientRect();
      return {chips: chips.map(chip => ({text: chip.textContent.trim(), lines: lines(chip)})), detail: !!row?.querySelector('.chip-detail'),
        above: row && above ? Math.round(box(row).top - box(above).bottom) : null, between: chips.length > 1 ? Math.round(box(chips[1]).top - box(chips[0]).bottom) : null};
    });
  }});
  seen = probeWindow({files: {'jobs.json': {jobs: JOBS, total: JOBS.length, filtered: JOBS.length}}, use: [boardOf], timeout: 180000, script: kit => kit.chips()}).result;
});

test('each board card shows "Needs you" and "Account needed", one line each, spaced from the text and from each other', live, () => {
  assert.equal(seen.length, 2, `two board cards: ${JSON.stringify(seen)}`);
  for (const card of seen) {
    assert.deepEqual(card.chips.map(chip => chip.text), ['Needs you', 'Account needed'], JSON.stringify(card));
    for (const chip of card.chips) assert.equal(chip.lines, 1, `"${chip.text}" takes ${chip.lines} lines`);
    assert.equal(card.detail, false, 'no reason text on the narrow card');
    assert.ok(card.above >= 8, `the chips sit ${card.above} px under the line above (at least 8)`);
    assert.ok(card.between >= 4, `the two chips are ${card.between} px apart (at least 4)`);
  }
});
