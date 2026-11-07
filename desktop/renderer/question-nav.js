// Moving between application questions in the review drawer (owner, 18 Oct 2026: "I don't like this dropdown... make it nice. Modern." →
// option A of https://claude.ai/artifact/7hsZipME4De62YarGwUTTP): one segment per question (click to jump; one plain bar past 30), a button that
// names the question and opens the queue list (the shared ⋯ menu's list rows: kind tile, where it comes from, its state, the set-aside ones
// apart, a search box from 9), and previous / next arrows. Replaces the native <select> (qr-pick). Drawn by pages/question-review.js, which owns
// the state and passes it in. Guarded by test/unit/renderer/question-review.test.js ("navigator: …") and test/unit/renderer/ui-menu-rows.test.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {el, openMenu} from './components.js';
import {icon} from './icons.js';

const SEGMENTS_UP_TO = 30;   // past it each segment would be a few pixels wide: one plain bar instead
const SEARCH_FROM = 9;   // owner, 18 Oct 2026: "From 9 questions"

// What a Your details item asks for (lib/details-review.js), over its answer box and as its state in the list.
export const ASKS = {taught: t('helperFlow.learnedForm'), conflict: t('helperFlow.pickRight'), which: t('helperFlow.pickRight'), where: t('helperFlow.pickHome'), check: t('helperFlow.pickParts'), open: t('helperFlow.missingAnswer'), unclear: t('helperFlow.makeSure'), contact: t('helperFlow.askedForms'), cvcheck: t('helperFlow.checkIt')};

// A contact detail's words by the AI's rating of how many applications for this person's line of work ask it (lib/contact-review.js importance; below 2 is never asked).
const FORMS_ASK = {3: t('helperFlow.neededEveryForm'), 2: t('helperFlow.askedManyForms')};
/** What a Your details item asks, in words: a contact detail by how many forms ask it, any other kind by ASKS; `other` when the kind is not in the list. */
export const askWords = (details, other = '') => (details.kind === 'contact' ? FORMS_ASK[details.importance] || ASKS.contact : ASKS[details.kind] || other);

// A question's kind (question-kind.js KINDS) → its tile's icon.
const KIND_TILE = {text: 'file-text', long_text: 'file-text', single: 'sliders', multi: 'layers', yes_no: 'check-circle', date: 'calendar', amount: 'coins',
  salary: 'coins', duration: 'clock', link: 'link', per_country: 'globe', language: 'globe', range: 'sliders'};

// The navigator's words for a question: its first words, never a cut word.
export function shortTitle(text, most = 56) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= most) return clean;
  const cut = clean.slice(0, most);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), most - 12)).replace(/[\s,.;:–—-]+$/, '')}…`;
}

// Where a question comes from: its Your details section, or the form that asked it.
export const sourceOf = q => (q.setup ? t('helperFlow.applicationSetup') : q.details ? q.details.where || t('helperFlow.yourDetails') : [q.company, t('helperFlow.applicationForm')].filter(Boolean).join(' · '));

// Its state in the list: [words, tone] for pill(). Answered questions leave the queue, so these are the ones still open.
export function stateOf(q, {aside = false, drafted = false} = {}) {
  if (aside) return [q.dismissed ? t('helpers.stageDismissed') : t('helperFlow.setAside'), 'neutral'];
  if (drafted) return [t('helperFlow.draft'), 'neutral'];
  if (q.setup) return [q.priority, 'bad'];
  if (q.details) return [askWords(q.details, t('helperFlow.missingAnswer')), 'warn'];
  return q.proposal ? [t('helperFlow.suggested'), 'info'] : [t('helperFlow.missing'), 'warn'];
}

// The header's "where am I" block. state: {queue, setAside, at, aside}; drafts: a Map of typed answers by key; go(kind, index): 'q' or 's'.
export function questionNav({queue, setAside, at, aside}, drafts, go) {
  const where = el('div', 'qr-where');
  const top = el('div', 'qr-where-top');
  top.append(el('b', '', aside ? (aside.dismissed ? t('helperFlow.dismissedQuestion') : t('helperFlow.asideQuestion')) : t('helperFlow.questionPosition', {at: at + 1, count: queue.length})), progress(queue, at, aside, drafts, go));
  const current = aside || queue[at];
  const nav = Object.assign(el('button', 'qr-nav'), {type: 'button', id: 'qr-nav', title: t('helperFlow.allQuestions')});
  nav.setAttribute('aria-haspopup', 'menu');
  nav.setAttribute('aria-expanded', 'false');
  nav.append(el('span', 'qr-nav-tile', icon(KIND_TILE[current?.format?.kind] || 'help')), el('span', 'qr-nav-title', shortTitle(current?.question)),
    el('span', 'qr-nav-count', aside ? t('helperFlow.asideCount', {count: setAside.length}) : `${at + 1} / ${queue.length}`), icon('chevron'));
  nav.addEventListener('click', () => openMenu(nav, listItems({queue, setAside, at, aside}, drafts, go), {search: SEARCH_FROM, width: 'anchor'}));
  const row = el('div', 'qr-where-row');
  row.append(nav, arrow('qr-prev', t('helperFlow.previousQuestion'), 'chevron', () => go('step', -1)), arrow('qr-next', t('helperFlow.nextQuestion'), 'chevron', () => go('step', 1)));
  where.append(top, row);
  return where;
}

function arrow(id, label, glyph, run) {
  const button = Object.assign(el('button', `secondary icon-btn qr-arrow ${id}`, icon(glyph)), {type: 'button', id, title: label, ariaLabel: label});
  button.addEventListener('click', run);
  return button;
}

// One segment per question (current marked, a typed draft tinted); past SEGMENTS_UP_TO the plain bar.
function progress(queue, at, aside, drafts, go) {
  if (queue.length > SEGMENTS_UP_TO) {
    const bar = el('div', 'bar qr-bar');
    const fill = el('span', '');
    fill.style.width = `${Math.round(((aside ? 0 : at + 1) / Math.max(queue.length, 1)) * 100)}%`;
    bar.append(fill);
    return bar;
  }
  const segs = el('div', 'qr-segs');
  segs.setAttribute('role', 'group');
  segs.setAttribute('aria-label', t('helperFlow.questions'));
  queue.forEach((q, index) => {
    const here = !aside && index === at;
    const seg = Object.assign(el('button', ['qr-seg', here && 'is-current', drafts.has(q.key) && 'is-draft'].filter(Boolean).join(' ')),
      {type: 'button', title: `${index + 1} · ${shortTitle(q.question)}`, ariaLabel: t('helperFlow.questionTitle', {at: index + 1, title: shortTitle(q.question)})});
    if (here) seg.setAttribute('aria-current', 'step');
    seg.addEventListener('click', () => go('q', index));
    segs.append(seg);
  });
  return segs;
}

// The queue as list rows, then the set-aside ones under their heading.
function listItems({queue, setAside, at, aside}, drafts, go) {
  const item = (q, kind, index) => ({label: shortTitle(q.question, 80), detail: sourceOf(q), tile: KIND_TILE[q.format?.kind] || 'help',
    badge: stateOf(q, {aside: kind === 's', drafted: drafts.has(q.key)}), current: kind === 's' ? aside === q : !aside && index === at, run: () => go(kind, index)});
  const items = queue.map((q, index) => item(q, 'q', index));
  if (setAside.length) items.push({heading: t('helperFlow.asideHeading', {count: setAside.length})}, ...setAside.map((q, index) => item(q, 's', index)));
  return items;
}
