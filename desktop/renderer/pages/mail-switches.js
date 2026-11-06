// The person's switch for each e-mail, drawn in every place that shows one: Settings → Notifications (all rows, #mail-rows; the news mails, #news-rows) and beside an automation (`[data-mail-slot="<row>"]`: Automation's Find jobs, Apply).
// Why (owner, 5-6 Nov 2026: "from both Automations and Notifications", "Only the person"): every place draws from ONE state read from the website (lib/mail-choices.js), so two switches for a row never disagree.
// A press is one tap with no confirm; a failed save puts the switch back and says so beside it. Hidden only when the main process says so (MAIL_SWITCHES_SHOWN). Guard: test/unit/renderer/mail-switch-state.test.js.
import {$} from './core.js';
import {el} from '../components.js';
import {plainError} from '../run-warnings.js';
import {createMailState} from '../mail-switch-state.js';

const mail = createMailState(window.pilot, () => draw(), {
  extra: row => ({address: $('notify-address')?.value || '', name: row.name}),   // a press that turns e-mail on needs the address typed in Notifications, else the main process uses the saved one or the CV's
  saved: result => { if (result.addressSaved) window.dispatchEvent(new Event('notify-refresh')); },   // e-mail is on now: the Email switch and every row read the state again
});   // window.pilot is the bridge object: its methods are read at call time
// What each row says in the app, in the person's words (the website's `when` is Admin's wording: "the person's day, Mondays by default").
const WHEN = {'app-matches': 'When a search finds new jobs', 'app-needs-you': 'When an application is waiting for you', 'app-applied': 'When Full automation sends an application', 'app-weekly': 'Your week in one e-mail, on Mondays',
  'app-stopped': 'When Always on stops working', 'app-nothing': 'When days pass with no new match'};
// The mails the Mac writes in every mode (an application waits, Full automation applied): they come from the Mac even when the card's line says Always on.
const FROM_MAC = ['app-needs-you', 'app-applied'];
const sentence = text => (text ? text[0].toUpperCase() + text.slice(1) : '');

/** One switch row: a switch, the mail's name, and the one line saying when it goes out. `note`: the refused save's words (a warning line). */
export function switchRow(row, where, note = '', press = () => {}) {
  const wrap = el('div', 'mail-row');
  wrap.dataset.mailRow = row.id;
  const box = Object.assign(document.createElement('input'), {type: 'checkbox', checked: !!row.on});
  box.setAttribute('aria-label', `E-mail me: ${row.name}`);
  box.addEventListener('change', () => press(row.id, box.checked));
  const track = el('span', 'switch');
  track.append(box, el('span'));
  const words = el('span');
  const title = el('span', '', row.name);
  if (row.suggested) title.append(' ', el('span', 'ui-pill tone-info', 'Suggested'));   // e-mail is not on yet: the row is off, and this is what the mode would start with
  words.append(title, el('span', 'muted small', [WHEN[row.id] || sentence(row.when), where].filter(Boolean).join('. ').replace(/\.?$/, '.')));
  const label = el('label', 'switch-row');
  label.append(track, words);
  wrap.append(label);
  if (note) wrap.append(el('p', 'message mail-note', plainError(note)));
  return wrap;
}

// Notifications' card: every row, where they come from once under the title, and the read's own words when it failed.
function drawCard(state, shown) {
  const panel = $('setting-mail');
  if (panel) panel.hidden = !!state?.hidden || !state || (state.ok && !state.rows.length);   // a read that failed stays visible with its words; a person with no rows yet has nothing to show
  const list = $('mail-rows');
  if (!list) return;
  list.replaceChildren(...(shown ? state.rows.map(row => switchRow(row, state.mode === 'always' && FROM_MAC.includes(row.id) ? state.macWhere : '', mail.note(row.id), mail.press)) : []));   // a mail the Mac writes says so when the card says Always on
  $('mail-pitch').hidden = !shown || state.mode !== 'mac';
  $('mail-where').textContent = shown ? state.where : '';
  $('mail-message').textContent = plainError(state && !state.ok ? state.error || '' : state?.note || '');
}

// "News from Jobadabra": the site's two news mails, with the site's own words. A press is the same as a row's; hidden with the other card (MAIL_SWITCHES_SHOWN) and never drawn beside an automation.
function drawNews(state, shown) {
  const panel = $('setting-news'), list = $('news-rows');
  if (!panel || !list) return;
  const news = shown ? state.news || [] : [];
  panel.hidden = !news.length;
  list.replaceChildren(...news.map(row => switchRow(row, '', mail.note(row.id), mail.press)));
}

// The rows beside an automation (`data-mail-slot`), the Apply card's one "where" line, and the cards of slots that have none to show.
function drawSlots(state, shown) {
  for (const slot of document.querySelectorAll('[data-mail-slot]')) {
    const row = shown && state.rows.find(entry => entry.id === slot.dataset.mailSlot);
    slot.hidden = !row;
    slot.replaceChildren(...(row ? [switchRow(row, slot.closest('[data-mail-group]') ? '' : state.where, mail.note(row.id), mail.press)] : []));   // a card of several rows says where once, in its lead; a row under one automation says it itself
  }
  const applyWhere = $('apply-mail-where');
  if (applyWhere) applyWhere.textContent = shown ? state.macWhere || state.where : '';   // applying runs on the Mac in every mode
  for (const group of document.querySelectorAll('[data-mail-group]')) group.hidden = ![...group.querySelectorAll('[data-mail-slot]')].some(slot => !slot.hidden);
}

function draw() {
  const state = mail.state(), shown = !!state?.ok && !state.hidden;
  drawCard(state, shown);
  drawNews(state, shown);
  drawSlots(state, shown);
}

/** Reads the person's choices and draws them in every place. Safe to call often (Settings opening, a save in Notifications, Always on changing). */
export const showMailSwitches = () => mail.read();

/** Wires the Notifications card's "Turn on" and re-reads the choices when the notify state changes elsewhere. `openSetting`: the caller's opener (settings.js), passed in so this page never imports Settings (an import cycle through connections.js). Returns nothing. */
export function bindMailSwitches(openSetting) {
  $('mail-turn-on')?.addEventListener('click', () => openSetting('cloud'));
  window.addEventListener('notify-changed', () => showMailSwitches());   // notify-refresh reaches showNotify, which reads the rows again
}
