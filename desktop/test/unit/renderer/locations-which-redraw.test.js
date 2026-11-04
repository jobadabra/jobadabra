// "Which locations are right?": a pick, and an Undo of what a pick set aside, change the Locations section above the card, so the page is told at once
// (`locations-changed`; Strategy reloads on it). Why (4 Nov 2026, a tester on 0.9.2: "after choosing Use Profile's, the Locations section still shows the old list
// until reopened"): the card reloaded only itself, and the section above it is drawn by the Strategy page's own load. The scenario below is that one, with
// fictional places: Strategy says Zurich, the Profile says Basel, the person presses "Use Profile's".
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';

install();
const doc = globalThis.document;
const settle = () => new Promise(resolve => setImmediate(resolve));
// A browser's click: the listener gets an event whose currentTarget is the button (tiny-dom's click() passes none).
const press = button => button.listeners.click[0]({type: 'click', currentTarget: button});
globalThis.window.pilot = {state: async () => ({}), onOpenFeedback() {}};   // what the page modules read when they load
const {loadLocationsWhich} = await import('../../../renderer/pages/locations-which.js');

const conflict = {kind: 'preferred', strategy: ['Zurich'], profile: ['Basel'], onlyStrategy: ['Zurich'], onlyProfile: ['Basel'], profileMode: ''};

let current = {changed: 0};
doc.addEventListener('locations-changed', () => { current.changed += 1; });   // one listener, counting into the running test's calls

function screen({setAside = []} = {}) {
  doc.body.replaceChildren();
  for (const id of ['strategy-locations-which', 'locations-set-aside', 'locations-which-list', 'locations-which-message']) doc.body.append(Object.assign(doc.createElement('div'), {id}));
  const calls = current = {resolved: [], undone: [], changed: 0};
  globalThis.window.pilot = {
    locationsWhich: async () => ({ok: true, conflicts: [conflict], setAside}),
    resolveLocationConflict: async (...args) => { calls.resolved.push(args); return {ok: true}; },
    undoSetAside: async id => { calls.undone.push(id); return {ok: true}; },
  };
  return calls;
}

test('pressing "Use Profile\'s" tells the page that Locations changed (it redraws the section above the card)', async () => {
  const calls = screen();
  await loadLocationsWhich();
  const use = [...doc.querySelectorAll('.which-use')].find(node => /Profile/.test(node.textContent));
  assert.ok(use, 'the Use Profile\'s button is drawn (positive control)');
  assert.equal(calls.changed, 0, 'nothing is said before the press');
  press(use);
  await settle();
  assert.deepEqual(calls.resolved, [['preferred', 'profile', []]], 'the pick reached the handler');
  assert.equal(calls.changed, 1, 'Locations is redrawn once, from the pick');
});

test('a refused pick says why and does not redraw', async () => {
  const calls = screen();
  globalThis.window.pilot.resolveLocationConflict = async () => ({ok: false, error: 'Could not save.'});
  await loadLocationsWhich();
  press([...doc.querySelectorAll('.which-use')][0]);
  await settle();
  assert.equal(calls.changed, 0);
  assert.match(doc.getElementById('locations-which-message').textContent, /Could not save/);
});

test('Undo of a set-aside value also tells the page (the same section changes back)', async () => {
  const calls = screen({setAside: [{id: 'a1', title: 'Preferred locations', value: 'Basel'}]});
  await loadLocationsWhich();
  const undo = [...doc.querySelectorAll('button')].find(node => /Undo/.test(node.textContent));
  assert.ok(undo, 'the Undo button is drawn (positive control)');
  press(undo);
  await settle();
  assert.deepEqual(calls.undone, ['a1']);
  assert.equal(calls.changed, 1);
});
