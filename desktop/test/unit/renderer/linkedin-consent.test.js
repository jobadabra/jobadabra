// LinkedIn jobs, PR 1/3: the four doors (Settings row, ask on Find jobs, Suggestions entry, ⌘K) open ONE consent, and the words the owner approved on 31 Oct 2026 are in it.
// Pure parts: renderer/linkedin-words.js; the doors are checked by what each source file imports (one loop).
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CONSENT, KEY, LINE, askOnPress, linkedinEntries, renewCommandOf, signinLine} from '../../../renderer/linkedin-words.js';
import {LOOK} from '../../../renderer/suggestions.js';
import {registerLinkedinHandlers} from '../../../lib/linkedin-handlers.js';
import {viewOf as easyView} from '../../../lib/easy-apply-switch.js';

const off = {loaded: true, on: false, asked: 0, declined: 0, ask: true, hasSession: false};

test('each door turns LinkedIn jobs on: window in main, Chrome after its copy arrives; Easy Apply\'s door then shows its warning', async t => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, Object.assign(new EventTarget(), {open: false, showModal() {
      this.open = true;
      queueMicrotask(() => { this.open = false; this.returnValue = 'default'; this.dispatchEvent(new Event('close')); });
    }}));
    return nodes.get(id);
  };
  globalThis.document = {getElementById: node};
  globalThis.window = Object.assign(new EventTarget(), {pilot: {state: async () => ({settings: {}})}});
  try {
    const consent = await import('../../../renderer/pages/linkedin-consent.js');
    const easy = await import('../../../renderer/pages/easy-apply-consent.js');
    t.mock.timers.enable({apis: ['setTimeout']});
    for (const chrome of [false, true]) for (const mode of ['turn-on', 'easy-apply']) {
      const settings = {}, storage = {settings: () => settings, saveSettings: patch => Object.assign(settings, patch)};
      const items = new Map(), keychain = {read: key => items.get(key), write: (key, value) => { items.set(key, value); return true; }, remove: key => items.delete(key)};
      const handlers = new Map(), routes = new Map(), cookies = [{name: 'li_at', value: 'fake-session', domain: '.linkedin.com'}];
      registerLinkedinHandlers({DEMO: false, storage, ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, server: {setVisitRoute: (path, fn) => routes.set(path, fn), extensionSeen: () => chrome},
        deps: {keychain, isolated: true}, log: () => {}, signIn: async () => ({ok: true, cookies}), openPage: async () => {
          setImmediate(() => {   // the person finishes in Chrome after the page opened
            routes.get('/extension/linkedin-session')({cookies});
            assert.equal(settings.linkedinJobs?.on === true, false, 'the Chrome copy turns no switch on');
            assert.equal(settings.easyApply?.on === true, false);
            t.mock.timers.tick(2000);
          });
          return {opened: true};
        }});
      globalThis.window.pilot = {state: async () => ({settings: {}}), linkedinJobsState: async () => handlers.get('linkedinJobsState')(), easyApplyState: async () => easyView(storage, {packaged: false}),
        linkedinJobsSignIn: async options => handlers.get('linkedinJobsSignIn')({}, options),
        linkedinJobsConnect: async () => handlers.get('linkedinJobsConnect')(),
        linkedinJobsOn: async () => { if (!chrome) throw new Error('renderer closed before another IPC'); return handlers.get('linkedinJobsOn')(); },
        easyApplyOn: async options => (await import('../../../lib/easy-apply-switch.js')).turnOn(storage, options)};
      await consent.refreshLinkedin();
      if (mode === 'easy-apply') await easy.openEasyApply();
      else await consent.openLinkedinConsent({mode});
      assert.equal(settings.linkedinJobs?.on === true, true, `${mode} chrome=${chrome}`);
      assert.equal(settings.easyApply?.on === true, mode === 'easy-apply', 'Easy Apply goes on only after its own warning');
    }
  } finally { globalThis.window = previousWindow; globalThis.document = previousDocument; }
});

