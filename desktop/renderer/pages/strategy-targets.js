// Strategy page, the target cards: Locations and the Advanced ones (skills, exclusions, more search settings), their lists (chips,
// the remote choice, the digest minimum) as read and in their editor, and renderStrategy. One card's editor at a time, drafts kept per card, one page bar
// (strategy-cards.js); the Main goals card is main-goals.js. Guarded by: test/unit/renderer/strategy-cards.test.js, save-progress, strategy-chips, locations-card tests.
import {number as displayNumber} from '../../i18n/format.js';
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {withSaveProgress} from '../save-progress.js';
import {el, pill, tile} from '../components.js';
import {readRows} from '../card-shell.js';
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {openView} from './nav.js';
import {setFilters} from './jobs-filter-menu.js';
import {searchLevel} from '../goal-kinds.js';
import {toastMessage} from './startup.js';
import {offered, shownLists} from '../key-sources.js';
import {titleCase} from './strategy-review.js';
import {showSearchChanged, wireSearchChanged} from '../search-changed.js';
import {showProfileEmpty} from '../profile-empty.js';
import {exclusionGroups, withTyped} from '../strategy-parts.js';
import {inDraft, sink} from '../strategy-sink.js';
import {strategyState} from './strategy-state.js';
import {PLAIN, cardHeader, changed, dirty, drafts, isOpen, cardOf, openCard, redrawCards} from './strategy-cards.js';
import {renderMainGoals} from './main-goals.js';
import {redrawPreferences} from './job-preferences.js';
import {coverageLine, relocationChoice} from './locations-card.js';
import {coverage, relocationNow, relocationWords, remoteWords} from '../locations-model.js';
import {loadStrategy} from './strategy.js';
import {drawImprove, refreshAction} from './strategy-suggestions.js';
import {drawOutdated} from './strategy-rescore.js';
import {chipsOf, folded, loadMeanings, meaningLabels, typoHints} from './strategy-chips.js';
const SEARCHED = 5;   // lib/target-roles.js: the titles also typed into job boards
import {GROUPS, asWholeWord, matchGroups, placeLabel, shownGroups, shownWord} from '../match-groups.js';

// ---------- The setup review's cards, with your live settings (owner, 7 Oct 2026). Lists: Edit → the page bar's Save (lib/strategy.js editLists, to
// ⚙️ Search settings). [card, icon, title, its lists: [list, label or note, what the add field asks]]. Target roles moved to Main goals (owner, 18 Oct
// 2026, mockup 03); every other list still edits here: Locations beside Job preferences, the rest folded under Advanced search settings.
export const CARD_TONE = {roles: 'violet', places: 'teal', stack: 'info', languages: 'warn', search: 'neutral'};   // the colours of each kind's suggestions
export const TARGET_CARDS = [
  ['places', 'pin', t('pagesStrategy.locations'), [['places', t('pagesCommon.preferredPlaces'), t('pagesFinalLabels.addCity')], ['country', t('pagesCommon.acceptablePlaces'), t('pagesFinalLabels.addCountry')],
    ['abroad', t('pagesStrategyMore.relocatePlaces'), t('pagesFinalLabels.addCityAbroad')], ['rights', t('pagesFinalLabels.rightsHelp'), t('pagesFinalLabels.addCountryEu')]]],
  ['stack', 'layers', t('pagesStrategy.skillsExperience'), [['stack', t('pagesAuditThird.a214'), t('pagesFinalLabels.addSkill')]]],
  ['languages', 'shield', t('pagesStrategy.exclusions'), [['languages', t('pagesStrategyMore.languageExclusions'), t('pagesFinalLabels.addLanguage')]]],
  // What only the ⚙️ Search settings page had (P8, 9 Oct 2026), so every store edits it here (lib/strategy-edit.js), with the level and the digest's minimum.
  ['search', 'search', t('pagesStrategy.moreSearch'), [['titleSkip', t('pagesFinalLabels.skipTitles'), t('pagesFinalLabels.addWord')], ['skip', t('pagesFinalLabels.skipCompanies'), t('pagesFinalLabels.addCompany')], ['remoteSkip', t('pagesFinalLabels.remoteSkip'), t('pagesFinalLabels.addRegion')],
    ['finders', t('pagesFinalLabels.finders'), t('pagesFinalLabels.addWord')], ['gqueries', t('pagesFinalLabels.googleSearches'), t('pagesFinalLabels.addSearch')],
    ['gplaces', t('pagesFinalLabels.googlePlacesHelp'), t('pagesAuditThird.a215')]]],
];
export const TARGET_LISTS = ['roles', ...TARGET_CARDS.flatMap(([, , , lists]) => lists.map(([name]) => name))];
export {shownLists};
// Advanced search settings: one column of full-width cards (owner, 25 Oct 2026: "2 columns with very different heights, let's better have 1 column, and
// full rows cards"; they hold lists that grow with the user's data, so each is .is-wide in the shared .card-grid).
export const ADVANCED = ['stack', 'languages', 'search'];
export const inColumns = cards => ADVANCED.map(key => cards.find(card => card.dataset.list === key || card.dataset.card === key)).filter(Boolean)
  .map(card => { card.classList.add('is-wide'); return card; });
