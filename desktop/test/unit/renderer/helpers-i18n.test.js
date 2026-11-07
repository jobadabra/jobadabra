// Helper catalogs keep seven real translations and preserve named interpolation boundaries.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const root = new URL('../../../', import.meta.url);
const locales = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];
const catalog = locale => import(new URL(`i18n/catalogs/helpers/${locale}.js`, root));
const parameters = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('helper messages have seven complete catalogs with matching named parameters', async () => {
  const {messages: english} = await catalog('en');
  assert.ok(Object.keys(english).length >= 50);
  for (const locale of locales) {
    const {messages} = await catalog(locale);
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(english).sort(), locale);
    for (const [key, value] of Object.entries(messages)) {
      assert.equal(typeof value, 'string', `${locale}.${key}`);
      assert.ok(value.trim(), `${locale}.${key}`);
      assert.deepEqual(parameters(value), parameters(english[key]), `${locale}.${key}`);
    }
  }
});

test('every migrated helper lookup is registered and user content stays outside the catalog', async () => {
  const {messages} = await catalog('en');
  const files = fs.readdirSync(new URL('renderer/job-drawer/', root)).filter(file => file.endsWith('.js')).map(file => `renderer/job-drawer/${file}`);
  files.push(...fs.readdirSync(new URL('renderer/', root)).filter(file => file.endsWith('.js')).map(file => `renderer/${file}`));
  let count = 0;
  for (const file of files) {
    const source = fs.readFileSync(new URL(file, root), 'utf8');
    for (const match of source.matchAll(/t\('helpers\.([^']+)'/g)) {
      assert.ok(match[1] in messages, `${file}: ${match[1]}`);
      count++;
    }
  }
  assert.ok(count >= 50, `only ${count} localized helper lookups`);
  const rows = fs.readFileSync(new URL('renderer/job-drawer/documents-rows.js', root), 'utf8');
  assert.match(rows, /document\.createTextNode\(part\)/);
});

test('localized controls resolve at call time and preserve interpolation as plain text', async () => {
  await import('../../../i18n/screens-helpers.js');
  const {setLocale, t} = await import('../../../i18n/index.js');
  const {foldToggleWord} = await import('../../../renderer/fold-toggle.js');
  try {
    setLocale('de');
    assert.equal(foldToggleWord(false), 'Anzeigen');
    setLocale('ru');
    assert.equal(foldToggleWord(true), 'Скрыть');
    assert.equal(t('helpers.yourAnswer', {answer: '<img onerror=bad>'}), 'Ваш ответ: <img onerror=bad>');
    setLocale('ro');
    assert.equal(t('helpers.position', {index: 2, total: 5}), '2 din 5');
  } finally { setLocale('en'); }
});

test('drawer facts translate labels while preserving posting, employer and answer text', async () => {
  await import('../../../i18n/screens-helpers.js');
  const {setLocale} = await import('../../../i18n/index.js');
  const {glanceTiles, postingFacts, postingBlocks, kitParts, allAnswers} = await import('../../../renderer/job-page-view.js');
  try {
    setLocale('ru');
    const tiles = glanceTiles({salary: 'CHF 120000', work_mode: 'Hybrid', technologies: 'Rust'});
    assert.equal(tiles[0].label, 'Зарплата');
    assert.equal(tiles[0].value, 'CHF 120000');
    assert.equal(tiles[1].value, 'Hybrid');
    assert.equal(tiles[1].note, 'Дни в офисе не указаны');
    const company = '<Acme & Sons>';
    assert.equal(postingFacts({company}, {}, 'Keep the original text.')[0].value, company);
    assert.equal(postingBlocks('## Original employer heading\nOriginal posting text.')[0].text, 'Original employer heading');
    const kit = kitParts({answers: [{question: 'Why Acme?', answer: '<My own answer>'}], cover_letter: 'My own letter'}, '');
    assert.equal(kit.letter, 'My own letter');
    assert.equal(allAnswers(kit.answers), 'Why Acme?\n<My own answer>');
  } finally { setLocale('en'); }
});

test('stage display translations never change stored board stages or filtering', async () => {
  await import('../../../i18n/screens-helpers.js');
  const {setLocale} = await import('../../../i18n/index.js');
  const rules = await import('../../../renderer/jobs-board-rules.js');
  try {
    setLocale('de');
    assert.equal(rules.stageText('Applied'), 'Beworben');
    assert.equal(rules.stageText('Kit ready'), 'Gespeichert');
    assert.equal(rules.stageText('Employer-specific stage'), 'Employer-specific stage');
    assert.equal(rules.columnOf({stage: 'Applied'}), 'Applied');
    assert.equal(rules.inView({stage: 'Applied'}, 'active'), true);
  } finally { setLocale('en'); }
});

test('timeline icon lookup keeps stored event kinds as keys', () => {
  const source = fs.readFileSync(new URL('renderer/job-drawer/tab-timeline.js', root), 'utf8');
  const icons = source.match(/const ICONS = (.*);/)[1];
  assert.equal(icons, "{'Job discovered': 'search', Applied: 'file', 'Confirmation received': 'check-circle', 'Interview scheduled': 'calendar', Rejected: 'close', Offer: 'check-circle'}");
});

test('AI install guidance translates copy while preserving executable commands and action ids', async () => {
  await import('../../../i18n/screens-helpers.js');
  const {setLocale} = await import('../../../i18n/index.js');
  try {
    setLocale('es');
    const {guide} = await import('../../../renderer/ai-plan-guide.js');
    const result = guide('app-only', {family: 'openai', platform: 'win32', inApp: true});
    assert.match(result.title, /Encontramos/);
    assert.equal(result.actions[0].id, 'install');
    assert.equal(result.actions[0].label, 'Instalar Codex');
    assert.equal(result.command, 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"');
    assert.match(result.steps[0], /^Abre PowerShell/);
  } finally { setLocale('en'); }
});

test('helper state catalogs have complete keys and matching interpolation in every plural branch', async () => {
  const stateCatalog = locale => import(new URL(`i18n/catalogs/helpers/${locale}-state.js`, root));
  const {messages: english} = await stateCatalog('en');
  const branches = value => typeof value === 'string' ? [value] : Object.values(value);
  for (const locale of locales) {
    const {messages} = await stateCatalog(locale);
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(english).sort(), locale);
    for (const [key, value] of Object.entries(messages)) {
      const expected = parameters(branches(english[key])[0]);
      for (const branch of branches(value)) {
        assert.ok(branch.trim(), `${locale}.${key}`);
        assert.deepEqual(parameters(branch), expected, `${locale}.${key}`);
      }
      if (typeof value === 'object') assert.equal(typeof value.other, 'string', `${locale}.${key}.other`);
    }
  }
});
