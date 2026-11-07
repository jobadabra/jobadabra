// Final Settings/wizard/update copy crosses actual window callbacks without changing canonical data or invoking live services.
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {setLocale} from '../../../i18n/index.js';
import {registerStrategyDraftHandlers} from '../../../lib/strategy-draft-handlers.js';
import * as strategy from '../../../lib/strategy.js';
import {createAppUpdates} from '../../../lib/app-updates.js';
import {install} from '../../../lib/updater.js';

const locales = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];
afterEach(() => setLocale('en'));

test('actual wizard IPC sends localized progress while its fictional draft and stored note stay canonical', async t => {
  t.mock.method(globalThis, 'fetch', () => {throw new Error('network forbidden');});
  const prior = process.env.JOBADABRA_DEMO_STRATEGY_DELAY;
  process.env.JOBADABRA_DEMO_STRATEGY_DELAY = '1';
  try {
    for (const locale of locales) {
      setLocale(locale);
      const handlers = {}, sent = [], settings = {aiEngine: 'cli'};
      const raw = 'Fictional {AI} <b>Привет</b>';
      registerStrategyDraftHandlers({DEMO: true, here: fileURLToPath(new URL('../../../', import.meta.url)),
        ipcMain: {handle: (key, fn) => {handlers[key] = fn;}}, toWindow: (...args) => sent.push(args),
        storage: {settings: () => settings, saveSettings: patch => Object.assign(settings, patch), secret: () => ''},
        syncCv() {}, trackSetup() {}});
      const draft = await handlers.draftStrategy(null, {anything_else: raw});
      assert.equal(settings.questionnaire.anything_else, raw);
      assert.ok(draft.profile_markdown.includes(raw));
      assert.equal(sent[0][0], 'draftProgress');
      assert.equal(sent[0][1].percent, 20);
      if (locale !== 'en') assert.notEqual(sent[0][1].part, 'Proposing your goals', locale);
      assert.ok(!JSON.stringify(draft).includes('displayCopy'));
    }
  } finally {
    if (prior === undefined) delete process.env.JOBADABRA_DEMO_STRATEGY_DELAY;
    else process.env.JOBADABRA_DEMO_STRATEGY_DELAY = prior;
  }
});

test('actual update failure projects only authored guidance and preserves the canonical diagnostic in its log', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ok: false, status: 418}));
  setLocale('de');
  const settings = {};
  const updates = createAppUpdates({Menu: {}, dialog: {}, app: {isPackaged: true, getVersion: () => '1.0.0', getPath: () => '/fictional/Jobadabra.app/Contents/MacOS/Jobadabra', quit: () => assert.fail('must not quit')},
    getStorage: () => ({settings: () => settings, saveSettings: patch => Object.assign(settings, patch)}),
    getWindow: () => null, getTelemetry: () => null, track() {}, toWindow() {}});
  updates.setUpdateOffer({version: '1.0.1', download: 'https://fictional.invalid/update'});
  const result = await updates.installUpdate();
  assert.equal(result.ok, false);
  assert.ok(result.text.includes('418'));
  assert.notEqual(result.text, 'Download failed (418)');
  assert.equal(settings.updateTried, null);
});

test('updater callback keeps its canonical first argument and supplies explicit display provenance', async () => {
  const steps = [];
  await assert.rejects(install({download: 'fictional'}, {fetcher: async () => ({ok: false, status: 418}),
    onStep: (...args) => steps.push(args), quit: () => assert.fail('must not quit')}), /Download failed \(418\)/);
  assert.equal(steps[0][0], 'Downloading…');
  assert.equal(steps[0][1], 'updateDownloading');
});

test('wizard stream and rebuild recipes are private and preserve raw values through repeated locale projection', async () => {
  const {forWindow} = await import('../../../lib/settings-native-display.js');
  const raw = 'Fictional {count} <b>Привет</b>';
  const stream = JSON.stringify({summary: raw, goals: {seniority: raw}, profile_markdown: '# ' + raw + '\nBody', answers_markdown: '# Answers\nRaw', open_questions: [raw], search: {target_roles: [raw], locations: {top_tier: [raw]}}, preferences: {disqualifying_languages: []}, contact: {email: 'fictional@example.test'}});
  const progress = strategy.progress(stream);
  const groups = strategy.rebuildGroups({search: {}, profile: '', answers: ''}, {search: {target_roles: [{title: raw, also: []}], locations: {top_tier: [raw]}}, profile_markdown: '# ' + raw + '\nRaw', answers_markdown: '# Answer\nRaw'}, {scored: 21, kits: 2});
  const before = JSON.stringify({progress, groups});
  setLocale('en');
  assert.deepEqual(forWindow({progress, groups}), JSON.parse(before));
  for (const locale of locales.slice(1)) {
    setLocale(locale);
    const shown = forWindow({progress, groups});
    assert.notEqual(shown.progress.part, progress.part, locale);
    assert.ok(JSON.stringify(shown).includes(raw), locale);
    assert.notEqual(shown.groups[0].title, groups[0].title, locale);
    assert.equal(shown.groups[0].cost, groups[0].cost, 'cost is a canonical control enum');
    assert.equal(JSON.stringify({progress, groups}), before);
    assert.ok(!JSON.stringify(shown).includes('displayCopy'));
  }
});