// Gitar on #4350, #4354: with the Chrome way open and no copy coming, LinkedIn jobs stays off when the wait ends, and the person is told.
// Owner, 14 Nov 2026: a sign-in already kept is used instead (the `chrome` flag below), never a second sign-in.
for (const kept of [false, true]) test(`the Chrome way ${kept ? 'with a sign-in already kept uses it, Chrome stays closed' : 'with none kept: no copy came, LinkedIn jobs stays off and says so'}`, async t => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const node = Object.assign(new EventTarget(), {open: false, showModal() {
    this.open = true;
    queueMicrotask(() => { this.open = false; this.returnValue = 'chrome'; this.dispatchEvent(new Event('close')); });
  }});
  globalThis.document = {getElementById: () => node};
  globalThis.window = Object.assign(new EventTarget(), {pilot: {state: async () => ({settings: {}})}});
  try {
    const consent = await import('../../../renderer/pages/linkedin-consent.js');
    t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-14T08:00:00Z')});
    const settings = {}, storage = {settings: () => settings, saveSettings: patch => Object.assign(settings, patch)};
    const items = new Map(), keychain = {read: key => items.get(key), write: (key, value) => { items.set(key, value); return true; }, remove: key => items.delete(key)};
    const handlers = new Map();
    registerLinkedinHandlers({DEMO: false, storage, ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, server: {setVisitRoute: () => {}, extensionSeen: () => true},
      deps: {keychain, isolated: true}, log: () => {}, openPage: async () => ({opened: true})});
    if (kept) {
      keychain.write((await import('../../../lib/linkedin-session.js')).SERVICE, JSON.stringify({li_at: 'older-fake-session'}));   // a sign-in kept with the switch off (the press that made it never turned it on)
      settings.linkedinJobs = {on: false, login: {state: 'kept', at: Date.now()}};
    }
    let reads = 0, live = true;
    globalThis.window.pilot = {state: async () => ({settings: {}}), linkedinJobsConnect: async () => handlers.get('linkedinJobsConnect')(), linkedinJobsOn: async () => handlers.get('linkedinJobsOn')(),
      linkedinJobsState: async () => {
        const view = await handlers.get('linkedinJobsState')();
        const step = ++reads > 2 ? 160000 : 2000;   // Chrome never sends a copy: the wait runs out
        setImmediate(() => { if (live) t.mock.timers.tick(step); });
        return view;
      }};
    const toasts = [];
    consent.bindToast((title, body) => toasts.push(body));
    await consent.refreshLinkedin();
    assert.equal(consent.view.extension, true, 'the Chrome way can be picked');
    assert.equal(await consent.openLinkedinConsent({mode: 'turn-on'}), kept);
    live = false;
    assert.equal(settings.linkedinJobs?.on === true, kept, kept ? 'the kept sign-in turned it on' : 'no copy came');
    if (!kept) assert.match(toasts.at(-1) || '', /Chrome sent no LinkedIn sign-in in time/, 'Gitar on #4354: the Chrome way says how it ended');
  } finally { globalThis.window = previousWindow; globalThis.document = previousDocument; }
});

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

// Why (owner, 14 Nov 2026, asked via AskUserQuestion: "Ask, Chrome first (Recommended)", then "make sure this popup make sense from all the states perspective"):
// every dialog that leads to a sign-in asks how, Chrome first; the ones that do not (Manage) ask nothing; Easy Apply's door says why it needs LinkedIn.
test('every sign-in door asks how to sign in, Chrome first; Manage asks nothing and says when Easy Apply stops too', () => {
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
  for (const mode of ['manage', 'manage-easy-apply']) assert.equal(CONSENT[mode].ways, undefined, `${mode} signs nobody in`);
  assert.match(CONSENT['easy-apply'].title, /for Easy Apply/);
  assert.match(CONSENT['easy-apply'].lead, /also turns on LinkedIn jobs/, 'it says what else turning on does');
  assert.doesNotMatch(CONSENT.manage.lead, /Easy Apply/);
  assert.match(CONSENT['manage-easy-apply'].lead, /Easy Apply uses the same sign-in, so it stops too/);
  const page = readScreenSource(new URL('../../../renderer/pages/linkedin-consent.js', import.meta.url), 'utf8');
  assert.match(page, /mode === 'manage' && view\.easyApply \? CONSENT\['manage-easy-apply'\]/, 'Manage names Easy Apply only while it is on');
  const door = readScreenSource(new URL('../../../renderer/pages/easy-apply-consent.js', import.meta.url), 'utf8');
  assert.equal(door.match(/Promise\.all\(\[refreshEasyApply\(\), refreshLinkedin\(\)\]\)/g)?.length, 2, 'Gitar on #4263: Easy Apply on and off re-read LinkedIn jobs\' view, so Manage never reads a stale easyApply');
  const easy = readScreenSource(new URL('../../../renderer/pages/easy-apply-consent.js', import.meta.url), 'utf8');
  assert.match(easy, /openLinkedinConsent\(\{mode: 'easy-apply'\}\)/, 'Easy Apply\'s door opens its own words');
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
  assert.match(page, /mode === 'manage' \? turnOff\(\)\.then\(\(\) => true\) : signInHere\(wanted\)/, 'only manage turns off; renew and turn-on sign in');
  assert.match(page, /const wanted = mode === 'renew' \? 'renew' : 'jobs';/);
  const settings = readScreenSource(new URL('../../../renderer/pages/settings.js', import.meta.url), 'utf8');
  assert.match(settings, /mode: needsYou \? .renew. :/, 'the card\'s button opens renew while it needs you');
});

test('a renewal never says "LinkedIn jobs is on" and never waits for the switch (Gitar on #3914): it says the copy is saved; the next good read says "renewed"', () => {
  const page = readScreenSource(new URL('../../../renderer/pages/linkedin-consent.js', import.meta.url), 'utf8');
  assert.match(page, /answer\?\.ok && renew\) toast\(.LinkedIn sign-in saved./, 'the sign-in window path');
  assert.match(page, /return wanted === 'renew' \? false : watchUntilSignedIn\(\);/, 'the Chrome path does not wait for an "on" that is already true');
  assert.match(page, /const renew = wanted === 'renew';/);
});
