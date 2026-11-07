/* global document */
// Stop on a hidden-browser card is one node that survives every redraw of the card (owner Telegram red-main alert, 7 Nov 2026: E2E after merge run 42337402105, apply-1of3, both
// "Stop on the card" steps waited 30 s on "visible, enabled and stable"), layer 2: the app's demo window with a filling job and a Full automation job counting down.
// Root cause: renderLive built new buttons and replaceChildren'd #ss-actions on every redraw (a page-facts event, a refresh of the open session), also when the actions had not
// changed, so a press whose mousedown and mouseup straddle a redraw hits two nodes and does nothing, and Playwright's stability check never settles. Stop is the safety control.
// Guard: safety — a Stop press lost to a redraw leaves a hidden-browser job running that the person stopped.
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const NOW = new Date().toISOString();
const DUE = new Date(Date.now() + 3600_000).toISOString();
const session = (id, company, background) => ({id, kind: 'form', url: `https://jobs.e2e.test/apply/${id}`, title: 'Platform Engineer', company, location: '', workMode: '', stage: '', stuck: '',
  inChrome: true, claudeId: '', asked: false, transcript: '', events: [], outcome: '', status: 'running', note: 'Filling started', question: '', answered: false, startedAt: NOW, endedAt: null,
  exitCode: null, needsYouSince: NOW, background: {mode: 'fill', reason: '', readyAt: 0, dueAt: 0, manualOverride: false, ...background}});
// A form session of the person's own Chrome (no hidden browser): its card is drawn by renderNextStep, not renderLive, and keeps its buttons the same way.
const chromeSession = (id, company) => ({...session(id, company, {}), background: null, inChrome: true, status: 'running'});
let probe;

before(() => {
  if (needsElectron.skip) return;
  probe = probeWindow({settings: {apply: {mode: 'fill', chosenAt: NOW}}, timeout: 180000,
    files: {'sessions.json': [session('stop-filling', 'E2E Filling Co', {state: 'filling'}), session('stop-counting', 'E2E Counting Co', {mode: 'auto', state: 'waiting_to_submit', dueAt: Date.parse(DUE)}), chromeSession('stop-chrome', 'E2E Chrome Co')]},
    script: async kit => {
      await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
      await kit.go('sessions');
      const rowOf = company => [...document.querySelectorAll('#ss-list .ss-row')].find(one => one.textContent.includes(company));
      const stopOf = () => [...document.querySelectorAll('#ss-actions button')].find(button => button.innerText.trim() === 'Stop');
      const out = {};
      const firstOf = () => document.querySelector('#ss-actions button:not([disabled])');
      for (const company of ['E2E Filling Co', 'E2E Counting Co', 'E2E Chrome Co']) {
        const pick = company === 'E2E Chrome Co' ? firstOf : stopOf;   // the Chrome card has no Stop: its first pressable action is the same kind of node
        (await kit.until(() => rowOf(company), `the ${company} session`)).click();
        const first = await kit.until(pick, `the action on the ${company} card`);
        const row = [...document.querySelectorAll('#ss-actions button')].map(button => button.innerText.trim());
        // The app redraws an open session's card whenever its record or page facts change: the same row's session drawn again is that redraw, with the same actions.
        for (let again = 0; again < 3; again++) rowOf(company).click();
        const second = await kit.until(pick, `the action on the ${company} card after the redraws`);
        out[company] = {sameNode: first === second, attached: first.isConnected, row, after: [...document.querySelectorAll('#ss-actions button')].map(button => button.innerText.trim())};
      }
      return out;
    }});
});

test('Stop is the same button before and after the card is drawn again, in both hidden-browser modes; a Chrome session keeps its actions the same way', live, () => {
  for (const [company, seen] of Object.entries(probe.result)) {
    assert.ok(seen.row.length > 0 && (company === 'E2E Chrome Co' || seen.row.includes('Stop')), `positive control: ${company} shows its actions (${JSON.stringify(seen.row)})`);
    assert.deepEqual(seen.after, seen.row, `${company}: the actions did not change`);
  }
  const replaced = Object.entries(probe.result).filter(([, seen]) => !seen.sameNode || !seen.attached).map(([company]) => company);
  assert.deepEqual(replaced, [], 'cards whose action was replaced by a redraw with the same actions');
});
