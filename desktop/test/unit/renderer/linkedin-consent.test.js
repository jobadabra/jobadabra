// LinkedIn jobs, PR 1/3: the four doors (Settings row, ask on Find jobs, Suggestions entry, ⌘K) open ONE consent, and the words the owner approved on 31 Oct 2026 are in it.
// Pure parts: renderer/linkedin-words.js; the doors are checked by what each source file imports (one loop).
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CONSENT, KEY, LINE, askOnPress, linkedinEntries, renewCommandOf, signinLine} from '../../../renderer/linkedin-words.js';
import {LOOK} from '../../../renderer/suggestions.js';

const off = {loaded: true, on: false, asked: 0, declined: 0, ask: true, hasSession: false};

test('the Suggestions entry: one row while off, with the one-click action and Not now, gone when on, answered or not read yet', () => {
  const [entry, ...rest] = linkedinEntries({view: off});
  assert.equal(rest.length, 0);
  assert.equal(entry.kind, 'linkedin');
  assert.equal(entry.key, KEY);
  assert.deepEqual(entry.actions, [{label: 'Sign in to LinkedIn', do: 'turn_on_linkedin'}]);
  assert.deepEqual(entry.answers, ['Not now']);
  assert.equal(entry.home, 'focus');
  assert.deepEqual(linkedinEntries({view: {...off, on: true}}), [], 'on: no entry');
  assert.deepEqual(linkedinEntries({view: {...off, loaded: false}}), [], 'state not read yet: no flash of an offer');
  assert.deepEqual(linkedinEntries({view: off, hidden: new Set([KEY])}), [], 'answered Not now in an earlier read');
  assert.deepEqual(linkedinEntries({view: off, held: new Set([KEY])}), [], 'answered here, not yet saved');
  assert.deepEqual(linkedinEntries({}), []);
  assert.ok(LOOK.linkedin && LOOK.linkedin.icon === 'linkedin', 'the row has its look (icon, edge colour, badge)');
});

test('the ask is for a real Find jobs press while it is due, not for a re-score or Find employers', () => {
  assert.equal(askOnPress({ask: true}, undefined), true);
  assert.equal(askOnPress({ask: true}, {}), true);
  assert.equal(askOnPress({ask: false}, undefined), false);
  assert.equal(askOnPress({ask: true}, {reason: 'rescore', count: 3}), false);
  assert.equal(askOnPress({ask: true}, {employers: true}), false);
  assert.equal(askOnPress(null, undefined), false);
});

