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
  assert.match(entry.detail, /with Chrome's sign-in, or in a Jobadabra window/, 'the entry opens the choice, so it names both ways');
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
    assert.match(words.lead, /the way you choose below: Jobadabra never sees your password/, 'owner, 14 Nov 2026: "Ask, Chrome first"');
    assert.ok(words.lead.includes(`stays on this ${process.platform === 'win32' ? 'PC' : 'Mac'}`));
    assert.match(words.lead, /Settings → Connections → LinkedIn/);
    assert.equal(words.yes, 'Continue');
    assert.equal(words.no, 'Not now');
  }
  assert.equal(CONSENT.manage.yes, 'Turn off');
  assert.equal(CONSENT.manage.no, 'Keep on');
});

// Why (owner, 14 Nov 2026, asked via AskUserQuestion: "Ask, Chrome first (Recommended)"; then "a turn on should focus just on that specific case (easy apply or linkedin jobs)" · "he should never login 2 times"):
// every dialog that leads to a sign-in asks how, Chrome first; Easy Apply's door speaks only of Easy Apply; a sign-in already kept is never asked for again; Manage asks nothing.
test('every sign-in door asks how to sign in, Chrome first; each door speaks of its own switch; a kept sign-in is not asked again', () => {
  for (const mode of ['ask', 'turn-on', 'renew', 'easy-apply']) {
    const {ways, yes} = CONSENT[mode];
    assert.ok(ways, `${mode} asks how to sign in`);
    assert.equal(ways.title, 'How do you want to sign in?');
    assert.equal(ways.chrome, 'Use my LinkedIn sign-in from Chrome');
    assert.match(ways.chromeNote, /^Recommended\. No password/);
    assert.match(ways.chromeMissing, /Settings → Connections → Chrome extension/, 'without the extension the Chrome way says what it needs');
    assert.equal(ways.window, 'Sign in in a Jobadabra window');
    assert.equal(yes, 'Continue', `${mode}: the choice decides the way, so the button only continues`);
  }
  for (const mode of ['manage', 'turn-on-kept']) assert.equal(CONSENT[mode].ways, undefined, `${mode} signs nobody in`);
  const easy = CONSENT['easy-apply'];
  assert.equal(easy.title, 'Turn on LinkedIn Easy Apply?');
  assert.match(easy.line, /LinkedIn's terms do not allow automated applying/, 'the owner\'s Easy Apply warning (D4), so Continue is the warned yes');
  assert.doesNotMatch(`${easy.title} ${easy.lead} ${easy.line}`, /LinkedIn jobs|Find jobs/, 'it speaks only of Easy Apply');
  const kept = CONSENT['turn-on-kept'];
  assert.equal(kept.yes, 'Turn on');
  assert.match(kept.lead, /with the LinkedIn sign-in it already keeps for Easy Apply/);
  assert.doesNotMatch(kept.lead, /choose below/);
  assert.doesNotMatch(CONSENT.manage.lead, /Easy Apply/, 'LinkedIn jobs off no longer stops Easy Apply');
  const page = readScreenSource(new URL('../../../renderer/pages/linkedin-consent.js', import.meta.url), 'utf8');
  assert.match(page, /const kept = \(mode === 'turn-on' \|\| mode === 'ask'\) && view\.signedIn;/);
  assert.match(page, /export function openLinkedinConsent\(/, 'no wait before the dialog opens (Gitar on #4265: two openers raced past the one-dialog check)');
  const door = readScreenSource(new URL('../../../renderer/pages/easy-apply-consent.js', import.meta.url), 'utf8');
  assert.match(door, /const kept = await openLinkedinConsent\(\{mode: 'easy-apply'\}\);/, 'Easy Apply\'s door opens its own words');
  assert.match(door, /return kept \? turnOn\(true\) : undefined;/, 'on once the sign-in came, by either way');
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
  assert.doesNotMatch(html, /id="linkedin-chrome"/, 'no side button: the choice is the one way');
  assert.match(html, /<div class="choice-list" role="radiogroup" aria-labelledby="linkedin-ways-title">/, 'the shared choice list');
  for (const way of ['chrome', 'window']) assert.match(html, new RegExp(`<input type="radio" name="linkedin-way" value="${way}" id="linkedin-way-${way}">`));
  assert.ok(html.indexOf('id="linkedin-way-chrome"') < html.indexOf('id="linkedin-way-window"'), 'Chrome first');
  const page = readScreenSource(new URL('../../../renderer/pages/linkedin-consent.js', import.meta.url), 'utf8');
  assert.match(page, /chrome: !!\(words\.ways && view\.extension\)/, 'the Chrome way can be picked only while the extension is connected');
  assert.match(page, /\$\('linkedin-way-chrome'\)\.disabled = !chrome;/);
  assert.match(page, /\$\('linkedin-way-chrome'\)\.checked = chrome;/, 'Chrome is picked first when it can be');
  assert.match(page, /ways && dialog\.returnValue === 'default' && \$\('linkedin-way-chrome'\)\.checked \? 'chrome'/, 'Continue with Chrome picked goes the Chrome way');
  assert.match(page, /linkedinJobsSignIn\(\{for: wanted\}\)/, 'the window way says which switch asked');
  assert.match(page, /linkedinJobsConnect\(\{for: wanted\}\)/, 'so does the Chrome way');
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
  assert.match(words.lead, /Sign in to LinkedIn again, the way you choose below/, 'neutral: it opens for a sign-out, a check, or by hand');
  assert.ok(words.ways, 'the same choice as turning on');
});

test('the renew dialog is the third mode of the one consent: its yes signs in, never turns off', () => {
  const page = readScreenSource(new URL('../../../renderer/pages/linkedin-consent.js', import.meta.url), 'utf8');
  assert.match(page, /mode === 'manage' \? turnOff\(\)\.then\(\(\) => true\) : kept \? turnOnKept\(\) : signInHere\(wanted\)/, 'only manage turns off; renew and turn-on sign in (a kept sign-in is never asked again)');
  assert.match(page, /const wanted = mode === 'renew' \? 'renew' : mode === 'easy-apply' \? 'easy-apply' : 'jobs';/);
  const settings = readScreenSource(new URL('../../../renderer/pages/settings.js', import.meta.url), 'utf8');
  assert.match(settings, /mode: needsYou \? .renew. :/, 'the card\'s button opens renew while it needs you');
});

test('a renewal never says "LinkedIn jobs is on" and never waits for the switch (Gitar on #3914): it says the copy is saved; the next good read says "renewed"', () => {
  const page = readScreenSource(new URL('../../../renderer/pages/linkedin-consent.js', import.meta.url), 'utf8');
  assert.match(page, /answer\?\.ok && renew\) toast\(.LinkedIn sign-in saved./, 'the sign-in window path');
  assert.match(page, /return wanted === 'renew' \? false : watchUntilSignedIn\(wanted\);/, 'the Chrome path does not wait for an "on" that is already true');
  assert.match(page, /const renew = wanted === 'renew';/);
});
