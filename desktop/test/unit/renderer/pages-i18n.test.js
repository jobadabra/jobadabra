// Dynamic page localization: catalog parity and explicit boundaries preserve applicant content.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import '../../../i18n/screens-pages.js';
import {setLocale, t} from '../../../i18n/index.js';
import {install} from '../../tiny-dom.js';

const root = new URL('../../../', import.meta.url);
const locales = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];
// These small phrases have the same correct spelling in English and the named language.
const sameSpelling = new Set(['short-settings.js/ro/m325','short-settings.js/fr/m322', 'short-settings.js/fr/m355', 'short-settings.js/fr/m359','short-ready.js/de/m293','short-jobs.js/fr/m141','short-jobs.js/de/m184', 'short-jobs.js/fr/m200','short-activity.js/fr/m4', 'short-activity.js/es/m4','dynamic-profile-ready.js/fr/page','status.js/it/no', 'status.js/es/no', 'status.js/fr/question', 'count-nouns.js/fr/site', 'count-nouns.js/fr/version', 'dynamic-cv-data.js/de/inNotion', 'dynamic-cv-data.js/it/inNotion']);
const parameters = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('page catalogs provide seven real translations with matching interpolation', async () => {
  const dir = new URL('i18n/catalogs/pages/', root);
  const files = fs.readdirSync(dir).filter(file => file.endsWith('.js'));
  assert.ok(files.length);
  for (const file of files) {
    const {messages} = await import(new URL(file, dir));
    const keys = Object.keys(messages.en).sort();
    for (const locale of locales) {
      assert.deepEqual(Object.keys(messages[locale]).sort(), keys, `${file}: ${locale} keys`);
      for (const key of keys) {
        const value = messages[locale][key];
        const forms = typeof value === 'string' ? [['other', value]] : Object.entries(value);
        const english = typeof messages.en[key] === 'string' ? messages.en[key] : messages.en[key].other;
        assert.ok(forms.length);
        for (const [category, form] of forms) {
          const expected = typeof messages.en[key] === 'string' ? english : messages.en[key][category] || english;
          assert.equal(typeof form, 'string');
          assert.deepEqual(parameters(form), parameters(expected), `${locale}.${key}`);
          if (locale !== 'en' && !sameSpelling.has(`${file}/${locale}/${key}`)) assert.notEqual(form, english, `${locale}.${key}: real translation`);
        }
        if (typeof value === 'object') for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) {
          assert.ok(value[category] || value.other, `${locale}.${key}.${category}`);
        }
      }
    }
  }
});

test('page display copy uses explicit keys while workflow identifiers remain unchanged', () => {
  const source = fs.readFileSync(new URL('renderer/pages/ready-pick.js', root), 'utf8');
  assert.match(source, /t\('pagesCommon\.cancel'\)/);
  assert.match(source, /codes: top\.picked\.slice\(0, count\)\.map\(job => job\.code\)/);
  assert.match(source, /el\('li', '', job\.name \|\| job\.code\)/);
  const actions = fs.readFileSync(new URL('renderer/pages/session-actions.js', root), 'utf8');
  assert.match(actions, /stage: 'Applied', status: 'applied'/);
  assert.match(actions, /result\?\.error \|\| t\('pagesCommon\.tryAgain'\)/);
});


test('board and sending counts use Russian and Romanian categories, preserving English', () => {
  try {
    setLocale('ru');
    assert.equal(t('pagesCounts.board', {count: 1}), '1 отклик на доске');
    assert.equal(t('pagesCounts.board', {count: 2}), '2 отклика на доске');
    assert.equal(t('pagesCounts.board', {count: 5}), '5 откликов на доске');
    setLocale('ro');
    assert.equal(t('pagesCounts.sent', {count: 1}), '1 job trimis');
    assert.equal(t('pagesCounts.sent', {count: 2}), '2 joburi trimise');
    assert.equal(t('pagesCounts.sent', {count: 20}), '20 de joburi trimise');
    setLocale('en');
    assert.equal(t('pagesCounts.board', {count: 1}), '1 application on the board');
    assert.equal(t('pagesCounts.board', {count: 2}), '2 applications on the board');
  } finally { setLocale('en'); }
});

