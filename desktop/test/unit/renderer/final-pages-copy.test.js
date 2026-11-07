// Display-only readers localize owned page chrome while preserving canonical values and unknown raw content.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test, afterEach} from 'node:test';
import {setLocale} from '../../../i18n/index.js';
import {partTitle, preferenceField, preferenceSide, preferenceOption, reportHeading, reviewHeading, finalText} from '../../../renderer/final-pages-copy.js';
import {PARTS} from '../../../renderer/experience-profile-model.js';
import {FIELDS, SIDES, fieldChange, summaryOf} from '../../../renderer/preferences-model.js';
const locales = ['en','de','fr','it','es','ro','ru'];
afterEach(() => setLocale('en'));

test('Profile display titles and Strategy field/option labels change per locale while writes remain canonical', () => {
  const wire = JSON.stringify({PARTS,FIELDS,SIDES});
  for (const locale of locales) {
    setLocale(locale);
    assert.equal(partTitle('section:raw', 'Raw <heading> {title}'), 'Raw <heading> {title}');
    if (locale !== 'en') {
      assert.notEqual(partTitle('summary', PARTS.summary.title), PARTS.summary.title);
      assert.notEqual(preferenceField(FIELDS.find(x => x.key === 'home')).label, 'Home base');
      assert.notEqual(preferenceSide('must', SIDES.must).title, SIDES.must.title);
      assert.notEqual(preferenceOption('Permanent only'), 'Permanent only');
    }
    assert.equal(preferenceOption('Raw custom <choice> {value}'), 'Raw custom <choice> {value}');
    assert.deepEqual(fieldChange(FIELDS.find(x => x.key === 'home'), null, 'Raw location', null), {op:'append',key:'home',lines:['Home base: Raw location']});
    assert.equal(JSON.stringify({PARTS,FIELDS,SIDES}), wire);
  }
});

test('only known authored report/review headings are projected; canonical parser and raw prose stay original', () => {
  for (const locale of locales) {
    setLocale(locale);
    assert.equal(reportHeading('Raw custom heading'), 'Raw custom heading');
    assert.equal(reviewHeading('Raw AI heading {name}'), 'Raw AI heading {name}');
    if (locale !== 'en') {
      assert.notEqual(reportHeading('Numbers'), 'Numbers');
      assert.notEqual(reviewHeading('Strengths'), 'Strengths');
      assert.notEqual(reviewHeading('Weak answers (2 of 5)'), 'Weak answers (2 of 5)');
    }
  }
});

test('preference empty/overflow display and raw rules use locale grammar independently of canonical model summaries', () => {
  const rows = [{value:'Raw one'},{value:'Raw two'},{value:'Raw three'}];
  for (const locale of locales) {
    setLocale(locale);
    assert.equal(summaryOf(rows), 'Raw one · Raw two · 1 more');
    assert.ok(finalText('more', {count: 21}).includes('21'));
  }
});

test('fixed salary examples are fully localized and supplied hints/options remain raw', () => {
  for (const [locale, expected] of [['de','brutto'],['ru','до налогов']]) {
    setLocale(locale);
    for (const key of ['target','minimum']) {
      const field = preferenceField(FIELDS.find(field => field.key === key));
      assert.ok(field.placeholder.includes(expected)); assert.doesNotMatch(field.placeholder, /gross/);
      assert.ok(field.placeholder.includes(key === 'target' ? '150k' : '130k'));
    }
  }
});

test('seven final catalogs retain keys, interpolation names and complete plural categories', async () => {
  const {assertCatalogs} = await import('../../../../app-core/test/catalog-parity.js');
  await assertCatalogs(locales, locale => import(`../../../i18n/catalogs/final-pages/${locale}.js`));
});

test('notification palette actual callbacks localize their copy and retain action dispatch', async () => {
  const {setNotifyState,setNotifyActions,addNotifyCommands} = await import('../../../renderer/pages/notify-commands.js');
  const actions = [];setNotifyActions({open: () => actions.push('open'),resend: () => actions.push('resend')});
  for (const locale of locales) {
    setLocale(locale); const rows = [];
    setNotifyState({by: [],email:'fictional@example.test',confirmed:false,telegram:false,reached:true});
    addNotifyCommands((...args) => rows.push(args));
    assert.ok(rows.length > 0);
    if (locale !== 'en') assert.notEqual(rows[0][1], 'Get a message when something needs you');
    rows[0][4]();assert.equal(actions.at(-1),'open');
  }
});

test('actual interview picker suffix and review dialog headings localize without changing raw job/review content', async () => {
  const {install} = await import('../../tiny-dom.js'); const body = install();
  globalThis.window.pilot.state = async () => ({settings: {}});
  const {jobName} = await import('../../../renderer/pages/interview-lists.js');
  const {showReview,reviewParts} = await import('../../../renderer/interview-review-view.js');
  const {el,pill} = await import('../../../renderer/components.js');
  const nodes = Object.fromEntries(['review-title','review-facts','review-body','review-dialog'].map(id => {
    const node = globalThis.document.createElement('div'); node.id = id; body.append(node); return [id,node];
  })); nodes['review-dialog'].showModal = () => {};
  const job = {company:'Raw <Company> {name}',title:'Raw Role',status:'applied'};
  const record = {title:'Raw review',review:'## Strengths\nRaw AI prose {name}\n## Raw custom heading\nRaw other prose'};
  const wire = JSON.stringify({job,record});
  for (const locale of locales) {
    setLocale(locale);
    assert.ok(jobName(job).startsWith(`${job.company} — ${job.title}`));
    if (locale !== 'en') assert.doesNotMatch(jobName(job), /\(applied\)/);
    showReview(record, {$: id => nodes[id],el,pill});
    assert.ok(nodes['review-body'].textContent.includes('Raw AI prose {name}'));
    assert.ok(nodes['review-body'].textContent.includes('Raw custom heading'));
    if (locale !== 'en') assert.ok(!nodes['review-body'].querySelectorAll('h3').some(node => node.textContent === 'Strengths'));
    assert.equal(reviewParts(record).groups[0].title, 'Strengths', 'canonical parser headings stay unchanged');
    assert.equal(JSON.stringify({job,record}), wire);
  }
});

// Path labels override command labels in shownLabel, so every fixed group must be localized at construction.
test('palette paths never bypass translated fixed group names', () => {
  const source = readFileSync(new URL('../../../renderer/pages/nav.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /pathOf\(['"](?:Profile|Settings|Jobs|Reports|Actions|Strategy|Interviews)['"]/);
});
