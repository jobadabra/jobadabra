// The AI user agent's `go` reaches Profile: the menu draws it as a button of the settings view, so the Finder's view list never could (first replay, 3 Nov 2026: 21 calls, 0 goals reached, because the goal was on Profile).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AGENT_VIEWS, agentAct} from '../../lib/agent-act.mjs';
import {VIEWS} from '../../lib/uicheck.mjs';

const fakePage = () => {
  const log = [];
  return {log, locator: selector => ({first: () => ({isVisible: async () => true}), selector}), click: async selector => log.push(['click', selector]),
    evaluate: async () => null, waitForFunction: async () => true, waitForTimeout: async () => {}};
};

test('go can open Profile: the list offers it and the press lands on the menu\'s Profile button, not on Settings', async () => {
  assert.ok(AGENT_VIEWS.includes('profile'), 'the model is offered the page');
  assert.ok(VIEWS.every(view => AGENT_VIEWS.includes(view)), 'every page the Finder knows is still offered');
  const page = fakePage();
  await agentAct(page).go('profile');
  assert.deepEqual(page.log, [['click', '.nav[data-settings="profile"]']]);
});

test('go on another page still presses that page\'s own menu button (Settings never opens Profile)', async () => {
  const page = fakePage();
  await agentAct(page).go('settings');
  assert.deepEqual(page.log, [['click', '.nav[data-view="settings"]:not([data-settings="profile"])']]);
});

// Why (4 Nov 2026, Gitar on 9/12 part 2b): a note boxes the control the agent last pressed in the Admin tab's screenshot, so typing or a key press must not leave an earlier click's box behind.
test('lastPress is the box of the last click and is cleared by type, press and go', async () => {
  const page = {...fakePage(), keyboard: {press: async () => {}}};
  page.locator = () => ({first: () => ({isVisible: async () => true}), scrollIntoViewIfNeeded: async () => {}, boundingBox: async () => ({x: 10.4, y: 20.6, width: 30, height: 40}), click: async () => {}, fill: async () => {}});
  page.evaluate = async () => ({w: 1440, h: 900});
  const act = agentAct(page);
  assert.equal(act.lastPress(), null);
  await act.click(3);
  assert.deepEqual(act.lastPress(), {x: 10, y: 21, w: 30, h: 40, window: {w: 1440, h: 900}});
  await act.type(4, 'hello');
  assert.equal(act.lastPress(), null);
  await act.click(3); await act.press('Enter');
  assert.equal(act.lastPress(), null);
  await act.click(3); await act.go('settings');
  assert.equal(act.lastPress(), null);
});