// A list's entries as stored ({fragment, label}): the match lists come as both, the plain ones (search phrases, languages) as written.
export const entriesOf = (data, name) => data?.lists?.[name] || (data?.texts?.[name] || []).map(text => ({fragment: text, label: text}));
// One list as it will be after Save: the stored entries not removed, then the words added.
export function editedList(entries, edit = {add: [], remove: []}) {
  const gone = new Set(edit.remove);
  return [...entries.filter(entry => !gone.has(entry.fragment)).map(entry => ({...entry, added: false})),
    ...edit.add.map(word => ({fragment: '', label: word, added: true}))];
}
const AS_TYPED = new Set(['skip', 'gplaces']);   // shown as typed too: a company's own spelling, a place's language code ("de", not "De")
// A list's chips: in its card's open editor with × and an add field (Enter adds a chip, never saves), else as stored.
export function listChips(name, placeholder) {
  const editing = isOpen(cardOf(name)), edit = editing ? (drafts().targetEdits[name] ||= {add: [], remove: []}) : null, typed = drafts().typed;
  const stored = entriesOf(strategyState.lastStrategy, name);
  const box = el('div', 'chips');
  const entries = editing ? editedList(stored, edit) : stored;
  // Target roles: one list, the first five titles are also what job boards are searched for (src/target_roles.py SEARCHED), marked with a magnifier.
  const searched = name === 'roles' ? new Set(entries.slice(0, SEARCHED)) : new Set();
  const pillOf = entry => {
    const pill = el('span', `chip${editing ? ' removable' : ''}${entry.added ? ' is-added' : ''}${searched.has(entry) ? ' is-searched' : ''}`);
    if (searched.has(entry)) { pill.title = t('pagesStrategyMore.searchedBoards'); pill.append(icon('search')); }
    pill.append(el('span', '', name === 'gplaces' ? placeLabel(entry.label) : AS_TYPED.has(name) ? entry.label : titleCase(shownWord(entry.label))));
    if (editing) {
      const remove = Object.assign(document.createElement('button'), {type: 'button', className: 'x', textContent: '×', title: t('pagesShortSettings.m361', {"shownWord": shownWord(entry.label)})});
      remove.setAttribute('aria-label', t('pagesShortSettings.m362', {"shownWord": shownWord(entry.label)}));
      remove.addEventListener('click', () => {
        if (entry.added) edit.add = edit.add.filter(word => word !== entry.label); else edit.remove.push(entry.fragment);
        redrawCards();
      });
      pill.append(remove);
    }
    return pill;
  };
  // A match list holding both kinds: its whole-word entries under their own name (match-groups.js), never shown with quotes.
  const groups = PLAIN.has(name) ? null : matchGroups(entries);
  if (groups?.anywhere.length && groups.whole.length) {
    for (const [key, title] of GROUPS) box.append(el('span', 'muted small', title), ...groups[key].map(pillOf));
  } else box.append(...entries.map(pillOf));
  if (!entries.length && !editing) box.append(el('span', 'muted small', t('pagesCommon.none')));
  if (editing) {
    const input = Object.assign(document.createElement('input'), {className: 'add', placeholder: t('pagesDynamicStrategy.m419', {"placeholder": placeholder}), value: typed[name] || ''});
    input.dataset.list = name;
    input.addEventListener('input', () => { typed[name] = input.value; changed(); });
    // A match word can be added as the whole word only (stored \bword\b by lib/strategy-edit.js cleanEdits), never by typing quotes.
    const whole = PLAIN.has(name) ? null : Object.assign(document.createElement('input'), {type: 'checkbox', checked: !!wholeWords[name]});
    whole?.addEventListener('change', () => { wholeWords[name] = whole.checked; });
    input.addEventListener('keydown', event => {
      const text = input.value.trim(), plain = PLAIN.has(name) ? text : text.toLowerCase(), word = whole?.checked ? asWholeWord(plain) : plain;
      if (event.key !== 'Enter' || !plain) return;
      const same = entry => shownWord(entry.label).toLowerCase() === plain.toLowerCase();
      const back = stored.find(entry => edit.remove.includes(entry.fragment) && same(entry));
      if (back) edit.remove = edit.remove.filter(fragment => fragment !== back.fragment);   // removed, then typed again: kept
      else if (!edit.add.some(added => shownWord(added).toLowerCase() === plain.toLowerCase()) && !stored.some(same)) edit.add.push(word);
      event.preventDefault();   // Enter adds a chip; it never saves the strategy
      delete typed[name];
      redrawCards();
      document.querySelector(`.strategy-live input.add[data-list="${name}"]`)?.focus();
    });
    box.append(input);
    if (whole) { const label = el('label', 'check-row muted small'); label.append(whole, el('span', '', t('pagesStrategyMore.wholeWord'))); box.append(label); }   // the shared checkbox row
  }
  return box;
}
const wholeWords = {};   // the "Whole word only" box per list while editing
// Remote jobs (Search settings "Remote jobs"): a place of its own, or only jobs in your places.
function remoteChoice() {
  const now = strategyState.lastStrategy?.remote_jobs !== false, draft = drafts().targetEdits.remote, chosen = draft ? draft.set === 'Yes' : now;
  if (!isOpen('places')) return el('span', '', remoteWords(chosen, labelsOf('country').slice(0, 1).map(titleCase)));
  const group = el('div', 'segmented');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', t('pagesCommon.remoteWork'));
  for (const [label, yes] of [['Yes', true], ['No', false]]) {
    const button = el('button', yes === chosen ? 'is-active' : '', yes ? t('pagesCommon.yes') : t('pagesStatus.no'));
    button.type = 'button';
    button.setAttribute('aria-pressed', String(yes === chosen));
    button.addEventListener('click', () => {
      if (yes === now) delete drafts().targetEdits.remote; else drafts().targetEdits.remote = {set: label};
      renderTargets();
    });
    group.append(button);
  }
  return group;
}
// Your level (Search settings "Your level"): postings whose title plainly names another level are skipped; Any keeps them all. Its one home is Goals → Target
// level (owner, 18 Oct 2026: "Goals only"; lib/goal-level.js writes it): shown here read-only, in both modes, with "Change in Goals" (opens Main goals' editor).
const LEVELS = [['', t('pagesCommon.any')], ['junior', t('pagesFinalLabels.junior')], ['mid', t('pagesFinalLabels.mid')], ['senior', t('pagesFinalLabels.senior')], ['lead', t('pagesFinalLabels.lead')]];
function levelChoice() {
  const goal = strategyState.lastStrategy?.goals?.seniority, now = goal ? searchLevel(goal) : strategyState.lastStrategy?.level || '', line = el('span', '');
  const change = Object.assign(el('button', 'link', t('pagesStrategyMore.changeGoals')), {type: 'button', title: t('pagesStrategyMore.followsLevel')});
  change.addEventListener('click', () => {
    openCard('goals');
    document.querySelector('#strategy-main-goals .card')?.scrollIntoView({block: 'start'});
  });
  line.append(el('span', '', LEVELS.find(([value]) => value === now)?.[1] || t('pagesCommon.any')), el('span', 'muted small', t('pagesAuditThird.a216')), change);
  return line;
}
// The digest's minimum fit score (Search settings "Minimum fit score for the digest"; the engine's default is 50).
function minScoreInput() {
  const now = strategyState.lastStrategy?.digest_min_score ?? 50, shown = drafts().targetEdits.minScore?.set ?? now;
  if (!isOpen('search')) return el('span', '', t('pagesDynamicStrategy.m421', {"shown": shown}));
  const input = Object.assign(document.createElement('input'), {type: 'number', min: 0, max: 100, step: 1, className: 'add', value: shown});
  input.setAttribute('aria-label', t('pagesStrategyMore.minimumScore'));
  input.addEventListener('change', () => {
    const value = Math.round(Number(input.value));
    if (!Number.isFinite(value) || value < 0 || value > 100 || value === now) delete drafts().targetEdits.minScore;
    else drafts().targetEdits.minScore = {set: value};
    changed();
  });
  return input;
}
const LEADS = {places: t('pagesAuditThird.a217'), stack: t('pagesAuditThird.a214'),
  languages: t('pagesAuditThird.a218')};
