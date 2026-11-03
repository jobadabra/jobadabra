// lib/cv-check.js: the parser-readiness checks on a PDF's text and layout, the content review's shape, and the cache of one PDF's result.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {analyse, hashOf, linesOf, review, save, saved, stated, withSections} from '../lib/cv-check.js';

const word = (str, x, y, w = 60, h = 9) => ({str, x, y, w, h});
const page = (text, images = [], n = 1) => ({n, width: 595, height: 842, images, text});
const body = 'Led the migration of forty services to Kubernetes and cut the monthly infrastructure bill by a third. '.repeat(6);
const good = () => [page([
  word('Ada Tester', 20, 30), word('ada@example.com', 20, 60), word('+41 79 555 01 23', 200, 60),
  word('Experience', 20, 100), word('Platform Engineer', 20, 120), word('Mar 2024 – Present', 20, 135),
  word(body, 20, 150, 500), word('Education', 20, 300), word('BSc Computer Science', 20, 315), word('Skills', 20, 350), word('Kubernetes, Terraform', 20, 365)])];

test('a plain one-column CV reads cleanly', () => {
  const result = analyse(good());
  assert.equal(result.score, 100, result.checks.filter(c => c.status !== 'pass').map(c => `${c.id}: ${c.detail}`).join('; '));
  assert.match(result.verdict, /Easy/);
  assert.equal(linesOf(good())[0], 'Ada Tester');
});

test('each thing a parser trips on costs points and says how to fix it', () => {
  const pages = good();
  pages[0].text = pages[0].text.filter(item => !/ada@|\+41|Education|Skills/.test(item.str));                                                  // no email, phone, education, skills
  pages[0].images = [{x: 530, y: 20, w: 40, h: 40}, {x: 0, y: 700, w: 595, h: 140}];                                                         // a photo and a banner
  pages.push(page([word('Page two', 20, 30)], [], 2), page([word('Page three', 20, 30)], [], 3));
  const result = analyse(pages), byId = Object.fromEntries(result.checks.map(c => [c.id, c]));
  for (const id of ['email', 'phone', 'education', 'skills', 'images', 'length']) { assert.notEqual(byId[id].status, 'pass', id); assert.ok(byId[id].fix, `${id} has a fix`); }
  assert.ok(result.score < 75 && /Risky/.test(result.verdict), `score ${result.score}`);
});

test('a picture of a CV has no text and fails hard', () => {
  const result = analyse([page([word('x', 20, 20)], [{x: 0, y: 0, w: 595, h: 842}])]);
  assert.equal(result.checks.find(c => c.id === 'text').status, 'fail');
  assert.ok(result.score <= 60);
});

test('two columns of sentences are read straight across, and said so', () => {
  const rows = Array.from({length: 6}, (_, i) => [word('Built and ran the platform for payments across regions', 20, 100 + i * 14, 250), word('Mentored four engineers and owned the on-call rota', 320, 100 + i * 14, 250)]).flat();
  const result = analyse([page([...good()[0].text, ...rows])]);
  assert.equal(result.checks.find(c => c.id === 'columns').status, 'warn');
});

test('dates in two styles, and icon-font symbols, are flagged', () => {
  const pages = good();
  pages[0].text.push(word('03/2022 – 02/2024', 20, 400), word(' Docker', 20, 420));
  const byId = Object.fromEntries(analyse(pages).checks.map(c => [c.id, c]));
  assert.equal(byId.dates.status, 'warn');
  assert.equal(byId.symbols.status, 'warn');
});

test('the content review is clamped, trimmed and priced', async () => {
  const fake = {messages: {create: async request => {
    assert.match(request.messages[0].content, /<cv>[\s\S]*Ada Tester/);
    return {stop_reason: 'end_turn', usage: {input_tokens: 2000, output_tokens: 500}, content: [{type: 'text', text: JSON.stringify({
      score: 140, sections: {experience: 'Experience', education: '', skills: ''}, components: [{name: 'Evidence', score: -5, note: 'numbers'}], strengths: ['a'], missing_keywords: Array.from({length: 14}, (_, i) => `k${i}`),
      fixes: Array.from({length: 11}, (_, i) => ({where: 'Experience', issue: `i${i}`, suggestion: 's', impact: 'high'}))})}]};
  }}};
  const result = await review({}, '', 'Ada Tester\nExperience', {client: fake});
  assert.equal(result.score, 100);
  assert.equal(result.components[0].score, 0);
  assert.equal(result.fixes.length, 8);
  assert.equal(result.missing_keywords.length, 10);
  assert.equal(result.usd, 0.01);
});

test('headings in any language count once the content review names them (8 Oct 2026: "Expérience" failed)', () => {
  const pages = good();
  for (const item of pages[0].text) item.str = {Experience: 'Expérience professionnelle', Education: 'Formation', Skills: 'Compétences'}[item.str] || item.str;
  const before = analyse(pages), byId = result => Object.fromEntries(result.checks.map(c => [c.id, c]));
  assert.equal(byId(before).experience.status, 'fail');
  assert.equal(before.score, 70);
  const after = withSections(before, {experience: 'Expérience professionnelle', education: 'formation', skills: 'Langues'});   // "Langues" is not a line of this CV
  assert.equal(byId(after).experience.status, 'pass');
  assert.match(byId(after).experience.detail, /Expérience professionnelle/);
  assert.equal(byId(after).education.status, 'pass');
  assert.equal(byId(after).skills.status, 'warn', 'an AI heading that is not in the CV does not count');
  assert.equal(after.score, 95);
  assert.match(after.verdict, /Easy/);
  assert.equal(withSections(before, undefined), before);
});

