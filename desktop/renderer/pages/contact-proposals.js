// "Your details from your CV" in the window: what Claude read from the CV (lib/contact-from-cv.js). A value the CV states plainly (sure) is saved at once and said in a pop-up
// (owner, 2 Nov 2026: "if we have confidence, we just fill and save… and inform the user"); the others are only offered ("Review 1 from your CV": a dialog lists each box and its
// value), and after the person's yes they fill in the open card, marked "From your CV", as drafts that the page bar's Save all changes confirms. Nothing unsure changes before the yes.
// Why (2 Nov 2026, owner: "I go to Profile, I don't modify anything and when I want to leave it asks me if I want to save or discard the changes"): only the person's own edit
// or press makes a draft; opening Profile filled the boxes itself, so leaving asked. Also the nudge after Apply when the details forms usually ask for are missing.
// Guarded by test/unit/renderer/contact-from-cv.test.js and integration/app/profile-no-draft-on-open.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {el, pill} from '../components.js';
import {message} from './core.js';
import {contactSavedAs, detailsChanged} from './details-drafts.js';
import {editDetailsCard} from './details-read.js';
import {toastMessage} from './startup.js';

const MARK = 'proposal-pill';
const box = field => document.querySelector(`#setting-contact [data-contact="${field}"]`);
const BADGE = 'cv-proposals-badge';

// The Contact card's title says what the CV holds: "4 from CV · check" for boxes already filled (the person said yes), else the one action "Review 1 from your CV" for the
// proposals still waiting (mockup 05). Never a lone line under the card.
let waiting = [];
const emptyBox = field => { const input = box(field); return Boolean(input && !input.dataset.proposed && !input.value.trim() && !hiddenByForm(input)); };
function syncBadge() {
  const title = document.querySelector('#setting-contact .card-words h3');
  const left = document.querySelectorAll('#setting-contact [data-proposed]').length;
  const offer = waiting.filter(each => emptyBox(each.field));
  title?.querySelector(`.${BADGE}`)?.remove();
  if (!title || !(left || offer.length)) return;
  if (!left) {
    const review = Object.assign(el('button', `secondary small ${BADGE}`, `Review ${offer.length} from your CV`), {type: 'button', title: t('pagesLettersData.cvEmptyGuidance')});
    review.addEventListener('click', () => askToFill(waiting.filter(each => emptyBox(each.field))));
    title.append(review);
    return;
  }
  const badge = pill(`${left} from CV · check`, 'warn');
  badge.classList.add(BADGE);
  badge.title = t('pagesLettersData.filledReviewSave');
  title.append(badge);
}

// A value the CV only hints at is the person's to agree (owner, 2 Nov 2026: "if we have low confidence… we don't do any filling before the user's agreement and happening under his eyes"):
// the dialog lists each box and the value; "Fill them in" fills them in the open card, marked, as drafts; "Not now" changes nothing.
const nameOf = field => (box(field)?.closest('label')?.firstChild?.textContent || field.replace(/_/g, ' ')).trim();
let dialog = null;
function askToFill(list) {
  if (!list.length) return;
  dialog ||= (() => {
    const node = el('dialog', 'panel-dialog');
    document.body.append(node);
    return node;
  })();
  const rows = el('ul', 'tune-list');
  for (const {field, value, sure} of list) rows.append(el('li', '', `${nameOf(field)}: ${value}${sure ? '' : ' (check it)'}`));
  const foot = el('div', 'dialog-foot');
  for (const [cls, value, label] of [['secondary', 'no', t('pagesCommon.notNow')], ['primary', 'fill', 'Fill them in']]) foot.append(Object.assign(el('button', cls, label), {value}));
  const form = el('form');
  form.method = 'dialog';
  form.append(el('h2', '', t('pagesProfile.fillThese')), el('p', 'dialog-lead', t('pagesLettersData.cvHintsOnly')), rows, foot);
  dialog.replaceChildren(form);
  dialog.returnValue = '';
  dialog.onclose = () => { if (dialog.returnValue === 'fill') showProposals(list); };
  dialog.showModal?.();
}

document.addEventListener?.('details-changed', syncBadge);   // typing in a box changes how many are still empty to offer

// Take the marks off (after Save, or before showing new proposals); an edited box keeps your value, unmarked.
const unmark = input => { delete input.dataset.proposed; input.parentElement.querySelector(`.${MARK}`)?.remove(); };
export function clearProposals() {
  document.querySelectorAll('#setting-contact [data-proposed]').forEach(unmark);
  syncBadge();
}

// A box the form hides on purpose (the Swiss-only Place of origin); a closed Profile tab is not that: its boxes are filled for when it opens.
const hiddenByForm = input => { const hidden = input.parentElement?.closest('[hidden]'); return Boolean(hidden && !hidden.matches('[data-profile-panel]')); };

