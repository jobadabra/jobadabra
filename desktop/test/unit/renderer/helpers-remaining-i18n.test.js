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

test('survey presentation translates known choices without changing saved schema or unknown answers', async () => {
  const {surveyText} = await import('../../../renderer/survey-display.js');
  const {lineOf, readLine} = await import('../../../renderer/survey-model.js');
  try {
    setLocale('de');
    assert.equal(surveyText('Age bracket'), 'Altersgruppe');
    assert.equal(surveyText('Woman'), 'Frau');
    assert.equal(surveyText('My own answer'), 'My own answer');
    const saved = lineOf('gender', 'Woman', 'Original note');
    assert.match(saved, /^Gender identity: Woman/);
    assert.equal(readLine(saved).option, 'Woman');
  } finally { setLocale('en'); }
});

test('lead guidance and search summaries translate around unchanged confirmed values', async () => {
  const lead = await import('../../../renderer/lead-confirm.js');
  const find = await import('../../../renderer/find-card-model.js');
  try {
    setLocale('de');
    assert.equal(lead.saveLabel([{}]), '1 Angabe bestätigen');
    assert.equal(lead.channelHint({state: 'ok', guess: 'Original channel'}, 'Original channel'), 'In der Nachricht genannt: Original channel.');
    const payload = lead.confirmed({new: true, fields: {agree: {}}}, {values: {kind: 'Applied', channel: 'Email', started: '2026-11-01', agree: 'yes'}, first: 'yes'});
    assert.equal(payload.kind, 'Applied');
    assert.equal(payload.channel, 'Email');
    assert.equal(payload.agreed, true);
    assert.equal(find.addedWords(2), '2 Stellen zur Liste hinzugefügt');
    assert.equal(find.runCounts(['Run counts: looked=8 matches=3 scored=2 good=1']).looked, 8);
    setLocale('ru');
    assert.equal(lead.saveLabel([{}, {}, {}]), 'Подтвердить 3 детали');
    assert.match(find.partialWords({log: ['Employers: read 3 of 10 sites in the time']}, 2), /^Частично:/);
  } finally { setLocale('en'); }
});

test('strategy and move summaries translate around original values, reasons and archive paths', async () => {
  const strategy = await import('../../../renderer/strategy-parts.js');
  const tune = await import('../../../renderer/tune-text.js');
  const {movedText} = await import('../../../renderer/store-move-text.js');
  try {
    setLocale('de');
    assert.equal(strategy.exclusionGroups({avoid: ['Title: Original phrase']}).hide[0].label, 'Titel: Original phrase');
    assert.match(strategy.salaryWords('130000 CHF/year gross').text, /130\.000/);
    assert.equal(tune.proposalCounts({why: 'Original engine reason'}), 'Original engine reason');
    assert.equal(tune.applyLabel(2), '2 Änderungen anwenden');
    const text = movedText({moved: {applications: 2}, kept: ['profile'], archive: '/Original Archive/backup'});
    assert.match(text, /^Nach Notion verschoben ✓ 2 Bewerbungen/);
    assert.ok(text.includes('/Original Archive/backup'));
  } finally { setLocale('en'); }
});

test('derived log guidance translates while unknown engine lines remain original', async () => {
  const {readableLog} = await import('../../../renderer/human-log.js');
  try {
    setLocale('de');
    const lines = readableLog(['Checked: Original employer', 'Checked: Another employer', 'Scored 2 of 3 job(s)', 'Original provider failure']);
    assert.equal(lines[0], '🏢 Auf Stellenbörsen gefundene Arbeitgeber geprüft: 2');
    assert.equal(lines[1], '🎯 Stellen bewertet: 2 von 3');
    assert.equal(lines[2], 'Original provider failure');
    setLocale('ru');
    assert.equal(readableLog(['Visit: the job list of example.test is readable'])[0], '🌐 Найден список вакансий example.test');
  } finally { setLocale('en'); }
});

test('desktop tips translate without changing the extension pool or its evidence metadata', async () => {
  const {TIPS} = await import('../../../renderer/tips-pool.js');
  const {tipText} = await import('../../../renderer/tips-view.js');
  const original = JSON.stringify(TIPS);
  try {
    for (const tip of TIPS) assert.equal(tipText(tip), tip.text, tip.id);
    for (const locale of ['de', 'fr', 'it', 'es', 'ro', 'ru']) {
      setLocale(locale);
      for (const tip of TIPS) {
        assert.ok(tipText(tip).length > 10, `${locale}.${tip.id}`);
        assert.notEqual(tipText(tip), tip.text, `${locale}.${tip.id}`);
      }
    }
    assert.equal(JSON.stringify(TIPS), original);
  } finally { setLocale('en'); }
});

test('mail recorded-update summaries use data counts independently of translated count labels', async () => {
  const {mailCounts, mailNoCards} = await import('../../../renderer/mail-report.js');
  try {
    setLocale('de');
    const report = {emails: [], updates: [], status: {emails: 0, updates: 3}};
    assert.equal(mailCounts(report).at(-1).label, 'Aktualisierungen erfasst');
    assert.equal(mailNoCards(report), '3 Aktualisierungen erfasst, aber ohne gespeicherte Einzelheiten.');
  } finally { setLocale('en'); }
});

