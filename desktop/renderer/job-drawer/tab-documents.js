// Drawer → Documents: the job's tailored CV and its cover letter, each a card of label → value rows (Status, File, Actions). They used to sit
// inside Application → Preparation (owner, 18 Oct 2026: "New 'Documents' tab"). The CV opens in its window and saves as a file; the letter is
// the job's own (job-letter.js: copy, edit, write again) or, before one is made, the kit's. Nothing drafted: the state card with the action.
import {t} from '../../i18n/index.js';
import {el, pill} from '../components.js';
import {wand} from '../magic.js';
import {stateCard} from './parts.js';
import {jobLetterView} from './job-letter.js';
import {docButton, docCard, docCopy, letterPanel, rows} from './documents-rows.js';

const tailor = (job, redraw) => async () => {
  const result = await window.pilot.tailorCv(job.code, `${job.title} · ${job.company}`, job.url).catch(error => ({ok: false, error: error.message}));
  if (result.ok) { job.tailored = true; redraw(); return null; }
  return result.error || t('helpers.tryAgainPeriod');
};

// Tailor CV + cover letter: the primary button of a card with nothing made yet, or of a failed one (the failure shows in the Status row).
function tailorButton(job, redraw, status, label = t('helpers.tailor')) {
  const run = docButton(label, async () => {
    run.disabled = true; run.textContent = t('helpers.tailoring');
    const error = await tailor(job, redraw)();
    if (error) { run.disabled = false; run.textContent = t('helpers.tryAgain'); status.replaceChildren(pill(t('helpers.failed'), 'bad'), ` ${error}`); }
  }, true);
  return wand(run);
}

function cvCard(job, files, redraw) {
  const pairs = [];
  if (!job.tailored) {
    if (!job.code) return docCard(t('helpers.tailoredCv'), 'file', 'violet', rows([[t('helpers.status'), [pill(t('helpers.notMade'), 'warn'), t('helpers.noCode')]]]));
    const status = el('dd', 'doc-value');
    status.append(pill(t('helpers.notMade'), 'warn'), t('helpers.withLetter'));
    return docCard(t('helpers.tailoredCv'), 'file', 'violet', rowsWithStatus(status, tailorButton(job, redraw, status)));
  }
  const file = files[0];
  pairs.push([t('helpers.status'), [pill(t('helpers.ready'), 'good'), t('helpers.changesHighlighted')]]);
  if (file) pairs.push([t('helpers.file'), [el('span', 'attachment-name', file.name)]]);
  const actions = [];
  if (job.code) actions.push(docButton(t('helpers.open'), () => window.pilot.openTailoredCv(job.code), true));
  if (file?.url) {
    const save = docButton(t('helpers.saveAs'), async () => { const done = await window.pilot.jobFileSave(file.name, file.url).catch(() => null); if (done?.ok) save.textContent = t('helpers.saved'); });
    actions.push(save);
  } else if (file) actions.push(el('span', 'muted small', t('helpers.largeSave')));
  pairs.push([t('helpers.actions'), actions]);
  return docCard(t('helpers.tailoredCv'), 'file', 'violet', rows(pairs));
}

// The status row and the button of a CV not made yet, in one grid: the status cell is rewritten when the tailoring fails.
function rowsWithStatus(status, action) {
  const list = rows([[t('helpers.status'), []], [t('helpers.actions'), [action]]]);
  list.querySelector('dd').replaceWith(status);
  return list;
}

// The kit's own letter, when no tailored letter exists: read-only text with Copy.
function kitLetterCard(letter) {
  return docCard(t('helpers.coverLetter'), 'mail', 'signal', rows([
    [t('helpers.status'), [pill(t('helpers.draft'), 'neutral'), t('helpers.preparedApplication')]],
    [t('helpers.text'), [letterPanel(letter)]],
    [t('helpers.actions'), [docCopy(letter, t('helpers.copy'), true)]],
  ]));
}

export function documentsTab({job, parts}, redraw) {
  const kitLetter = parts.kit?.letter || '';
  const files = parts.documents || [];
  if (!job.tailored && !kitLetter && !files.length) {
    const status = el('span');
    const run = job.code ? tailorButton(job, redraw, status) : null;
    return [stateCard({icon: 'file', title: t('helpers.notDrafted'), text: t('helpers.documentsEmpty'), actions: run ? [run] : []})];
  }
  return [cvCard(job, files, redraw), job.tailored ? jobLetterView(job) : kitLetter ? kitLetterCard(kitLetter) : docCard(t('helpers.coverLetter'), 'mail', 'signal', rows([[t('helpers.status'), [pill(t('helpers.notWritten'), 'warn'), t('helpers.letterWithCv')]]]))];
}