test('the fill picker translates its branches while job names stay plain text', async () => {
  install();
  const {pickFill} = await import('../../../renderer/pages/ready-pick.js');
  for (const locale of locales) {
    const body = install();
    try {
      setLocale(locale);
      const name = '<img src=x onerror=alert(1)> Employer';
      const answer = pickFill({picked: [{name, code: 'JOB-X', needsKit: true}], chips: [1]}, {start: 1});
      const dialog = body.querySelector('#ready-pick');
      assert.ok(dialog.textContent.includes(t('pagesDetails.fillCount')), locale);
      assert.ok(dialog.textContent.includes(t('pagesDetails.needsKit')), locale);
      assert.ok(dialog.textContent.includes(t('pagesCommon.nothingSubmitted')), locale);
      assert.equal(dialog.querySelector('li').textContent.startsWith(name), true, locale);
      assert.equal(dialog.querySelector('img'), null, 'applicant/job text must never become markup');
      dialog.querySelector('#ready-pick-no').click();
      assert.equal(await answer, null, 'Cancel preserves the no-submit behavior');
    } finally { setLocale('en'); }
  }
});

test('counted page nouns use native categories without translating noun identifiers', async () => {
  const {counted} = await import('../../../renderer/pages/page-counts.js');
  try {
    setLocale('ru');
    assert.equal(counted('job', 1), '1 вакансия');
    assert.equal(counted('job', 2), '2 вакансии');
    assert.equal(counted('job', 5), '5 вакансий');
    setLocale('ro');
    assert.equal(counted('site', 1), '1 site');
    assert.equal(counted('site', 2), '2 site-uri');
    assert.equal(counted('site', 20), '20 de site-uri');
  } finally { setLocale('en'); }
});

test('stored completion receipts keep their identifiers and user answers while their labels translate', async () => {
  const {outcomeLabel} = await import('../../../renderer/pages/session-outcomes.js');
  try {
    setLocale('ru');
    assert.equal(outcomeLabel('Filled in the form'), 'Заполнено в форме');
    assert.equal(outcomeLabel('Ticked in the form'), 'Отмечено в форме');
    assert.equal(outcomeLabel('Checked'), 'Проверено');
    assert.equal(outcomeLabel('To send: <em>Original answer</em>'), 'К отправке: <em>Original answer</em>');
    assert.equal(outcomeLabel('user-written content'), 'user-written content');
  } finally { setLocale('en'); }
});

test('a ready interview transcript keeps its Review & save action in Russian', async () => {
  const body = install();
  globalThis.window.pilot = {state: async () => ({settings: {}}), interviews: {}};
  for (const id of ['iv-drafts-block', 'iv-unsaved', 'iv-drafts']) {
    const node = globalThis.document.createElement('div'); node.id = id; body.append(node);
  }
  const {renderDrafts} = await import('../../../renderer/pages/interview-lists.js');
  let opened = '';
  try {
    setLocale('ru');
    renderDrafts([{id: 'fictional-draft', status: 'ready', kind: 'audio', createdAt: '2026-11-01T12:00:00Z', title: 'Fictional interview'}],
      {openId: () => '', openDraft: id => { opened = id; }});
    const button = body.querySelector('.iv-main');
    assert.equal(button.textContent, t('pagesJobs.reviewSave'));
    button.click();
    assert.equal(opened, 'fictional-draft');
  } finally { setLocale('en'); }
});

test('stored status, kind and error identifiers are never translated in comparisons', () => {
  for (const file of ['interview-lists', 'jobs-lead', 'linkedin-import', 'contact-proposals']) {
    const source = fs.readFileSync(new URL(`renderer/pages/${file}.js`, root), 'utf8');
    assert.doesNotMatch(source, /(?:draft\.status|v\.kind|item\.chip|result\.error)\s*[!=]==\s*t\(/, file);
  }
});

test('stage display labels preserve stored and unknown stages', async () => {
  const {stageName} = await import('../../../renderer/pages/page-labels.js');
  try {
    setLocale('ru');
    assert.equal(stageName('Applied'), 'Отклик отправлен');
    assert.equal(stageName('Withdrawn'), 'Отозвано');
    assert.equal(stageName('Custom stage <text>'), 'Custom stage <text>');
    setLocale('en');
    assert.equal(stageName('Kit ready'), 'Saved');
  } finally { setLocale('en'); }
});

test('every explicit page catalog reference resolves in English', () => {
  setLocale('en');
  const dir = new URL('renderer/pages/', root);
  for (const file of fs.readdirSync(dir).filter(file => file.endsWith('.js'))) {
    if (['core.js', 'shared.js', 'nav.js', 'startup.js', 'language.js'].includes(file)) continue;
    const source = fs.readFileSync(new URL(file, dir), 'utf8');
    for (const [, key] of source.matchAll(/['"](pages[A-Z][\w]*\.[\w]+)['"]/g)) {
      assert.notEqual(t(key), key, `${file}: ${key}`);
    }
  }
});
