// "Import from LinkedIn" (Settings → Profile → CV, ⌘K, and the setup's CV step as its third way in): the dialog that says what is read, waits for the person's consent on LinkedIn's
// own page, then shows "What came in" as rows to tick. Data and rules: lib/linkedin-import*.js (IPC linkedinImport*); spec docs/superpowers/specs/2026-11-03-linkedin-profile-import-design.md.
// Nothing is added until rows are ticked and Add is pressed; a Your details line that differs is unticked. No password or key is ever on this screen. Guard: test/unit/renderer/linkedin-import-page.test.js.
import {el, liveRows, pill} from '../components.js';
import {icon} from '../icons.js';
import {plainError} from '../run-warnings.js';
import {makeMainCv} from './linkedin-import-cv.js';
import {$} from './core.js';

const SECTIONS = [['positions', 'Positions'], ['education', 'Education'], ['skills', 'Skills'], ['languages', 'Languages'], ['details', 'Your details']];
const DOMAIN_WORDS = {PROFILE: 'Profile', POSITIONS: 'Positions', EDUCATION: 'Education', SKILLS: 'Skills', LANGUAGES: 'Languages'};
const DETAIL_WORDS = {first_name: 'First name', last_name: 'Last name', location: 'Location', street: 'Street', postal_code: 'Postal code', website: 'Website'};
const CHIPS = {new: ['new', 'info'], 'new-bullets': ['new bullets', 'info'], differs: ['differs', 'warn']};
const EU_NOTE = 'For LinkedIn members in the EU, EEA and Switzerland. Elsewhere, use your LinkedIn data file.';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

let dialog = null, view = {connected: false}, review = null, onDone = () => {};
let afterCvBuilt = async () => {};   // Why (3 Nov 2026, review): app.js passes cv-build's cvSaved in; importing it here closed a cycle through activity.js and nav.js (tools/arch-check.py)
let runId = 0;   // Why (independent review, 3 Nov 2026): Escape or the backdrop closes the dialog without Cancel, and a late answer of that run must not draw into a newer dialog; a stale run is ignored

const close = () => { window.pilot.linkedinImportCancel().catch(() => {}); dialog?.close(); };
const bodyOf = () => dialog.querySelector('[data-li-body]');
const footOf = () => dialog.querySelector('[data-li-foot]');
const button = (label, className, run) => Object.assign(el('button', className, label), {type: 'button', onclick: run});

function frame() {
  dialog = el('dialog', 'save-dialog panel-dialog cv-dialog');
  dialog.id = 'li-dialog';
  const head = el('div', 'dialog-head');
  const closeButton = Object.assign(el('button', 'secondary icon-btn'), {type: 'button', title: 'Close', onclick: close});
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.append(icon('close'));
  head.append(el('span', 'dialog-icon', icon('link')), Object.assign(el('div', 'cv-head'), {}), closeButton);
  head.querySelector('.cv-head').append(Object.assign(el('h2', '', 'Import from LinkedIn'), {id: 'li-title'}), Object.assign(el('p', 'dialog-lead', ''), {id: 'li-lead'}));
  dialog.append(head, Object.assign(el('div', 'li-body'), {}), el('div', 'dialog-foot'));
  dialog.querySelector('.li-body').dataset.liBody = '';
  dialog.querySelector('.dialog-foot').dataset.liFoot = '';
  dialog.addEventListener('close', () => { runId++; window.pilot.linkedinImportCancel().catch(() => {}); dialog.remove(); dialog = null; });
  document.body.append(dialog);
}
const setHead = (title, lead) => { $('li-title').textContent = title; $('li-lead').textContent = lead; };
const setFoot = (...buttons) => footOf().replaceChildren(...buttons);

// ---------- step 1: what is read ----------
function intro() {
  const held = view.connected;
  setHead(held ? 'Update from LinkedIn' : 'Import from LinkedIn', held ? `Connected until ${new Date(view.expiresAt).toLocaleDateString()}. Update reads your profile again, with no new sign-in.`
    : 'Bring your positions, education, skills and languages from your own LinkedIn profile. You sign in on LinkedIn\'s own page and choose what comes in.');
  const read = el('ul', 'li-list');
  for (const text of ['Positions, education, skills and languages', 'Your name, location, postal code, street and website']) read.append(el('li', '', text));
  const never = el('ul', 'li-list');
  for (const text of ['Messages, connections, posts or anything else on LinkedIn', 'Your password: you type it on LinkedIn, never here']) never.append(el('li', '', text));
  bodyOf().replaceChildren(el('h3', '', 'What is read'), read, el('h3', '', 'What is never read'), never, el('p', 'small muted', EU_NOTE),
    el('p', 'small muted', 'The key LinkedIn gives stays in your Keychain for up to 60 days so Update needs no new sign-in. Disconnect deletes it.'));
  const actions = [button('Cancel', 'secondary', close), button('Use your LinkedIn data file', 'secondary', async () => {
    dialog.close();
    await window.pilot.experienceAddLinkedin?.().catch(() => null);
    onDone();
  })];
  if (held) actions.push(button('Disconnect', 'secondary', async () => { await window.pilot.linkedinImportDisconnect(); view = {connected: false}; onDone(); intro(); }));
  actions.push(button(held ? 'Update from LinkedIn' : 'Continue on LinkedIn', 'primary', () => run(held)));
  setFoot(...actions);
}

