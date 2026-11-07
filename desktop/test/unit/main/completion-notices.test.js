// Actual completion and private error callbacks preserve raw data, targets, privacy and canonical records while localizing user framing.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {notice} from '../../../lib/run-history.js';
import {createAppNotify} from '../../../lib/app-notify.js';
import {createWatcher} from '../../../lib/real-errors.js';
import {assertCatalogs} from '../../../../app-core/test/catalog-parity.js';
import {completionText} from '../../../i18n/completion-notices.js';
import {setLocale} from '../../../i18n/index.js';
afterEach(() => setLocale('en'));
const locales = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];
const done = ['Find jobs done', 'Stellen suchen abgeschlossen', 'Recherche d’offres : opération terminée', 'Ricerca di offerte: operazione completata', 'Búsqueda de empleo: tarea completada', 'Căutarea locurilor de muncă: operațiune încheiată', 'Поиск вакансий: завершено'];

test('actual announceRuns callback selects saved language and keeps exact native/toast target', t => {
  t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-11-07T12:00:00Z')});
  for (const [index, locale] of locales.entries()) {
    let rows = []; const output = [], settings = {displayLanguage: locale};
    const storage = {settings: () => settings, readText: () => JSON.stringify(rows)};
    const app = createAppNotify({DEMO: true, Notification: {isSupported: () => false}, app: {}, getStorage: () => storage,
      targets: {clean: x => x}, toWindow: (...args) => output.push(args), getWindow: () => null});
    app.announceRuns(); setLocale('es');
    rows = [{id: 41, kind: 'search', ok: true, new: 2, endedAt: new Date().toISOString()}];
    app.announceRuns(); app.announceRuns();
    assert.equal(output.length, 1); assert.equal(output[0][1].title, done[index]);
    assert.deepEqual(output[0][1].target, {run: 41});
  }
});

test('all completion branches localize authored copy while raw result/update prose and canonical calls stay unchanged', () => {
  const raw = 'Raw this Mac <result> {count} Keychain ⌘K';
  for (const locale of locales) {
    const cases = [
      {kind: 'search', new: 0}, {kind: 'search', new: 1234, trigger: 'schedule', where: 'github'},
      {kind: 'search', endedByTime: true, new: 2, log: ['Employers: read 2 of 14 sites in the time']},
      {kind: 'search', endedByTime: true}, {kind: 'search', ok: false}, {kind: 'search', off: true},
      {kind: 'search', rescore: true, scored: 21}, {kind: 'search', rescore: true, warnings: ['Raw warning']},
      {kind: 'search', rescore: true, ok: false}, {kind: 'mail', updates: [raw]}, {kind: 'mail', result: '2 updates Raw'},
      ...['insight','interviewInsight','weekly','kits','today','scout','prepare','interview','add','rejection','prep','import','tailor'].map(kind => ({kind, result: raw})),
    ];
    for (const fields of cases) {
      const run = {id: 'raw-id', ok: true, ...fields}, wire = JSON.stringify(run), canonical = notice(run);
      const shown = notice(run, locale);
      assert.deepEqual(shown.target, canonical.target); assert.equal(JSON.stringify(run), wire);
      assert.deepEqual(notice(run), canonical);
      if (locale !== 'en') assert.notEqual(shown.title, canonical.title, `${locale}/${JSON.stringify(fields)}`);
      if (fields.result && fields.kind !== 'search' || fields.updates) assert.ok(shown.body.includes(fields.updates?.[0] || fields.result));
      assert.doesNotMatch(shown.title, /\{\w+\}/);
    }
    assert.equal(notice({kind: 'unknown'}, locale), null);
    assert.equal(notice({kind: 'mail', ok: true}, locale), null);
  }
});

test('actual private error watcher localizes only scrubbed framing per invocation, retains canonical Sentry and throttle', () => {
  const settings = {language: 'de'}, notices = [], reports = []; let now = 1000;
  const watch = createWatcher({locale: () => settings.language, notice: text => notices.push(text), sentry: (...args) => reports.push(args), now: () => now});
  const entry = {kind: 'fill', text: 'the page fill failed', fields: {error: 'Raw <exception> {name} ada@example.test', url: 'https://fictional.test/private?name=Ada', version: 'raw-version'}};
  watch([entry]); watch([entry]);
  assert.equal(notices.length, 1); assert.match(notices[0], /Fehler beim Ausfüllen/);
  assert.ok(notices[0].includes('Raw <exception> {name}')); assert.doesNotMatch(notices[0], /ada@example|private|name=Ada/);
  settings.language = 'ru'; now += 3600001; watch([entry]); assert.match(notices[1], /Ошибка заполнения/);
  assert.deepEqual(reports[0], reports[2]);
  const canonical = []; createWatcher({notice: text => canonical.push(text)})([entry]);
  assert.match(canonical[0], /^⚠️ Jobadabra fill error on fictional.test \(extension raw-version\): /);
});


test('completion catalogs align every key, interpolation name and plural category', async () => {
  await assertCatalogs(locales, locale => import(`../../../i18n/catalogs/completion-notices/${locale}.js`));
});

test('counts and warning/partial verdicts use explicit presentation without inventing data', () => {
  for (const locale of locales) for (const count of [0, 1, 2, 5, 21, 1234]) {
    const run = {kind: 'search', ok: true, new: count};
    assert.equal(notice(run, locale).body, count ? completionText(locale, 'added', {count}) : completionText(locale, 'noAdded'));
    const warned = notice({...run, warned: true}, locale);
    assert.equal(warned.title, completionText(locale, 'warned', {name: completionText(locale, 'kind_search'), where: ''}));
    const partial = notice({...run, endedByTime: true}, locale);
    assert.ok(partial.body.startsWith(completionText(locale, 'partial'))); assert.doesNotMatch(partial.body, /undefined|NaN/);
    assert.ok(!partial.body.includes(completionText(locale, 'noAdded')));
    const scored = notice({...run, rescore: true, scored: count}, locale);
    assert.equal(scored.body, completionText(locale, 'scores', {count}));
  }
});

test('actual not-checked announceRuns short-circuit uses saved language without changing target or canonical verdict', t => {
  t.mock.timers.enable({apis: ['Date'], now: Date.parse('2026-11-07T12:00:00Z')});
  const titles = ['Gmail check not checked', 'Gmail wurde nicht geprüft', 'Gmail non vérifié', 'Gmail non controllato', 'Gmail sin revisar', 'Gmail nu a fost verificat', 'Gmail не проверен'];
  for (const [index, locale] of locales.entries()) for (const off of [true, false]) {
    let rows = []; const output = [], storage = {settings: () => ({displayLanguage: locale}), readText: () => JSON.stringify(rows)};
    const app = createAppNotify({DEMO: true, Notification: {isSupported: () => false}, app: {}, getStorage: () => storage,
      targets: {clean: x => x}, toWindow: (...args) => output.push(args), getWindow: () => null});
    app.announceRuns(); setLocale('es');
    rows = [{id: 42, kind: 'mail', ok: false, off, problem: off ? '' : 'not checked: raw provider reason', endedAt: new Date().toISOString()}];
    const wire = JSON.stringify(rows); app.announceRuns(); app.announceRuns();
    assert.equal(output.length, 1); assert.equal(output[0][1].title, titles[index]);
    assert.deepEqual(output[0][1].target, {run: 42}); assert.equal(JSON.stringify(rows), wire);
    assert.equal(output[0][1].body, completionText(locale, off ? 'gmailDisconnected' : 'gmailWhy'));
  }
});
