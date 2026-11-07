// One derived cover-letter availability decision for setup, the review queue and application delivery; existing records remain the only owners.
import fs from 'node:fs';
import {copyMessage, copyFields} from '../i18n/display-copy.js';
import * as letters from './cover-letter.js';
import * as jobLetter from './job-letter.js';
import * as cv from './cv.js';

const gapCopy = new WeakMap();
const message = (key, canonical) => copyMessage(`focusCards.${key}`, canonical);
function gap(state, reason, action, reasonKey, actionKey) {
  const status = {state, ready: false, reason, action, target: 'letter'};
  gapCopy.set(status, {reason: message(reasonKey, reason), action: message(actionKey, action)});
  return status;
}

/** Select text and PDF from one usable record. A complete tailored letter wins over the approved base fallback. */
export function availableLetter(storage, url = '', {given = false, failed = false} = {}) {
  if (given === true) return {status: {state: 'ready', ready: true, source: 'form', reason: '', action: '', target: 'letter'}, text: '', file: null};
  if (failed === true) return {status: gap('delivery-failed', 'The form did not keep the cover letter. Open its letter control and paste or attach it manually, then check again.', 'Open cover letter', 'mainLetterDeliveryFailed', 'mainLetterOpen'), text: '', file: null};
  const base = letters.status(storage), tailored = url ? cv.forUrl(storage, url) : null;
  const job = tailored ? jobLetter.load(storage, tailored.job.code) : null;
  let record = null, file = '', name = '', source = '';
  if (job?.text?.trim() && !letters.hasGap(job.text) && jobLetter.hasPdf(storage, tailored.job.code)) {
    record = job; file = jobLetter.pdfPath(storage, tailored.job.code); name = jobLetter.finalName(storage, tailored); source = 'tailored';
  } else if (
    // Why (2026-10-27, owner): approved usable base is automatic fallback; a usable tailored letter wins first.
    base.state === 'approved' && base.text.trim() && !letters.hasGap(base.text) && base.pdf) {
    record = base; file = letters.pdfPath(storage); name = 'Cover letter.pdf'; source = 'base';
  }
  if (record) {
    try {
      return {status: {state: 'ready', ready: true, source, reason: '', action: '', target: 'letter'}, text: record.text,
        file: {name, type: 'application/pdf', data: fs.readFileSync(file).toString('base64'), tailored: source === 'tailored'}};
    } catch { return {status: gap('unavailable', 'The cover-letter PDF could not be read. Review it and make the PDF again.', 'Review cover letter', 'mainLetterPdfReadFailed', 'mainLetterReview'), text: '', file: null}; }
  }
  const status = base.text && letters.hasGap(base.text) ? gap('invalid', 'The cover letter still has placeholders to complete.', 'Complete cover letter', 'mainLetterPlaceholders', 'mainLetterComplete')
    : base.state === 'draft' ? gap('draft', 'Your cover letter is a draft and needs your review and approval.', 'Review cover letter', 'mainLetterDraft', 'mainLetterReview')
    : base.state === 'approved' && !base.pdf ? gap('unavailable', 'The approved cover-letter PDF is missing. Make it again.', 'Review cover letter', 'mainLetterPdfMissing', 'mainLetterReview')
    : job?.text ? gap('unavailable', 'This job’s cover letter needs a complete text and PDF. Review its Documents tab.', 'Review cover letter', 'mainLetterTailoredIncomplete', 'mainLetterReview')
    : gap('missing', 'No usable cover letter has been created. Create and review it before applying.', 'Create cover letter', 'mainLetterMissing', 'mainLetterCreate');
  return {status, text: '', file: null};
}

/** The single derived setup action, removed automatically when an approved fallback is usable; never saved as an answer. */
export function letterQuestion(storage) {
  const {status} = availableLetter(storage);
  if (status.ready) return null;
  const fields = gapCopy.get(status);
  return copyFields({key: 'setup:cover-letter', question: 'Set up your cover letter', company: '', priority: 'HIGH PRIORITY', weight: 1e13,
    hint: status.reason, setup: copyFields({kind: 'cover-letter', ...status}, fields)}, {
    question: message('mainLetterQuestion', 'Set up your cover letter'), priority: message('mainLetterPriority', 'HIGH PRIORITY'), hint: fields.reason,
  });
}