test('suggestion badges translate without changing metadata, severity or repeated source suppression', async () => {
  const {entryParts, severityCounts, jobsEntries} = await import('../../../renderer/suggestions.js');
  const {summary} = await import('../../../renderer/form-fills-view.js');
  const {sessionStage, cancelAllButton} = await import('../../../renderer/session-state.js');
  try {
    setLocale('de');
    const entry = {kind: 'skills', topic: 'applying', source: 'Your CV', title: 'Original skill text', detail: 'Original evidence'};
    const display = entryParts(entry);
    assert.equal(display.badge, 'Ihr CV');
    assert.deepEqual(display.meta, ['Original evidence']);
    assert.equal(display.headline, entry.title);
    assert.equal(jobsEntries([entry])[0], entry);
    assert.equal(severityCounts([entry])[0].key, 'info');
    assert.equal(summary({outcome: 'Needs input', fields: {job: 'Original job'}}).outcome, 'Needs input');
    assert.equal(sessionStage({stage: 'form'}, true).text, 'Bewerbungsformular ausgefüllt');
    assert.equal(cancelAllButton([]).hidden, true);
  } finally { setLocale('en'); }
});

test('browser paths and match fragments stay original while their display explanations translate', async () => {
  const {lookedText} = await import('../../../renderer/extension-looked.js');
  const {placeLabel, matchGroups} = await import('../../../renderer/match-groups.js');
  const {answerOptions} = await import('../../../renderer/answer-options.js');
  try {
    setLocale('de');
    const path = '/Original <Profile>/Browser';
    assert.equal(lookedText([{dir: path, there: true}]), `Gesucht in ${path}.`);
    assert.equal(placeLabel('Zurich,Zurich,Switzerland · de'), 'Zurich, Switzerland · Deutsch');
    const entry = {fragment: '\\bOriginal\\b', label: 'Original'};
    assert.equal(matchGroups([entry]).whole[0], entry);
    const options = answerOptions({question: 'Original question', suggested: '<Original answer>'});
    assert.equal(options[0].value, '<Original answer>');
    assert.equal(options.at(-1).kind, 'change');
    assert.equal(options.at(-1).label, 'Mit Claude ändern…');
  } finally { setLocale('en'); }
});

test('a localized task title still receives the hint for its canonical run kind', async () => {
  const {aiLimitHead} = await import('../../../renderer/run-status.js');
  const {t} = await import('../../../i18n/index.js');
  try {
    setLocale('de');
    assert.equal(aiLimitHead({kind: 'mail', ok: false, problem: 'AI limit reached'}, 'Gmail prüfen').hint, t('helperState.increaseCheck'));
    assert.equal(aiLimitHead({kind: 'search', ok: false, problem: 'AI limit reached'}, 'Stellen suchen').hint, t('helperState.increaseSearch'));
  } finally { setLocale('en'); }
});

test('relocation display translates the yes prefix without changing the place value', async () => {
  const {relocationWords} = await import('../../../renderer/locations-model.js');
  try { setLocale('de'); assert.equal(relocationWords('yes', [{label: 'Original place'}]), 'Ja · Original Place'); }
  finally { setLocale('en'); }
});

test('find counts use localized position wording while their numeric data remains unchanged', async () => {
  const {countText} = await import('../../../renderer/find-bar.js');
  const result = {active: 1, total: 2};
  try { setLocale('de'); assert.equal(countText(result, 'x'), '1 von 2'); assert.deepEqual(result, {active: 1, total: 2}); }
  finally { setLocale('en'); }
});


test('coverage and board plural counts retain locale grouping and raw plural selection in every locale', async () => {
  const {filtersCard, placesCard, employersCard, ideasCard} = await import('../../../renderer/coverage-card.js');
  try {
    for (const locale of ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru']) {
      setLocale(locale);
      for (const count of [1, 2, 5, 1234, 1001]) {
        const shown = new Intl.NumberFormat(locale).format(count);
        const data = {narrow: true, suggestions: [{term: 'Original role', count}], excluded: [{fragment: 'Original', count}], languages: [{language: 'Original language', count}],
          places: {options: [{place: 'Original place', count}]}, for_you: [{company: 'Original company', interview: count, applied: 7, why: 'Original why'}]};
        const card = coverageCard(data), filters = filtersCard(data), employers = employersCard(data);
        const labels = [card.chips[0].title, filters.chips[0].title, filters.chips[1].title, placesCard(data).chips[0].title,
          employers.chips[0].label, employers.chips[0].title, ideasCard([{word: 'Original word', role: 'Original role', count, why: 'Original why'}]).chips[0].title,
          report({details: {boards: {read: count}}}).cards.find(item => item.id === 'boards').title];
        for (const value of labels) assert.ok(value.includes(shown), `${locale}/${count}: ${value}`);
        assert.equal(card.chips[0].count, count); assert.equal(data.suggestions[0].term, 'Original role');
        if (locale === 'ru') {
          const ending = count === 1 || count === 1001 ? 'открытая вакансия' : count === 2 || count === 1234 ? 'открытые вакансии' : 'открытых вакансий';
          assert.ok(card.chips[0].title.includes(`${shown} ${ending}`), card.chips[0].title);
        }
      }
    }
  } finally {setLocale('en');}
});