test('the consent words: the owner\'s warning line verbatim, what is read, where it stays, and how to turn it off', () => {
  assert.equal(LINE, 'LinkedIn may limit accounts it thinks are automated; we read slowly and only your job searches.');
  for (const mode of ['ask', 'turn-on']) {
    const words = CONSENT[mode];
    assert.equal(words.line, LINE);
    assert.match(words.lead, /background/);
    assert.match(words.lead, /in a Jobadabra window, on LinkedIn's own page/, 'the sign-in window (owner, 3 Nov 2026), not Chrome');
    assert.match(words.lead, /you type your password there and Jobadabra never sees it/);
    assert.ok(words.lead.includes(`stays on this ${process.platform === 'win32' ? 'PC' : 'Mac'}`));
    assert.match(words.lead, /Settings → Connections → LinkedIn/);
    assert.equal(words.yes, 'Sign in to LinkedIn');
    assert.equal(words.chrome, 'Use my Chrome sign-in', 'the shortcut, shown only while the extension is connected');
    assert.equal(words.no, 'Not now');
  }
  assert.equal(CONSENT.manage.yes, 'Turn off');
  assert.equal(CONSENT.manage.no, 'Keep on');
});

test('every door opens the one consent: Settings row, ask on Find jobs, Suggestions entry, ⌘K', () => {
  // nav.js (⌘K) takes the command from the same module: addLinkedinCommands() adds the consent's commands (kept out of nav.js's long function: clean-code complexity)
  const doors = {'renderer/pages/settings.js': 'openLinkedinConsent', 'renderer/pages/jobs.js': 'askLinkedinOnPress', 'renderer/pages/focus-suggestions.js': 'openLinkedinConsent', 'renderer/pages/nav.js': 'addLinkedinCommands'};
  for (const [file, name] of Object.entries(doors)) {
    const source = readScreenSource(new URL(`../../../${file}`, import.meta.url), 'utf8');
    assert.match(source, new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '[./]*(pages/)?linkedin-consent\\.js'`), `${file} imports ${name} from the one consent module`);
  }
});

test('the consent dialog exists once in the page and uses the shared dialog look', () => {
  const html = readScreenSource(new URL('../../../renderer/index.html', import.meta.url), 'utf8');
  assert.equal(html.match(/id="linkedin-dialog"/g)?.length, 1);
  assert.match(html, /<dialog id="linkedin-dialog" class="save-dialog panel-dialog">/);
  assert.match(html, /<button class="secondary" id="linkedin-chrome" value="chrome" formnovalidate hidden><\/button>/, 'the Chrome shortcut button is hidden until the page shows it');
  const page = readScreenSource(new URL('../../../renderer/pages/linkedin-consent.js', import.meta.url), 'utf8');
  assert.match(page, /chrome: !!\(words\.chrome && view\.extension\)/, 'shown only while the extension is connected');
  assert.match(page, /\$\('linkedin-chrome'\)\.hidden = !chrome;/, 'the shared dialog shows the shortcut only when asked to');
  assert.match(page, /linkedinJobsSignIn\(\)/, 'the primary button opens the sign-in window');
});

// #3911 (owner, 12 Nov 2026: "how to renew the linkedin sign-in?" … searched ⌘K for "link" and found no way): the card says "Needs you", ⌘K has "Renew LinkedIn sign-in", and one dialog says the one step.
const ok = {loaded: true, on: true, signin: {state: 'ok', why: '', empties: 0}};
const needs = why => ({loaded: true, on: true, signin: {state: 'needs-you', why, empties: why === 'empty' ? 2 : 0}});

test('the Settings card says "Needs you" with the reason while the sign-in needs the person; Working and off say nothing extra', () => {
  assert.equal(signinLine(ok), '');
  assert.equal(signinLine({...needs('signed-out'), on: false}), '', 'off: the card is the offer, not a warning');
  assert.equal(signinLine({loaded: false}), '');
  const seen = new Set();
  for (const why of ['missing', 'signed-out', 'check', 'empty']) { const line = signinLine(needs(why)); assert.match(line, /^Needs you: /, why); seen.add(line); }
  assert.equal(seen.size, 4, 'one line per reason');
});

test('⌘K finds "Renew LinkedIn sign-in" for "link", "renew" and "sign in" while LinkedIn jobs is on, and it opens the one dialog', () => {
  assert.equal(renewCommandOf({loaded: true, on: false}), null, 'off: nothing to renew');
  const command = renewCommandOf(needs('signed-out'));
  assert.equal(command.label, 'Renew LinkedIn sign-in');
  for (const word of ['link', 'renew', 'sign in', 'sign-in', 'expired', 'signed out']) assert.ok(command.keywords.toLowerCase().includes(word) || command.label.toLowerCase().includes(word), word);
  assert.ok(renewCommandOf(ok), 'also while it works: the person may want to renew before it breaks');
  const words = CONSENT.renew;
  assert.match(words.title, /Renew/);
  for (const part of [/Chrome/, /extension/, /Find jobs/]) assert.match(words.lead, part, 'the one step');
  assert.equal(words.yes, 'Sign in to LinkedIn', 'the sign-in window works without Chrome');
  assert.equal(words.chrome, 'Use my Chrome sign-in');
});

test('the renew dialog is the third mode of the one consent: its yes signs in, never turns off', () => {
  const page = readScreenSource(new URL('../../../renderer/pages/linkedin-consent.js', import.meta.url), 'utf8');
  assert.match(page, /mode === 'manage' \? turnOff\(\) : signInHere\(mode === 'renew'\)/, 'only manage turns off; renew and turn-on sign in');
  const settings = readScreenSource(new URL('../../../renderer/pages/settings.js', import.meta.url), 'utf8');
  assert.match(settings, /mode: needsYou \? .renew. :/, 'the card\'s button opens renew while it needs you');
});

test('a renewal never says "LinkedIn jobs is on" and never waits for the switch (Gitar on #3914): it says the copy is saved; the next good read says "renewed"', () => {
  const page = readScreenSource(new URL('../../../renderer/pages/linkedin-consent.js', import.meta.url), 'utf8');
  assert.match(page, /answer\?\.ok && renew\) toast\(.LinkedIn sign-in saved./, 'the sign-in window path');
  assert.match(page, /if \(!renew\) watchUntilOn\(\)/, 'the Chrome path does not wait for an "on" that is already true');
  assert.match(page, /turnOnWithChrome\(mode === 'renew'\)/);
  assert.match(page, /signInHere\(mode === 'renew'\)/);
});
