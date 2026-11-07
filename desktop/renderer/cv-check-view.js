// Profile → CV: the CV check card (owner review fix 8, mockup 08, 18 Oct 2026). Two score rings (readability, content), the recommended fixes first with a
// priority chip and their fix behind "View details", then three folds (passed checks, score breakdown with what works and the missing terms, extracted
// text), then the two actions with their cost line. The header says when and on which CV the result was made (a result belongs to one PDF: lib/cv-check.js
// drops it when the PDF changes). A folded card says "Mostly readable · 3 issues · 2 content suggestions". Moved here from pages/profile.js;
// model: cv-check-model.js. Guarded by test/unit/renderer/cv-check-model.test.js and test/unit/renderer/cv-check-view.test.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {el, pill} from './components.js';
import {costText} from './ai-cost.js';
import {icon} from './icons.js';
import {costLine, fixesOf, passedOf, scoreTone, summaryOf} from './cv-check-model.js';

const $ = id => document.getElementById(id);
const TONE = {high: 'bad', medium: 'warn', low: 'neutral'};
const LABEL = {high: t('helperProfile.high'), medium: t('helperProfile.medium'), low: t('helperProfile.low')};
let last = null;   // the result shown, with how a review would be paid now
export const lastCheck = () => last;

// A score as a ring filled to its value, the number inside, its name and meaning beside it.
function scoreTile(kind, score, title, meaning) {
  const tile = el('div', 'cvc-tile');
  const ring = el('span', `cvc-ring tone-${scoreTone(kind, score)}`);
  ring.style.setProperty('--p', String(score));
  ring.append(el('b', '', String(score)));
  const words = el('div');
  const line = el('div', 'cvc-tile-score');
  line.append(el('b', '', String(score)), el('span', 'muted small', ' / 100'));
  words.append(el('span', 'cvc-tile-title', title), line, el('span', 'muted small', meaning));
  tile.append(ring, words);
  return tile;
}
function emptyTile(title, meaning) {
  const tile = el('div', 'cvc-tile is-empty');
  const words = el('div');
  words.append(el('span', 'cvc-tile-title', title), el('span', 'muted small', meaning));
  tile.append(el('span', 'cvc-ring'), words);
  return tile;
}

// One fix: its priority, what to change and why; "View details" opens the concrete change and says which check found it.
function fixRow(fix) {
  const row = el('details', 'cvc-fixline');
  const head = el('summary');
  const words = el('div', 'cvc-fix-words');
  words.append(el('b', '', fix.title), el('span', 'muted small', fix.issue));
  head.append(pill(LABEL[fix.priority], TONE[fix.priority]), words, el('span', 'cvc-more small', t('helperProfile.viewDetails')), icon('chevron', 'icon cvc-chevron'));
  const body = el('div', 'cvc-fix-body');
  if (fix.suggestion) body.append(el('span', 'cvc-fix', t('helperProfile.fix', {suggestion: fix.suggestion})));
  body.append(el('span', 'muted small', fix.from === 'content' ? t('helperProfile.fromContent') : t('helperProfile.fromReadability')));
  row.append(head, body);
  return row;
}

function fold(glyph, title, count, children) {
  const box = el('details', 'cvc-fold');
  const head = el('summary');
  head.append(icon(glyph), el('b', '', title), ...(count === '' ? [] : [el('span', 'muted', `· ${count}`)]), icon('chevron', 'icon cvc-chevron'));
  box.append(head, ...children);
  return box;
}
const part = (title, text) => { const row = el('div', 'cvc-comp'); row.append(el('b', '', title), el('span', 'muted small', text)); return row; };

// data: lib/cv-check.js's saved result (or null) plus `billing`; cvName: the CV's file name, said in the header.
// Beside the scores (mockup 08), never a line of its own: what kind of score this is.
const assessmentNote = () => { const note = el('p', 'cvc-note muted small'); note.append(icon('info'), t('helperProfile.assessmentNote')); return note; };

