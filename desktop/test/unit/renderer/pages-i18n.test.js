// Dynamic page localization: catalog parity and explicit boundaries preserve applicant content.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import '../../../i18n/screens-pages.js';
import {setLocale, t} from '../../../i18n/index.js';
import {install} from '../../tiny-dom.js';

const root = new URL('../../../', import.meta.url);
const locales = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];
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
        const forms = typeof value === 'string' ? [value] : Object.values(value);
        const english = typeof messages.en[key] === 'string' ? messages.en[key] : messages.en[key].other;
        assert.ok(forms.length);
        for (const form of forms) {
          assert.equal(typeof form, 'string');
          assert.deepEqual(parameters(form), parameters(english), `${locale}.${key}`);
          if (locale !== 'en' && !['no', 'question'].includes(key) && !(file === 'count-nouns.js' && locale === 'fr' && ['site', 'version'].includes(key))) assert.notEqual(form, english, `${locale}.${key}: real translation`);
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
