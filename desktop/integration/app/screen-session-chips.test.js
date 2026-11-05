/* global document, getComputedStyle */
// The Sessions list's two chips in the app's demo window (owner, 5 Nov 2026, on a screenshot: "2 yellow chips. Looks bad", "text should start from the same vertical line"):
// in every state the mode is an outline, so the status is the only filled chip; each chip is one line; both chips' words start on one vertical line.
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const NOW = new Date().toISOString();
const session = (id, company, background) => ({id, kind: 'form', url: `https://jobs.e2e.test/apply/${id}`, title: 'Platform Engineer', company, location: '', workMode: '', stage: '', stuck: '',
  inChrome: true, claudeId: '', asked: false, transcript: '', events: [], outcome: '', status: 'running', note: 'Filling started', question: '', answered: false, startedAt: NOW, endedAt: null,
  exitCode: null, needsYouSince: NOW, ...(background ? {background: {reason: '', readyAt: 0, dueAt: 0, manualOverride: false, ...background}} : {})});
const STATES = [['chip-handed', 'Handed Co', {mode: 'auto', state: 'needs_user_handoff', reason: 'stopped'}], ['chip-auto', 'Auto Co', {mode: 'auto', state: 'filling'}],
  ['chip-needs', 'Needs Co', {mode: 'fill', state: 'needs_user_handoff', reason: 'stopped'}], ['chip-fill', 'Fill Co', {mode: 'fill', state: 'filling'}], ['chip-queued', 'Queued Co', {mode: 'fill', state: 'queued'}],
  ['chip-chrome', 'Chrome Co', null]];
let probe;

before(() => {
  if (needsElectron.skip) return;
  probe = probeWindow({settings: {apply: {mode: 'fill', chosenAt: NOW}}, timeout: 180000, files: {'sessions.json': STATES.map(state => session(...state))},
    script: async kit => {
      await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
      await kit.go('sessions');
      const rows = await kit.until(() => { const all = [...document.querySelectorAll('#ss-list .ss-row')]; return all.length === 6 && all.every(row => row.querySelectorAll('.ui-pill').length === 2) ? all : null; }, 'the six sessions');
      const words = chip => { const range = document.createRange(); range.selectNodeContents([...chip.childNodes].find(node => node.nodeType === 3)); return range.getBoundingClientRect(); };
      const read = chip => ({text: chip.textContent, left: words(chip).left, height: words(chip).height, filled: getComputedStyle(chip).backgroundColor !== 'rgba(0, 0, 0, 0)'});
      return rows.map(row => { const [mode, status] = [...row.querySelectorAll('.ui-pill')]; return {mode: read(mode), status: read(status), line: parseFloat(getComputedStyle(mode).lineHeight)}; });
    }});
});

test('every session\'s status is the only filled chip: a row never stacks two filled chips', live, () => {
  assert.equal(probe.result.length, STATES.length);
  for (const {mode, status} of probe.result) assert.deepEqual([mode.filled, status.filled], [false, true], `${mode.text} / ${status.text}`);
  const pairs = probe.result.map(({mode, status}) => `${mode.text} / ${status.text}`);
  assert.ok(pairs.includes('Full auto · you submit / Needs you'), `the owner's handed-over row: ${pairs.join(' | ')}`);
  assert.ok(pairs.some(pair => pair.startsWith('In Chrome · you submit / ')), `a session with no hidden browser: ${pairs.join(' | ')}`);
});

test('both chips\' words start on one vertical line, and each chip is one line', live, () => {
  for (const {mode, status, line} of probe.result) {
    assert.ok(Math.abs(mode.left - status.left) < 1, `${mode.text} at ${mode.left}, ${status.text} at ${status.left}`);
    assert.ok(mode.height < line * 1.5, `${mode.text} wrapped: ${mode.height}px of text on ${line}px lines`);
  }
});