export function showCvCheck(data, {cvName = '', when = at => at} = {}) {
  last = data;
  const ats = data?.ats, ai = data?.ai, card = $('setting-cvcheck');
  card.dataset.summary = summaryOf(data);   // what the folded card says (profile-fold.js)
  $('cvc-state').textContent = ats ? t('helperProfile.checkedCv', {when: when(data.at), name: cvName || t('helperProfile.currentCv')}) : t('helperProfile.notChecked');
  $('cvc-state').classList.toggle('is-off', !ats);   // no green dot before a check
  $('cvc-scores').hidden = !ats;
  $('cvc-scores').replaceChildren(...(ats ? [scoreTile('readability', ats.score, t('helperProfile.readability'), t('helperProfile.readabilityHint')),
    ai ? scoreTile('content', ai.score, t('helperProfile.content'), t('helperProfile.contentHint')) : emptyTile(t('helperProfile.content'), t('helperProfile.contentNotReviewed')),
    assessmentNote()] : []));
  const fixes = fixesOf(data);
  $('cvc-fixes').hidden = !ats;
  $('cvc-fixes').replaceChildren(...(ats ? [el('h4', '', t('helperProfile.recommendedFixes')),
    ...(fixes.length ? fixes.map(fixRow) : [el('p', 'muted small', t('helperProfile.nothingFix'))])] : []));
  const folds = [];
  if (ats) {
    const passed = passedOf(data);
    if (passed.length) {
      const list = el('ul', 'cvc-checks');
      list.append(...passed.map(check => { const row = el('li', 'cvc-check is-pass'), body = el('div'); body.append(el('b', '', check.label), el('span', 'muted small', check.detail)); row.append(el('span', 'cvc-mark', '✓'), body); return row; }));
      folds.push(fold('check-circle', t('helperProfile.passedChecks'), passed.length, [list]));
    }
    const parts = [part(t('helperProfile.readabilityScore', {score: ats.score}), t('helperProfile.verdictPages', {verdict: ats.verdict, count: ats.pages}))];
    if (ai) {
      parts.push(...ai.components.map(item => part(`${item.name} · ${item.score}`, item.note)));
      if (ai.strengths.length) parts.push(part(t('helperProfile.workingWell'), ai.strengths.join(' · ')));
      if (ai.missing_keywords.length) parts.push(part(t('helperProfile.missingTerms'), t('helperProfile.addOnlyTrue', {terms: ai.missing_keywords.join(', ')})));
      const spent = ai.billing !== 'subscription' && costText(ai.usd);
      if (spent) parts.push(part(t('helperProfile.reviewCost'), spent));
    }
    folds.push(fold('chart', t('helperProfile.scoreBreakdown'), '', parts));
    const text = el('pre', 'cvc-pre', ats.text);
    folds.push(fold('file-text', t('helperProfile.extractedText'), '', [el('p', 'muted small', t('helperProfile.parserReads')), text]));
  }
  $('cvc-folds').hidden = !folds.length;
  $('cvc-folds').replaceChildren(...folds);
  $('cvc-ai-run').disabled = !ats;
  $('cvc-ai-run').title = ats ? '' : t('helperProfile.readabilityFirst');
  $('cvc-run-cost').textContent = costLine('readability');
  $('cvc-ai-cost').textContent = ats ? costLine('content', {billing: data?.billing, ai}) : t('helperProfile.afterReadability');
}

// An action pressed: its label says what it does meanwhile, then the card is drawn from the answer. options(): showCvCheck's options plus say(text, tone),
// the page's message line (pages/core.js message, passed in so this file loads without the page).
export async function cvCheckAction(button, working, run, options) {
  const label = button.querySelector('span') || button, was = label.textContent;
  button.disabled = true;
  label.textContent = working;
  options().say('');
  const result = await run().catch(error => ({ok: false, error: error.message}));
  button.disabled = false;
  label.textContent = was;
  if (!result.ok) { options().say(result.error, 'error'); return; }
  showCvCheck(result, options());
}
