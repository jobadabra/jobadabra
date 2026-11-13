// LinkedIn Easy Apply's switch in the window, plan 1/5: the owner's warning word for word, which step a press takes, the Connections row and the ⌘K command.
// Pure parts: renderer/easy-apply-words.js; the doors (Settings row, ⌘K) are checked by what each source file imports.
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EASY_APPLY, commandOf, nextStep, rowOf} from '../../../renderer/easy-apply-words.js';

const view = extra => ({loaded: true, on: false, linkedinOn: true, warned: false, offered: true, ...extra});

test('the warning is the owner\'s D4 text, word for word, with "Turn on" / "Not now"', () => {
  assert.equal(EASY_APPLY.warn.line, "Easy Apply sends applications from your own LinkedIn account. LinkedIn's terms do not allow automated applying, and LinkedIn may limit or restrict your account. "
    + "Jobadabra sends at most 15 a day and stops at LinkedIn's first warning. Off by default. Turn on?");
  assert.equal(EASY_APPLY.warn.yes, 'Turn on');
  assert.equal(EASY_APPLY.warn.no, 'Not now');
  assert.match(EASY_APPLY.warn.lead, /Standard and Background wait for your Submit/);
});

test('a press: manage while on, LinkedIn jobs first without its sign-in, the warning once, then straight on', () => {
  assert.equal(nextStep(view({on: true})), 'manage');
  assert.equal(nextStep(view({linkedinOn: false})), 'linkedin-first');
  assert.equal(nextStep(view({linkedinOn: false, warned: true})), 'linkedin-first', 'the sign-in comes before anything else');
  assert.equal(nextStep(view()), 'warn');
  assert.equal(nextStep(view({warned: true})), 'turn-on');
});

test('the Connections row: only where offered, and it says why it is off', () => {
  assert.equal(rowOf(view({offered: false})).shown, false, 'packaged build: no row until sending lands');
  assert.equal(rowOf({loaded: false}).shown, false, 'not read yet: no row');
  assert.deepEqual(rowOf(view()), {shown: true, on: false, words: 'Off'});
  assert.deepEqual(rowOf(view({linkedinOn: false})), {shown: true, on: false, words: 'Needs LinkedIn jobs on'});
  assert.equal(rowOf(view({on: true})).on, true);
});

test('⌘K: "Turn on" while off, "Turn off" while on, none where not offered', () => {
  const run = () => {};
  assert.equal(commandOf(view({offered: false}), run), null);
  assert.equal(commandOf(view(), run).label, 'Turn on LinkedIn Easy Apply');
  assert.equal(commandOf(view({on: true}), run).label, 'Turn off LinkedIn Easy Apply');
  assert.equal(commandOf(view(), run).run, run);
});

test('both doors open the same flow: the Connections row and ⌘K', () => {
  assert.match(readScreenSource(new URL('../../../renderer/pages/settings.js', import.meta.url), 'utf8'), /openEasyApply/);
  assert.match(readScreenSource(new URL('../../../renderer/pages/nav.js', import.meta.url), 'utf8'), /addEasyApplyCommand\(add\)/);
});
