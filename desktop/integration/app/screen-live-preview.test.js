/* global document */
// The live preview opens only on request (owner, 5 Nov 2026: the preview "should not show by default, only on request"; spec 2026-11-05-applying-redesign, decision 4), layer 2:
// the app's demo window with fictional hidden-browser sessions. Drawing a filling or a handed-over card asks main for no picture (no "live view asked" in the app log);
// Watch live asks once; a page that is gone says why and offers no Try again (here the demo app's own answer, "no hidden browser"; the real closed answer is
// test/unit/ready-fill/live-view-handlers.test.js and its states test/unit/renderer/live-view-state.test.js). The picture itself: the apply suite's Background step presses Watch live.
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const NOW = new Date().toISOString();
const session = (id, company, background) => ({id, kind: 'form', url: `https://jobs.e2e.test/apply/${id}`, title: 'Platform Engineer', company, location: '', workMode: '', stage: '', stuck: '',
  inChrome: true, claudeId: '', asked: false, transcript: '', events: [], outcome: '', status: 'running', note: 'Filling started', question: '', answered: false, startedAt: NOW, endedAt: null,
  exitCode: null, needsYouSince: NOW, background: {mode: 'fill', reason: '', readyAt: 0, dueAt: 0, manualOverride: false, ...background}});
let probe;

before(() => {
  if (needsElectron.skip) return;
  probe = probeWindow({settings: {apply: {mode: 'fill', chosenAt: NOW}}, timeout: 180000,
    files: {'sessions.json': [session('live-filling', 'E2E Filling Co', {state: 'filling'}), session('live-stopped', 'E2E Stopped Co', {state: 'needs_user_handoff', reason: 'stopped', manualOverride: true})]},
    script: async kit => {
      await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
      await kit.go('sessions');
      const open = async company => {
        const row = await kit.until(() => [...document.querySelectorAll('#ss-list .ss-row')].find(one => one.textContent.includes(company)), `the ${company} session`);
        row.click();
        return kit.until(() => document.querySelector('.live-view')?.dataset.stage && document.getElementById('ss-next-title')?.innerText.trim() ? document.querySelector('.live-view') : null, `the ${company} card`);
      };
      const read = view => ({stage: view.dataset.stage, watching: view.classList.contains('is-watching'), text: view.innerText.replace(/\s+/g, ' ').trim(),
        buttons: [...view.querySelectorAll('button')].filter(button => button.offsetParent).map(button => button.innerText.trim() || button.ariaLabel)});
      const stopped = read(await kit.until(async () => { const view = await open('E2E Stopped Co'); return view.dataset.stage === 'closed' ? view : null; }, 'the stopped card to say its page is closed'));
      const cards = [document.querySelector('.view[data-view="sessions"]')?.innerText || ''];
      const filling = read(await open('E2E Filling Co'));
      cards.push(document.querySelector('.view[data-view="sessions"]')?.innerText || '');
      [...document.querySelectorAll('.live-view button')].find(button => button.innerText.trim() === 'Watch live').click();
      const pressed = read(await kit.until(() => { const view = document.querySelector('.live-view'); return /no hidden browser/.test(view?.innerText || '') ? view : null; }, 'the answer to Watch live'));
      return {stopped, filling, pressed, read: cards.map(text => /The page is (closed|hidden)/.test(text)), tryAgain: [...cards, pressed.text].some(text => /try again/i.test(text))};
    }});
});

test('a hidden application\'s card streams nothing until Watch live, and Watch live asks once', live, () => {
  const {filling, pressed} = probe.result;
  assert.deepEqual([filling.stage, filling.watching], ['off', false]);
  assert.match(filling.text, /The page is hidden.*only when you ask/);
  assert.ok(filling.buttons.includes('Watch live'), JSON.stringify(filling.buttons));
  assert.ok(!filling.buttons.includes('Hide the live page'), 'the Live strip shows only while watching');
  const asked = probe.log.filter(line => line.includes('live view asked'));
  assert.equal(asked.length, 1, `exactly the one press asked for a picture, drawing two cards asked none: ${asked.join(' | ')}`);
  assert.match(asked[0], /live-filling/);
  assert.equal(pressed.stage, 'off', 'the demo app\'s refusal leaves the note with Watch live, not a broken picture');
});

test('a page that is gone says why, offers no Watch live and no Try again', live, () => {
  const {stopped, tryAgain, read} = probe.result;
  assert.deepEqual(read, [true, true], 'positive control: the Try again read sees each card\'s stage, not only its header');
  assert.equal(stopped.stage, 'closed');
  assert.match(stopped.text, /The page is closed/);
  assert.deepEqual(stopped.buttons.filter(text => /watch live|try again/i.test(text)), []);
  assert.equal(tryAgain, false, 'no card says Try again');
});