function targetCard([key, glyph, title, lists]) {
  const open = isOpen(key), card = el('section', `card${open ? ' is-editing' : ''}`);
  card.dataset.list = key;
  card.dataset.card = key;
  card.append(cardHeader(key, glyph, CARD_TONE[key] || 'neutral', title, LEADS[key] || '', card));
  if (key === 'places') card.append(...[coverageLine(reloadTargets)].filter(Boolean));   // visible in both modes, Advanced or not
  if (!open) { const read = el('div', 'card-read'); read.append(...VIEWS[key]()); card.append(read); return card; }
  for (const [name, label, placeholder] of shownLists(lists)) {
    // Relocation is a value (Yes / No / Not specified); its places are asked only for Yes, and kept whatever the mode.
    if (name === 'abroad') { card.append(el('p', 'sub', t('pagesCommon.relocation')), relocationChoice(renderTargets)); if (relocationNow(strategyState.lastStrategy, drafts().targetEdits) !== 'yes') continue; }
    const box = listChips(name, placeholder);
    if (name === 'places') { const priority = el('div', 'priority'); priority.append(el('b', '', label), box); card.append(priority); continue; }
    if (label) card.append(el('p', 'sub', label));
    card.append(box);
  }
  if (key === 'places') card.append(el('p', 'sub', t('pagesCommon.remoteWork')), remoteChoice());
  if (key === 'search') card.append(el('p', 'sub', t('pagesStrategyMore.yourLevel')), levelChoice(), el('p', 'sub', t('pagesStrategyMore.minimumScore')), minScoreInput());
  return card;
}
// ---------- The cards as read (not editing): grouped and short; Edit shows every list in full as before ----------
// A row's label with its one-line fact joined to it, in the muted label style (owner's rule, 18 Oct 2026: never a lone line above or below a chip row).
const labelWith = (label, hint) => { const words = el('span', '', label); words.append(el('span', 'muted small', ` · ${hint}`)); return words; };
const savedLabels = name => entriesOf(strategyState.lastStrategy, name).map(entry => entry.label);
// A list as read: as saved, or, while its card holds a draft, as Save will write it (words still typed included), so a closed card's summary shows it.
export function draftEntries(name) {
  const stored = entriesOf(strategyState.lastStrategy, name);
  if (!dirty().has(name)) return stored;
  const edit = withTyped(drafts().targetEdits, drafts().typed, PLAIN, list => entriesOf(strategyState.lastStrategy, list))[name];
  return edit ? editedList(stored, edit) : stored;
}
const labelsOf = name => draftEntries(name).map(entry => entry.label);
// As read: one chip per meaning (strategy-chips.js), whole-word entries apart when a list mixes both kinds, "Did you mean …?" lines under the chips.
// A list with a draft draws its draft words plainly: meanings and typo hints belong to what is saved.
const shownOf = name => meaningLabels(name, savedLabels(name));
function withHints(name, draw) {
  if (dirty().has(name)) return draw(labelsOf(name));
  const parts = shownGroups(entriesOf(strategyState.lastStrategy, name), shownOf(name));
  const hints = typoHints(name, {fix: (entry, suggestion, button) => fixTypo(name, entry, suggestion, button), keep: keepTypo});
  if (parts.length === 1 && !hints.length) return draw(parts[0].labels);
  const box = el('div', 'setting-body');   // the row's own grid: groups and lines sit under each other at its gap
  for (const part of parts) box.append(...(part.title ? [el('span', 'muted small', part.title)] : []), draw(part.labels));
  box.append(...hints);
  return box;
}
// Fix: the misspelt entry out, the suggestion in, saved like an edit (lib/strategy.js editLists). Keep: never flagged again.
async function fixTypo(name, entry, suggestion, button) {
  const stored = entriesOf(strategyState.lastStrategy, name).find(item => item.label === entry);
  const edits = {[name]: {add: [suggestion], remove: stored ? [stored.fragment] : []}};
  const result = await withSaveProgress(words => { button.textContent = words; }, () => sink.editTargets(edits)).catch(error => ({ok: false, error: error.message}));
  if (!result.ok) { toastMessage(t('pagesStrategyMore.notFixed'), result.error || t('pagesCommon.tryAgain'), {card: 'strategy-advanced'}, 'bad'); renderTargets(); return; }
  toastMessage({title: t('pagesShortSettings.m365', {"suggestion": suggestion}), body: t('pagesAuditThird.a219'), action: refreshAction, target: {card: 'strategy-advanced'}, tone: 'good'});
  await reloadTargets();
}
async function keepTypo(entry) {
  strategyState.keptTypos = [...(strategyState.keptTypos || []), entry];
  renderTargets();
  await window.pilot.keepTypo(entry).catch(() => null);
}
const VIEWS = {
  // Roomy (mockup 03): one row per setting, icon · label on its own line over the value (a list's chips or one value) (owner, 18 Oct 2026: "Either
  // we're fully inline, either we're fully on the new line"); every divider full width.
  places() {
    const places = labelsOf('places'), regions = labelsOf('country'), rights = labelsOf('rights'), abroad = draftEntries('abroad');
    const mode = relocationNow(strategyState.lastStrategy, drafts().targetEdits);
    const none = words => el('span', 'muted', words);
    // The goal "Work mode" (what you accept) and Remote work (where remote jobs are searched) read as a contradiction side by side (owner, 7 Oct 2026):
    // said on the row's hover, never as a footnote under the card (owner, 18 Oct 2026: no floating footnotes).
    const remote = remoteChoice();
    remote.title = t('pagesStrategyMore.modeHelp');
    const preferred = places.length ? withHints('places', chipsOf) : none(t('pagesCommon.none'));
    preferred.title = t('pagesStrategyMore.rankedFirst');
    return [readRows([{icon: 'pin', label: t('pagesCommon.preferredPlaces'), value: preferred},
      {icon: 'globe', label: t('pagesCommon.acceptablePlaces'), value: regions.length ? withHints('country', labels => folded(labels, 10, t('pagesCommon.showAll'))) : none(t('pagesFinalLabels.noneSelected'))},
      mode === 'yes' && abroad.length ? {icon: 'send', label: t('pagesStrategyMore.relocatePlaces'), value: folded(abroad.map(entry => entry.label), 10, t('pagesCommon.showAll'))}
        : {icon: 'send', label: t('pagesCommon.relocation'), value: relocationWords(mode, abroad)},
      {icon: 'building', label: t('pagesCommon.remoteWork'), value: remote},
      {icon: 'shield', label: t('pagesStrategyMore.workRights'), value: rights.length ? withHints('rights', chipsOf) : pill(t('pagesCommon.notSet'), 'warn', {title: t('pagesStrategyMore.visaFlag')})}],
    {lined: true})];
  },
  stack() {
    const stack = labelsOf('stack');
    return [readRows([{icon: 'layers', label: t('pagesStrategyMore.keySkills'), value: stack.length ? withHints('stack', labels => folded(labels, 10, t('pagesCommon.showAll'))) : el('span', 'muted', t('pagesCommon.none'))}], {lined: true})];
  },
  search() {
    const row = (glyph, label, name, none) => {
      const draw = labels => (AS_TYPED.has(name) ? chipsOf(labels, false) : folded(labels, 6, t('pagesCommon.showAll')));
      const value = !labelsOf(name).length ? el('span', 'muted', none) : name === 'gplaces' ? draw(labelsOf(name).map(placeLabel)) : withHints(name, draw);
      return {icon: glyph, label, value};
    };
    return [readRows([{icon: 'user', label: t('pagesStrategyMore.yourLevel'), value: levelChoice()}, {icon: 'target', label: t('pagesStrategyMore.minimumScore'), value: minScoreInput()},
      row('close', t('pagesFinalLabels.skipTitles'), 'titleSkip', t('pagesCommon.none')), row('building', t('pagesFinalLabels.skipCompanies'), 'skip', t('pagesCommon.none')), row('globe', t('pagesFinalLabels.remoteSkip'), 'remoteSkip', t('pagesCommon.none')),
      row('sparkle', t('pagesFinalLabels.finders'), 'finders', t('pagesCommon.none')),
      ...(offered('serpapi') ? [row('search', t('pagesFinalLabels.googleSearches'), 'gqueries', t('pagesFinalLabels.noGoogle')), row('pin', t('pagesFinalLabels.googlePlaces'), 'gplaces', t('pagesCommon.none'))] : [])], {lined: true})];
  },
  languages() {
    const data = strategyState.lastStrategy, {languages, hide, lower} = exclusionGroups({...data, texts: {...data?.texts, languages: labelsOf('languages')}});
    const block = el('div', 'setting-body');
    block.append(languages.length ? chipsOf(languages) : el('span', 'muted', t('pagesCommon.none')));
    // Warning colour only for a consequence: the last coverage check counted matching jobs these languages hid (src/coverage.py).
    const listed = new Set(languages.map(language => language.toLowerCase()));
    const hidden = (strategyState.shownVerdict?.languages || []).filter(item => listed.has(String(item.language).toLowerCase())).reduce((sum, item) => sum + (item.count || 0), 0);
    if (hidden) {
      const warn = el('p', 'tone-warn exclusion-warn', icon('alert'));
      warn.append(t('pagesDynamicStrategy.m422', {"displayNumber": displayNumber(hidden), count: hidden}));
      block.append(warn);
    }
    const group = (title, items) => [el('span', 'muted small', title), items.length ? chipsOf(items.map(item => item.label), false) : el('span', 'muted small', t('pagesCommon.none'))];
    const rules = el('div', 'setting-body');
    rules.append(...group(t('pagesFinalLabels.hideMatching'), hide), ...group(t('pagesFinalLabels.rankLower'), lower));
    return [readRows([{icon: 'globe', label: t('pagesStrategyMore.languageExclusions'), value: block},
      {icon: 'sliders', label: labelWith(t('pagesFinalLabels.otherRules'), t('pagesDynamicStrategy.m423', {"length": hide.length, "length2": lower.length, count: lower.length})), value: rules}], {lined: true})];
  },
};
const reloadTargets = async () => { await loadStrategy(); renderTargets(); };
// Locations beside Job preferences; the rest folded under Advanced search settings (index.html), opened when one of its cards is edited (openCard).
export function renderTargets() {
  shared.coverageActive = coverage(strategyState.lastStrategy).active;   // ⌘K lists "Reset search coverage" only while it is on
  const cards = TARGET_CARDS.map(targetCard);
  $('strategy-locations').replaceChildren(...cards.filter(card => card.dataset.card === 'places'));
  $('strategy-targets').replaceChildren(...inColumns(cards.filter(card => ADVANCED.includes(card.dataset.card))));
  changed();
  if (!strategyState.editing && strategyState.lastStrategy && !inDraft()) loadMeanings(savedLabels, renderTargets);   // once per set of lists; redraws when they come
}
// Main goals, the target cards and Job preferences, from the drafts (strategy-cards.js redraws through this).
export function renderCards() {
  renderMainGoals();
  renderTargets();
  redrawPreferences();
}