// ---------- step 2: waiting and reading ----------
function working(lines) {
  bodyOf().replaceChildren(el('ul', 'run-card-rows', ''), el('p', 'message', ''));
  bodyOf().firstChild.replaceChildren(...liveRows(lines));
  setFoot(button('Cancel', 'secondary', close));
}
const progress = {lines: [], domains: {}};
let running = false;
function onStep(step) {
  if (!dialog || !running) return;
  if (step.what === 'waiting') progress.lines = ['Waiting for you on LinkedIn: sign in and press Allow in your browser'];
  else if (step.what === 'reading') progress.lines = ['Signed in', 'Reading your profile'];
  else if (step.what === 'domain') { progress.domains[step.domain] = step.status; progress.lines = ['Signed in', ...Object.entries(progress.domains).map(([d, s]) => `${DOMAIN_WORDS[d] || d}: ${s === 'ok' ? 'read' : s === 'pending' ? 'LinkedIn is still preparing it' : 'stopped'}`)]; }
  else if (step.what === 'comparing') progress.lines = ['Read', 'Comparing with your CV'];
  working(progress.lines);
}

async function run(update) {
  progress.lines = []; progress.domains = {};
  const mine = ++runId;
  running = true;
  working(['Starting']);
  const answer = await window.pilot.linkedinImportRun({update}).catch(error => ({ok: false, error: error.message}));
  if (!dialog || mine !== runId) return;
  running = false;
  if (!answer.ok) return failed(answer.error || 'LinkedIn did not answer. Try again.', answer.stopped);
  review = answer.review;
  sheet(answer);
}
function failed(text, stopped) {
  setHead('Not imported', 'Nothing was added.');
  bodyOf().replaceChildren(el('p', 'message bad', text), el('p', 'small muted', EU_NOTE));
  // After LinkedIn asked us to slow down (rate) or changed its API (version) there is no Try again: asking again at once is a retry of a 429, which we never do.
  setFoot(...(['rate', 'version'].includes(stopped) ? [button('Close', 'secondary', close)] : [button('Close', 'secondary', close), button('Try again', 'primary', () => run(false))]));
}

// ---------- step 3: what came in ----------
function row(item) {
  const box = Object.assign(document.createElement('input'), {type: 'checkbox', checked: !!item.ticked});
  box.dataset.id = item.id;
  const words = el('span', 'li-row-text');
  if (item.kind === 'detail') {
    words.append(el('b', '', DETAIL_WORDS[item.field] || item.field));
    if (item.chip === 'differs') {
      const two = el('span', 'li-two');
      two.append(el('span', '', `Yours: ${item.current}`), el('span', '', `LinkedIn: ${item.linkedin}`));
      words.append(two);
    } else words.append(el('span', 'muted small', item.linkedin));
  } else {
    words.append(el('b', '', item.label));
    const sub = item.chip === 'new-bullets' ? plural(item.newBullets, 'new bullet') + ' beside your CV\'s' : item.sub;
    if (sub) words.append(el('span', 'muted small', sub));
  }
  const [text, tone] = CHIPS[item.chip] || ['new', 'info'];
  const label = el('label', 'li-row');
  label.append(box, words, pill(item.chip === 'differs' ? 'differs, unticked' : text, tone));
  return label;
}
function sheet(answer) {
  setHead('What came in from LinkedIn', 'Tick what to add. Nothing changes until you press Add; your CV is not edited.');
  const body = bodyOf();
  body.replaceChildren();
  const have = review.have || {};
  for (const [key, title] of SECTIONS) {
    const rows = review[key] || [];
    if (!rows.length) continue;
    const group = el('section', 'li-group');
    group.append(el('h3', '', `${title} · ${rows.length}`));
    for (const item of rows) group.append(row(item));
    body.append(group);
  }
  const already = [have.skills ? plural(have.skills, 'skill') : '', have.languages ? plural(have.languages, 'language') : '', have.education ? plural(have.education, 'school') : ''].filter(Boolean);
  if (already.length) body.append(el('p', 'small muted', `You already have: ${already.join(', ')}.`));
  if (Object.values(answer.status || {}).includes('pending')) body.append(el('p', 'small muted', 'LinkedIn is still preparing a list. Press Update in a few minutes to bring it in.'));
  if (!body.querySelector('.li-group')) body.append(el('p', 'muted', 'Everything on your LinkedIn profile is already in your CV and Your details.'));
  body.append(el('p', 'message', ''));
  const add = button('Add', 'primary', apply);
  const count = () => { const n = body.querySelectorAll('input:checked').length; add.textContent = n ? `Add ${n} selected` : 'Add'; add.disabled = !n; };
  body.addEventListener('change', count); count();
  setFoot(button('Cancel', 'secondary', close), add);
}
async function apply(event) {
  const ids = [...bodyOf().querySelectorAll('input:checked')].map(box => box.dataset.id);
  event.target.disabled = true;
  const answer = await window.pilot.linkedinImportApply(ids).catch(error => ({ok: false, error: error.message}));
  if (!answer.ok) { event.target.disabled = false; const note = bodyOf().querySelector('.message'); note.textContent = plainError(answer.error); note.className = 'message bad'; return; }
  setHead('Added from LinkedIn', answer.mainless ? 'Making your CV from LinkedIn.' : `${plural(answer.added, 'row')} added. Your CV file is untouched.`);
  const parts = [answer.positions ? plural(answer.positions, 'position') : '', answer.details ? plural(answer.details, 'detail line') : ''].filter(Boolean);
  if (answer.mainless) return buildMainCv(answer);
  bodyOf().replaceChildren(el('p', '', parts.length ? `Added to your Experience${answer.details ? ' and Your details' : ''}: ${parts.join(', ')}. Tailoring and form filling use it from now on.` : 'Added to your Experience. Tailoring and form filling use it from now on.'));
  setFoot(button('Done', 'primary', () => { dialog.close(); onDone(); }));
}