test('the result belongs to one PDF: another CV starts clean', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-check-'));
  const storage = {path: (...parts) => path.join(dir, ...parts)};
  fs.writeFileSync(storage.path('cv.pdf'), 'ONE');
  assert.equal(saved(storage), null);
  save(storage, {ats: {score: 88}});
  assert.equal(saved(storage).ats.score, 88);
  save(storage, {ai: {score: 70}});
  assert.deepEqual([saved(storage).ats.score, saved(storage).ai.score], [88, 70]);   // the parts add up
  fs.writeFileSync(storage.path('cv.pdf'), 'TWO');
  assert.equal(saved(storage), null);
  assert.notEqual(hashOf(storage), '');
});

test('a keyword the CV already states is never listed as missing', async () => {
  assert.ok(stated('Ran Kubernetes and Terraform on AWS', 'terraform'));
  assert.ok(!stated('Ran SLOs', 'SLO'), 'a term inside another word is not stated');
  const fake = {messages: {create: async () => ({stop_reason: 'end_turn', usage: {}, content: [{type: 'text', text: JSON.stringify({
    score: 70, components: [], strengths: [], fixes: [], missing_keywords: ['Kubernetes', 'Prometheus', 'SLO']})}]})}};
  const result = await review({}, '', 'Ada Tester\nRan Kubernetes on AWS.', {client: fake});
  assert.deepEqual(result.missing_keywords, ['Prometheus', 'SLO']);
});

test('dates read in the CV\'s own language, month names from the system (8 Oct 2026: "janv. 2024" read as no dates)', () => {
  const lines = text => [page(text.split('\n').map((str, i) => word(str, 20, 30 + i * 15, 300)))];
  for (const range of ['janv. 2024 – aujourd\'hui', 'März 2022 – heute', 'wrzesień 2020 – obecnie', 'сентябрь 2019 – 2021', 'Mar 2024 – Present']) {
    const dates = analyse(lines(`Ada Tester\n${range}`)).checks.find(c => c.id === 'dates');
    assert.equal(dates.status, 'pass', `${range}: ${dates.detail}`);
  }
});

// Windows tester on 0.9.2, 3 Nov 2026 (issue #3061): a PDF with ligatures got readability 100/100 while the AI review said words were split ("fi nancial"), and
// the same one-column PDF was flagged "5 lines side by side". A ligature glyph (fi, fl, ffi) arrives as its own text item between two long ones.
// Each line is [text before, ligature, text after, gap before the ligature, gap after it]: pdf.js places the glyph's own item between two runs; the gaps are what its widths leave (0, a hair over, or a hair of overlap).
const ligatureLine = (y, [before, ligature, after, gapIn = 0, gapOut = 0]) => [word(before, 20, y, 200), word(ligature, 220 + gapIn, y, 8), word(after, 228 + gapIn + gapOut, y, 260)];
const withLigatures = (code = false) => {
  const pages = good();
  const lines = [['Reduced the cost of the group ', 'fi', 'nancial reporting cycle by a third each quarter'], ['Cut the time to produce a monthly ', 'fi', 'gure pack from nine days to three', 0.3, 0.3],
    ['Owned and ran the whole annual o', 'ffi', 'ce move for a hundred people, on budget', -0.5, -0.5], ['Introduced a retirement-plan ', 'fl', 'ow review across the whole company', 0.2, 0],
    ['Led a well-trained support team of the ', 'fi', 'rst twelve engineers hired in the group', 0, 0.4]];
  pages[0].text.push(...lines.flatMap((line, i) => ligatureLine(190 + i * 12, code ? [line[0], line[1] === 'fi' ? '\uFB01' : line[1], ...line.slice(2)] : line)));
  return pages;
};

test('a word split at a ligature is one word in the text a parser and the AI read, and the spaces around it stay', () => {
  const text = linesOf(withLigatures()).join('\n');
  assert.match(text, /the group financial reporting/);
  assert.match(text, /a monthly figure pack/);
  assert.match(text, /whole annual office move/);
  assert.match(text, /retirement-plan flow review/);
  assert.match(text, /of the first twelve engineers/);
  assert.doesNotMatch(text, /\b(?:fi|fl|ffi) [a-z]/, 'no space inside a word');
});

test('a ligature saved as one code point (U+FB01) reads as its letters', () => {
  const text = linesOf(withLigatures(true)).join('\n');
  assert.match(text, /the group financial reporting/);
  assert.doesNotMatch(text, /\uFB01/);
});

test('a ligature in a slightly different row is still part of its line (the columns check groups rows like the text)', () => {
  const pages = withLigatures();
  pages[0].text = pages[0].text.map(item => (/^f[il]$|^ffi$/.test(item.str) ? {...item, y: item.y + 2.9} : item));   // the glyph's own font sits lower
  assert.equal(analyse(pages).checks.find(c => c.id === 'columns').status, 'pass');
  assert.match(linesOf(pages).join('\n'), /the group financial reporting/);
});

test('a ligature gap is not a second column', () => {
  assert.equal(analyse(withLigatures()).checks.find(c => c.id === 'columns').status, 'pass');
});