export function renderStrategy(data) {
  strategyState.strategyShown = true;
  strategyState.lastStrategy = data;
  showProfileEmpty(!!data.profile_empty);   // Strategy's notice and Jobs' copy (profile-empty.js)
  wireSearchChanged();
  showSearchChanged(shared.state?.settings);   // scores are paused until it is filled (src/ai/score.py unfilled)
  drawOutdated(data.outdated, loadStrategy);   // "N jobs were scored using previous search settings", from the saved settings, never the draft
  if (strategyState.editing) { renderCards(); drawImprove(); return; }   // a fresh read while editing keeps the edits on screen
  $('strategy-insight').classList.remove('is-loading');
  renderCards();
  const level = value => (value >= 70 ? 'good' : value >= 50 ? 'warn' : 'bad');
  // Averages of what the matches scored, not the weights of the score (owner, 7 Oct 2026: "How matches are scored" read as weights).
  $('strategy-score-note').textContent = !data.scored ? t('pagesStrategyMore.noScores')
    : t('pagesDynamicStrategy.m424', {"scored": data.scored, count: data.scored});
  drawImprove();
  $('strategy-scores').replaceChildren(...data.components.map(part => {
    const line = el('div', 'score-bar');
    const track = el('span', 'score-track');
    const fill = el('span', 'score-fill');
    fill.style.width = `${part.value}%`;
    track.append(fill);
    line.append(el('span', 'score-name', part.label), track, el('span', `score-level tone-${level(part.value)}`, `${part.value} / 100`));
    return line;
  }));
  const glance = (glyph, count, text, go, tone = 'neutral') => {
    const button = Object.assign(document.createElement('button'), {type: 'button', className: 'glance-row'});
    button.append(tile(glyph, tone), el('b', '', String(count)), el('span', 'muted', text), el('span', 'glance-arrow', '›'));
    button.addEventListener('click', go);
    return button;
  };
  const jobsBy = kind => () => { openView('jobs'); if (kind) document.querySelector(`[data-stat="${kind}"]`)?.click(); };
  $('strategy-glance').replaceChildren(glance('file', data.counts.matches, t('pagesAuditThird.a220'), jobsBy('total'), 'info'),
    glance('layers', data.counts.saved, t('pagesAuditThird.a221'), () => { openView('jobs'); setFilters(['saved']); }, 'violet'), glance('send', data.counts.sent, t('pagesAuditThird.a222'), jobsBy('applied'), 'signal'));
  show($('strategy-insight'), !!data.insight);
  if (data.insight) {
    $('strategy-insight-text').textContent = data.insight.action || data.insight.headline;
    $('strategy-insight-open').onclick = () => window.pilot.openExternal(data.insight.url);
  }
}
