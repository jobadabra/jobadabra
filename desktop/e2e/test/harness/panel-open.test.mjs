// The panel is opened by state, not by one press: lib/panel-open.mjs. Plays the order that made apply-3of3 red (main bef02c2, run 41568088547).
import assert from 'node:assert/strict';
import test from 'node:test';
import {PANEL_OPEN, openPanel} from '../../lib/panel-open.mjs';

/** A fake form tab: the panel's card and its pill, which TOGGLES the card (extension/review.js). `opensByItself`: right after a reader sees the card closed, the extension opens it (a worker push). */
function fakeTab({opensByItself = false, pillWorks = true} = {}) {
  const panel = {hidden: true, presses: 0, byItself: opensByItself};
  const card = {get hidden() { const seen = panel.hidden; if (seen && panel.byItself) { panel.byItself = false; panel.hidden = false; } return seen; }};
  const pill = {click() { if (pillWorks) { panel.presses += 1; panel.hidden = !panel.hidden; } }};
  const root = {querySelector: selector => (selector === '.card' ? card : selector === '.pill' ? pill : null)};
  const polls = {count: 0};
  const tab = {evaluate: async fn => { const had = globalThis.document; globalThis.document = {getElementById: id => (id === 'jobadabra-review-host' ? {hidden: false, shadowRoot: root} : null)}; try { return fn(); } finally { globalThis.document = had; } },
    waitForFunction: async (fn, arg, {timeout}) => {
    const had = globalThis.document;
    globalThis.document = {getElementById: id => (id === 'jobadabra-review-host' ? {shadowRoot: root} : null)};
    try {
      for (polls.count = 1; polls.count <= 20; polls.count++) if (fn(arg)) return;
    } finally { globalThis.document = had; }
    const error = new Error(`Timeout ${timeout}ms exceeded.`); error.name = 'TimeoutError'; throw error;
  }};
  return {tab, panel, polls};
}

test('a panel the extension opens right after it was seen closed is left open, not toggled shut by the press', async () => {
  const {tab, panel} = fakeTab({opensByItself: true});
  await openPanel(tab);
  assert.equal(panel.hidden, false, 'the panel ended closed: the press closed what the extension had just opened');
  assert.equal(panel.presses, 2, 'the first press shut it (it was already open), the second, after the next read, opened it');
});

test('a closed panel is opened by one press, an open one is not pressed', async () => {
  const closed = fakeTab();
  await openPanel(closed.tab);
  assert.deepEqual([closed.panel.hidden, closed.panel.presses], [false, 1]);
  const open = fakeTab();
  open.panel.hidden = false;
  await openPanel(open.tab);
  assert.equal(open.panel.presses, 0);
});

test('a pill that never opens the panel fails with the step wait, not a pass', async () => {
  const {tab} = fakeTab({pillWorks: false});
  await assert.rejects(openPanel(tab), /Timeout.*last seen: the panel stayed minimised to its pill/);
});

test('a page with no panel yet is read again, never pressed', () => {
  const had = globalThis.document;
  globalThis.document = {getElementById: () => null};
  try { assert.equal(PANEL_OPEN(), false); } finally { globalThis.document = had; }
});
