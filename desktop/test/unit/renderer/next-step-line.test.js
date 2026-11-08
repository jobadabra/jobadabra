// The line a finished Find jobs run's card says about what comes next (plan P3; owner, 8 Nov 2026, asked via AskUserQuestion: "Yes, as drawn (Recommended)":
// "Next: employer sites (561 left to read), then job boards", and "No, one action (Recommended)": no second button). Every state the card can be in.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {setLocale, SUPPORTED_LOCALES} from '../../../i18n/index.js';
import {nextStepLine, MAX_AGE_MS} from '../../../renderer/pages/next-step-line.js';
import {save, steps} from '../../../lib/next-step.js';

afterEach(() => setLocale('en'));
const NOW = Date.parse('2026-11-08T12:00:00Z');
const AT = '2026-11-08T11:00:00+00:00';
const RUN = {kind: 'search', id: 5, live: false, startedAt: '2026-11-08T10:50:00+00:00', endedAt: '2026-11-08T11:05:00+00:00'};   // the plan (AT) was made inside it
const line = (list, over = {}) => nextStepLine(over.run || RUN, {runs: over.runs || [RUN], nextStep: 'nextStep' in over ? over.nextStep : {steps: list, at: over.at || AT}, now: NOW});

test('the line as the owner drew it: the next step with its count, then the one after', () => {
  assert.equal(line([{step: 'employer_sites', left: 561}, {step: 'job_boards', left: 4}]), 'Next: employer sites (561 left to read), then job boards');
});

test('the free job APIs step is said "free job sources" (asked via AskUserQuestion, 8 Nov 2026: "free job sources (Recommended)", all languages)', async () => {
  assert.equal(line([{step: 'job_boards', left: null}, {step: 'free_job_apis', left: null}]), 'Next: job boards, then free job sources');
  for (const [locale, word] of [['de', 'freie Jobquellen'], ['fr', "sources d'emploi gratuites"], ['it', 'fonti di annunci gratuite'], ['es', 'fuentes de ofertas gratuitas'], ['ro', 'surse gratuite de joburi'], ['ru', 'бесплатные источники вакансий']]) {
    assert.equal((await import(`../../../i18n/catalogs/next-step/${locale}.js`)).default.step_freeJobApis, word, locale);
  }
});

test('a count of 0, none or nonsense is left out, and one step has no "then"', () => {
  for (const left of [0, null, undefined, -3, 2.5, '561']) assert.equal(line([{step: 'employer_sites', left}, {step: 'job_boards'}]), 'Next: employer sites, then job boards', String(left));
  assert.equal(line([{step: 'employer_sites', left: 7}]), 'Next: employer sites (7 left to read)');
  assert.equal(line([{step: 'job_boards', left: null}]), 'Next: job boards');
});

test('a step that is not reading says "left", and no step is ever said as scoring', () => {
  assert.equal(line([{step: 'scoring', left: 12}, {step: 'employer_sites'}]), 'Next: your waiting jobs (12 left), then employer sites');
  assert.equal(line([{step: 'kits', left: 3}]), 'Next: application kits (3 left)');
  for (const step of ['web_search', 'job_boards', 'employer_sites', 'free_job_apis', 'google_jobs', 'job_alert_emails', 'descriptions', 'places', 'title_sorting', 'scoring', 'job_facts', 'kits', 'employer_names']) {
    assert.doesNotMatch(line([{step}]), /scor/i, step);
  }
});

test('no plan, no step, an unknown step or an old plan: no line', () => {
  assert.equal(line([], {nextStep: null}), '');
  assert.equal(nextStepLine(RUN, {runs: [RUN], now: NOW}), '');
  assert.equal(line([]), '');
  assert.equal(line([{step: 'not_a_step', left: 4}]), '');
  assert.equal(line([{step: 'not_a_step', left: 4}, {step: 'job_boards'}]), 'Next: job boards', 'an unknown step is skipped, never said');
  const oldRun = at => ({...RUN, startedAt: new Date(Date.parse(at) - 60000).toISOString(), endedAt: new Date(Date.parse(at) + 60000).toISOString()});   // a run whose own plan is that old
  const tooOld = new Date(NOW - MAX_AGE_MS - 1000).toISOString(), justFresh = new Date(NOW - MAX_AGE_MS + 60000).toISOString();
  assert.equal(line([{step: 'job_boards'}], {at: tooOld, run: oldRun(tooOld), runs: [oldRun(tooOld)]}), '');
  assert.equal(line([{step: 'job_boards'}], {at: justFresh, run: oldRun(justFresh), runs: [oldRun(justFresh)]}), 'Next: job boards');
  assert.equal(line([{step: 'job_boards'}], {at: 'not a time'}), '');
});