test('Settings labels translate known display values and preserve unknown values and channel identities', async () => {
  const {channelNames, storeLabel, logDay} = await import('../../../renderer/settings-final-words.js');
  const channels = ['email', 'app', 'telegram'];
  for (const locale of locales.slice(1)) {
    setLocale(locale);
    assert.notEqual(channelNames(channels), 'email, app, telegram', locale);
    assert.notEqual(channelNames([]), 'nothing', locale);
    assert.notEqual(storeLabel({name: 'sqlite', caps: [], label: 'This Mac'}), 'This Mac', locale);
    assert.equal(storeLabel({caps: ['links'], label: 'Notion'}), 'Notion');
    const {t} = await import('../../../i18n/index.js');
    await import('../../../i18n/screens-pages.js');
    assert.equal(logDay('today', () => ''), t('pagesCommon.today').toLocaleLowerCase(locale), 'inline day word agrees with the existing capitalized picker label');
    assert.deepEqual(channels, ['email', 'app', 'telegram']);
  }
});

test('actual resume callback localizes known task names while leave-stopped touches no real storage or pipeline', async () => {
  const {createAppReminders} = await import('../../../lib/app-reminders.js');
  for (const locale of locales) {
    setLocale(locale);
    const questions = [];
    const reminders = createAppReminders({FOCUS_HOURS: [], Notification: {}, skippedLoops: new Set(),
      getWindow: () => null, getStorage: () => {throw new Error('real storage forbidden');},
      dialog: {showMessageBox: async options => {questions.push(options); return {response: 1};}},
      log() {}, notify() {}, targets: {clean: value => value}, toWindow() {}});
    await reminders.resumeQueue([{kind: 'search'}, {kind: 'mail'}]);
    assert.equal(questions.length, 1);
    assert.equal(questions[0].defaultId, 0);
    assert.equal(questions[0].cancelId, 1);
    if (locale !== 'en') assert.doesNotMatch(questions[0].message, /Find jobs|Gmail check/, locale);
  }
});

test('all bundled catalogs have matching keys/parameters and real Romanian/Russian count categories', async () => {
  const catalogs = await Promise.all(locales.map(locale => import(`../../../i18n/catalogs/settings-native/${locale}.js`).then(module => module.default)));
  const parameters = value => [...new Set(Object.values(typeof value === 'object' ? value : {other: value}).flatMap(text => [...text.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(match => match[1])))].sort();
  for (const [index, catalog] of catalogs.entries()) {
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(catalogs[0]).sort(), locales[index]);
    for (const key of Object.keys(catalog)) assert.deepEqual(parameters(catalog[key]), parameters(catalogs[0][key]), `${locales[index]}:${key}`);
  }
  for (const key of ['impactProfile', 'impactKits']) {
    assert.deepEqual(Object.keys(catalogs[5][key]).sort(), ['few', 'one', 'other']);
    assert.deepEqual(Object.keys(catalogs[6][key]).sort(), ['few', 'many', 'one', 'other']);
  }
});

test('actual update-check callback translates known HTTP framing while preserving its status code', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ok: false, status: 418}));
  setLocale('ru');
  const updates = createAppUpdates({Menu: {}, dialog: {}, app: {isPackaged: true, getVersion: () => '1.0.0'},
    getStorage: () => ({settings: () => ({})}), getWindow: () => null, getTelemetry: () => null, track() {}, toWindow() {}});
  const result = await updates.checkForUpdate(true);
  assert.equal(result.ok, false);
  assert.ok(result.text.includes('418'));
  assert.ok(!result.text.includes('GitHub answered'));
});

test('resume-name deduplication stays canonical before display so translations cannot change the question shape', async () => {
  const {createAppReminders} = await import('../../../lib/app-reminders.js');
  const {t} = await import('../../../i18n/native.js');
  setLocale('de');
  const questions = [];
  const reminders = createAppReminders({FOCUS_HOURS: [], Notification: {}, skippedLoops: new Set(),
    getWindow: () => null, getStorage: () => {throw new Error('real storage forbidden');},
    dialog: {showMessageBox: async options => {questions.push(options); return {response: 1};}},
    log() {}, notify() {}, targets: {clean: value => value}, toWindow() {}});
  // Existing taskName falls back to Find jobs for an unknown kind: the original Set therefore had one name.
  await reminders.resumeQueue([{kind: 'search'}, {kind: 'unknown-fixture'}]);
  await reminders.resumeQueue([{kind: 'unknown-fixture'}, {kind: 'search'}]);
  assert.equal(questions[0].detail, t('native.resumeOne'));
  assert.deepEqual(questions[1], questions[0], 'unknown-first order retains the same translated single-task question');
});

test('unknown update progress and raw diagnostics cannot become a catalog key or be translated by English matching', async () => {
  const {updateStepText} = await import('../../../i18n/settings-native.js');
  const {displayText} = await import('../../../i18n/display-values.js');
  const raw = 'Fictional {status} this Mac <b>raw</b>';
  for (const locale of locales) {
    setLocale(locale);
    assert.equal(updateStepText(raw, 'unknown-provider-step'), raw);
    assert.equal(updateStepText(raw), raw);
    assert.equal(displayText(new Error(raw), raw), raw);
    if (locale !== 'en') assert.notEqual(updateStepText('Downloading…', 'updateDownloading'), 'Downloading…');
  }
});

test('localized detail progress preserves the established English counted output', async () => {
  const {detailsProgress} = await import('../../../lib/wizard-progress-copy.js');
  const {detailsNote} = await import('../../../lib/details-at-setup.js');
  setLocale('en');
  for (const done of [{saved: ['a', 'b'], left: ['c']}, {saved: ['a'], left: []}, {}]) {
    assert.equal(detailsProgress(done), detailsNote(done));
  }
});