// Fill each empty box the form shows with its proposal. → how many were shown.
// A box still marked from an earlier call (the tab opened again) keeps its mark: it is still unchecked.
export function showProposals(proposals = []) {
  waiting = proposals;
  const fields = new Set(proposals.map(each => each.field));
  document.querySelectorAll('#setting-contact [data-proposed]').forEach(input => { if (!fields.has(input.dataset.contact)) unmark(input); });
  let shown = 0;
  for (const {field, value, sure} of proposals) {
    const input = box(field);
    if (input?.dataset.proposed) { shown++; continue; }
    if (!input || input.value.trim() || hiddenByForm(input)) continue;
    input.value = value;
    input.dataset.proposed = 'cv';
    const mark = pill(sure ? t('pagesProfile.fromCv') : t('pagesProfile.fromCvCheck'), sure ? 'info' : 'warn');
    mark.classList.add(MARK);
    (input.nextElementSibling?.dataset?.contactControl ? input.nextElementSibling : input).after(mark);   // under the typed control when there is one
    input.addEventListener('input', () => { delete input.dataset.proposed; mark.remove(); syncBadge(); }, {once: true});
    editDetailsCard(input.closest('.setting')?.id);   // a proposal is checked in its card's editor, never hidden behind the read view
    shown++;
  }
  if (shown) {
    detailsChanged();   // the person pressed Fill or said yes: they are drafts on the Profile page's one save bar until saved
    message('contact-panel-message', '');
  }
  syncBadge();
  return shown;
}
// What the app saved from the CV on this open (lib/contact-from-cv.js settleSure: once per value, so a box the person clears later stays empty): it shows in its box, is no draft, and is said once.
function sayApplied(applied = []) {
  const done = [];
  for (const {field, value} of applied) {
    const input = box(field);
    if (!input || input.value.trim()) continue;   // typed in meanwhile: left alone
    input.value = value;
    contactSavedAs(field, value);
    done.push(`${nameOf(field)}: ${value}`);
  }
  if (done.length) toastMessage({title: t('pagesProfile.filledCv'), body: `${done.join(' · ')}. Check them in Your details.`, target: {view: 'settings', section: 'profile'}, tone: 'good'});
}
// On opening Profile: what the CV states plainly is saved and said; the rest is only offered, never put in the boxes (no draft without the person's own yes).
function offerProposals(proposals = [], applied = []) {
  sayApplied(applied);
  waiting = proposals;
  syncBadge();
  return waiting.filter(each => emptyBox(each.field)).length;
}

// On opening the panel: what was proposed for this CV (Claude reads a CV once, so this is free after the first time).
// again: "Fill from my CV" (the Profile page's ⋯ menu), which reads the CV anew and says what it found in the Contact card's own line, also when it
// found nothing or failed (#409: a press that said nothing at all).
export async function loadProposals({again = false} = {}) {
  if (again) message('contact-panel-message', t('pagesProfile.readingMissing'));
  const result = await window.pilot.contactProposals({again, settle: !again}).catch(error => ({proposals: [], error: error.message}));
  const shown = again ? showProposals(result?.proposals || []) : offerProposals(result?.proposals || [], result?.applied);   // "Fill from my CV" is the person's press: it fills; opening only offers
  if (again && !shown) {
    message('contact-panel-message', result?.error && result.error !== 'notion' ? `Couldn't read your CV: ${result.error === t('pagesMisc.noAi') ? t('pagesMisc.chooseAiFirst') : result.error}.`
      : t('pagesLettersData.cvNoDetails'), result?.error ? 'error' : '');
  }
  return shown;
}

// After Apply: forms usually ask for these; when some are empty, say so once per app run, with what the CV can fill.
const USUAL = {phone: 'phone', street: 'street', postal_code: 'postal code', location: 'town'};
let nudged = false;
export async function nudgeMissingDetails() {
  if (nudged) return;
  const [contact, result] = await Promise.all([window.pilot.contact().catch(() => null), window.pilot.contactProposals({}).catch(() => null)]);
  if (!contact || !Object.keys(contact).length) return;   // not connected, or Notion unreadable: nothing to say
  const missing = Object.keys(USUAL).filter(key => !String(contact[key] || '').trim());
  if (!missing.length) return;
  nudged = true;
  const fromCv = (result?.proposals || []).filter(item => missing.includes(item.field)).length;
  toastMessage({title: t('pagesLettersData.formsAskDetails'),
    body: `Missing: ${missing.map(key => USUAL[key]).join(', ')}.${fromCv ? ` ${fromCv} found in your CV: open your Profile, review them, fill them in and save.` : ' Add them once in your Profile.'}`,
    target: {view: 'settings', section: 'profile'}, tone: 'warn'});
}