test('only the newest finished Find jobs run says it, and never a running one or another kind', () => {
  const older = {...RUN, id: 4}, newer = {...RUN, id: 6};
  assert.equal(line([{step: 'job_boards'}], {run: older, runs: [older, RUN, newer]}), '');
  assert.equal(line([{step: 'job_boards'}], {run: newer, runs: [older, RUN, newer]}), 'Next: job boards');
  assert.equal(line([{step: 'job_boards'}], {run: {...RUN, live: true}}), '');
  assert.equal(line([{step: 'job_boards'}], {run: {kind: 'mail', id: 5, live: false}}), '');
  assert.equal(line([{step: 'job_boards'}], {runs: [RUN, {kind: 'search', id: 9, live: true}]}), 'Next: job boards', 'a search still running is not newer than a finished one');
});

test('only a plan this run made: an earlier run\'s plan, a Re-score or Sync that is the newest search, and a stopped run say nothing (review of #P3)', () => {
  const list = [{step: 'employer_sites', left: 561}];
  const rescore = {kind: 'search', id: 6, live: false, startedAt: '2026-11-08T11:30:00+00:00', endedAt: '2026-11-08T11:31:00+00:00'};
  assert.equal(line(list, {run: rescore, runs: [RUN, rescore]}), '', 'the plan was made before this run began: it is the Find jobs run\'s, not the Re-score\'s');
  assert.equal(line(list, {at: '2026-11-08T10:30:00+00:00'}), '', 'a plan saved by an earlier run, before this one started');
  assert.equal(line(list, {at: '2026-11-08T11:20:00+00:00'}), '', 'a plan made after this run ended (the next run\'s)');
  assert.equal(line(list, {at: '2026-11-08T11:08:00+00:00'}), 'Next: employer sites (561 left to read)', 'a moment after the record closed is still this run\'s end');
  assert.equal(line(list, {run: {...RUN, startedAt: undefined}}), '', 'a run with no start cannot be told from another');
  assert.equal(line(list, {run: {...RUN, endedAt: undefined}}), 'Next: employer sites (561 left to read)', 'no end yet: now is the end');
});

test('every language has every word and every sentence, with the same blanks (class check)', async () => {
  const catalogs = {};
  for (const locale of SUPPORTED_LOCALES) catalogs[locale] = (await import(`../../../i18n/catalogs/next-step/${locale}.js`)).default;
  const blanks = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join();
  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), Object.keys(catalogs.en).sort(), locale);
    for (const [key, text] of Object.entries(catalogs[locale])) {
      assert.ok(text.length > 0, `${locale}.${key}`);
      assert.equal(blanks(text), blanks(catalogs.en[key]), `${locale}.${key} keeps the blanks of English`);
      if (key.startsWith('step_')) assert.doesNotMatch(text, /scor|score/i, `${locale}.${key}`);
    }
  }
  setLocale('de');
  assert.equal(line([{step: 'employer_sites', left: 1234}, {step: 'job_boards'}]), 'Als Nächstes: Arbeitgeber-Seiten (noch 1.234 zu lesen), dann Jobbörsen');
  setLocale('ru');
  assert.match(line([{step: 'employer_sites', left: 5}]), /^Дальше: сайты работодателей \(осталось прочитать: 5\)$/);
});

test('the app keeps the engine answer as settings.nextStep and clears it on any failure', async () => {
  const kept = [], storage = {saveSettings: change => kept.push(change)};
  const answer = stdout => async () => ({stdout});
  assert.deepEqual(await save(storage, answer('noise\n{"ok": true, "steps": [{"step": "employer_sites", "left": 561}], "planned_at": "2026-11-08T11:00:00+00:00"}\n')),
    {steps: [{step: 'employer_sites', left: 561}], at: '2026-11-08T11:00:00+00:00'});
  assert.equal(await steps(storage, answer('{"ok": true, "steps": []}')), null);
  assert.equal(await steps(storage, answer('not json')), null);
  assert.equal(await steps(storage, async () => { throw new Error('engine down'); }), null);
  assert.deepEqual(kept.map(change => Object.keys(change)), [['nextStep']]);
  await save(storage, async () => { throw new Error('engine down'); });
  assert.deepEqual(kept[1], {nextStep: null}, 'a failed ask clears the line: a stale plan is never shown');
});
