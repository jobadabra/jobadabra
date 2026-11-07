// The explorer's safety word list reads a control's own name, never the app's pill inside it (replay 41807054784, 4 Nov 2026: "What we learned 2 to check" was [not allowed] because the pill says "check").
// Guard: safety — without it a control whose own name is unsafe ("Delete", "Send") could be pressed, or a pill's count could again refuse a safe tab.
import test from 'node:test';
import assert from 'node:assert/strict';
import {allowed, formatObservation} from '../../lib/explore.mjs';

const tab = {kind: 'button', label: 'What we learned 2 to check', safeLabel: 'What we learned', disabled: false, cls: '', href: '', type: ''};

test('a tab whose pill says "2 to check" may be pressed: the name is "What we learned"', () => {
  assert.equal(allowed(tab), true);
  const seen = formatObservation({view: 'profile', text: '', overlays: [], controls: [{i: 0, ...tab}]});
  assert.ok(seen.endsWith('0 · button · What we learned 2 to check'), seen);   // the agent still sees the pill, and no [not allowed]
});

test('a control whose own name is unsafe is still refused, pill or not', () => {
  assert.equal(allowed({...tab, label: 'Delete CV 1 to check', safeLabel: 'Delete CV'}), false);
  assert.equal(allowed({...tab, label: 'Send', safeLabel: 'Send'}), false);
});

test('a record without a safeLabel keeps judging its label, as before', () => {
  const {safeLabel, ...old} = tab;
  assert.equal(allowed(old), false);
  assert.equal(safeLabel, 'What we learned');
});

// Why (7 Nov 2026, pz): lib/interact.mjs's unsafe words are English, so on a page in German "Löschen" and "Bewerben" would pass it; a page not in English offers only what presses nothing.
test('a page not in English refuses its buttons and links, but not its dropdowns, fields, tabs or Settings sections', () => {
  const foreign = {...tab, label: 'Löschen', safeLabel: 'Löschen', foreign: true};
  assert.equal(allowed(foreign), false);
  assert.equal(allowed({...foreign, kind: 'link', href: '#x'}), false);
  assert.equal(allowed({...tab, label: 'Sprache', safeLabel: 'Sprache', kind: 'select'}), true);
  assert.equal(allowed({...tab, label: 'Suche', safeLabel: 'Suche', kind: 'field'}), true);
  assert.equal(allowed({...tab, label: 'Profil', safeLabel: 'Profil'}), true);   // a tab or a Settings section carries no `foreign`
});

test('a dropdown is judged on its own name and shows its options; an "Apply mode" dropdown stays refused', () => {
  const language = {...tab, kind: 'select', label: 'Language', safeLabel: 'Language', options: ['🌐 System', '🇩🇪 Deutsch']};
  assert.equal(allowed(language), true);
  assert.equal(allowed({...language, label: 'Apply mode', safeLabel: 'Apply mode'}), false);
  assert.ok(formatObservation({view: 'settings', text: '', overlays: [], controls: [{i: 0, ...language}]}).endsWith('0 · select · Language [options: 🌐 System | 🇩🇪 Deutsch]'));
});
