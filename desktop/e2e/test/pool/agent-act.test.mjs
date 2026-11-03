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