/**
 * With no main CV the ticked rows become it (D3, owner 3 Nov 2026): the CV is drawn and saved as the main CV by the same IPC as "Build one with AI" (buildCvSave), then the setup's CV
 * step and the Profile card follow (afterCvBuilt = cv-build's cvSaved). Nothing ticked as a position means no CV is made (said, not guessed). The dialog may have been closed or reopened
 * while the CV was drawn: the CV is saved either way, but nothing is drawn into a dialog that is not the one that asked.
 */
async function buildMainCv(answer) {
  const details = answer.details ? `${plural(answer.details, 'detail line')} added to Your details. ` : '';
  const done = (text, className = '') => { bodyOf().replaceChildren(el('p', className, `${details}${text}`)); setFoot(button('Done', 'primary', () => { dialog.close(); onDone(); })); };
  if (!answer.cv?.jobs?.length) return done('No position was ticked, so no CV was made. Start the LinkedIn import again to choose positions.');
  const mine = runId, shown = dialog;
  bodyOf().replaceChildren(el('p', 'muted', 'Making your CV…'));
  setFoot();
  const made = await makeMainCv(answer.cv, {save: cv => window.pilot.buildCvSave(cv), saved: name => afterCvBuilt(name)});
  if (!dialog || dialog !== shown || mine !== runId) return;
  if (made.kind === 'failed') return done(`Your CV could not be made: ${plainError(made.error)} Nothing is lost: start the LinkedIn import again to try once more.`, 'message bad');
  setHead('Your CV is ready', 'Built from your LinkedIn profile.');
  return done(`${made.name} is now your CV. Its wording is yours to change in Settings → Profile → CV.`);
}

/** Open the dialog (from Profile or ⌘K). `done` runs after something was added or the connection changed, so the page redraws. */
export async function openImport(done = () => {}) {
  onDone = done;
  view = await window.pilot.linkedinImportState().catch(() => ({connected: false}));
  if (dialog) dialog.remove();
  frame();
  intro();
  dialog.showModal();
}

/** Wires the Profile card's "Import from LinkedIn" button to the dialog; `onChange` runs after a save so the page redraws; `onCvBuilt(name)` runs after the CV was built from LinkedIn. Does nothing when the button is absent. */
export function init({onChange = () => {}, onCvBuilt = async () => {}} = {}) {
  afterCvBuilt = onCvBuilt;
  for (const id of ['cv-import-linkedin', 'cv-linkedin']) $(id)?.addEventListener('click', () => openImport(onChange));   // Profile → Your CV, and the setup's CV step (the third way in)
  window.pilot.onLinkedinImportStep?.(onStep);
  refreshButton();
}
/** The Profile button says Update once a key is held. */
export async function refreshButton() {
  const button = $('cv-import-linkedin');
  if (!button) return;
  const state = await window.pilot.linkedinImportState().catch(() => ({connected: false}));
  button.querySelector('span').textContent = state.connected ? 'Update from LinkedIn' : 'Import from LinkedIn';
  button.title = EU_NOTE;
  const way = $('cv-linkedin');   // the setup's CV step keeps its own short label
  if (way) way.title = EU_NOTE;
}
