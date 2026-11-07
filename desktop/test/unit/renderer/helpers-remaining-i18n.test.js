// Remaining helper copy translates around canonical report data, outcomes, and AI-produced CV findings.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setLocale} from '../../../i18n/index.js';
import {listRow, report} from '../../../renderer/searches-view.js';
import {summaryOf, fixesOf, documentFacts} from '../../../renderer/cv-check-model.js';
import {coverageCard} from '../../../renderer/coverage-card.js';
import {outcomeChoices} from '../../../renderer/outcome-tap.js';

test('search report copy follows the locale while raw logs, statuses and source names stay original', () => {
  try {
    setLocale('de');
    const row = {mode: 'first', where: 'mac', status: 'Running', log: 'Original engine log', details: {jobs: {fetched: 1234}, boards: {list: [{name: 'Example Board', jobs: 3}]}, problems: ['Original provider error']}};
    assert.equal(listRow(row).name, 'Erste Stellen');
    assert.equal(listRow(row).outcome, 'Running');
    const view = report(row);
    assert.equal(view.tiles[0].label, 'Gesehene Ausschreibungen');
    assert.equal(view.cards.find(card => card.id === 'log').lines[0], row.log);
    assert.equal(view.cards.find(card => card.id === 'problems').lines[0], row.details.problems[0]);
    assert.equal(view.cards.find(card => card.id === 'boards').rows[0].name, 'Example Board');
  } finally { setLocale('en'); }
});

test('CV summaries translate counts and document facts without rewriting findings or verdicts', () => {
  try {
    setLocale('de');
    const data = {ats: {verdict: 'Original verdict', checks: [{status: 'fail', label: 'Original title', detail: 'Original detail'}]}};
    assert.equal(summaryOf(data), 'Original verdict · 1 Problem');
    assert.equal(fixesOf(data)[0].title, 'Original title');
    assert.equal(documentFacts({pages: 2, size: 2.5 * 1024 * 1024}), '2 Seiten · 2,5 MB');
  } finally { setLocale('en'); }
});

test('coverage and outcome labels translate while action payloads keep canonical values', () => {
  try {
    setLocale('de');
    const card = coverageCard({narrow: true, suggestions: [{term: 'Original role', count: 2}], in_places: 10, matched: 2});
    assert.equal(card.title, 'Ihre Suche ist möglicherweise zu eng');
    assert.equal(card.chips[0].term, 'Original role');
    assert.equal(outcomeChoices('Applied')[0].label, 'Rückmeldung: eine Antwort');
    assert.deepEqual(outcomeChoices('Applied').map(item => item.outcome), ['reply', 'screening', 'offer', 'rejected', 'no_response']);
  } finally { setLocale('en'); }
});

test('localized coverage sites group by employer identity rather than their translated Open label', async () => {
  const {visitCard} = await import('../../../renderer/coverage-card.js');
  const {sitesByName} = await import('../../../renderer/strategy-parts.js');
  try {
    setLocale('de');
    const chips = visitCard({visits: [{url: 'https://example.test', name: 'Original Employer', why: 'Original explanation'}]}).chips;
    assert.equal(sitesByName(chips)[0].name, 'Original Employer');
  } finally { setLocale('en'); }
});
