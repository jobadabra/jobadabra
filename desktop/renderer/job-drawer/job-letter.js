// Documents → Cover letter: the job's own cover letter, made with its tailored CV: the text (copy, edit, write again) and its PDF (open).
// Filled from the app (IPC jobLetter); an edit remakes the PDF at once. One label → value row per fact (rows in documents-rows.js). Write again shows the
// shared AI-writing state over the kept letter (ai-writing.js). Guarded by test/unit/renderer/job-letter.test.js, test/unit/renderer/job-documents.test.js and test/unit/renderer/ai-writing.test.js.
import '../../i18n/screens-helpers.js';
import {t} from '../../i18n/index.js';
import {el, pill} from '../components.js';
import {aiWriting} from '../ai-writing.js';
import {docButton, docCard, docCopy, letterPanel, rows} from './documents-rows.js';
import {plainError} from '../run-warnings.js';

const FROM = {kit: t('helpers.preparedApplication'), ai: t('helpers.writtenJob'), you: t('helpers.editedYou')};

export function jobLetterView(job) {
  const key = job.code || job.url;
  const body = el('div', 'job-letter');
  const draw = async () => {
    const status = await window.pilot.jobLetter(key).catch(() => null);
    body.replaceChildren();
    if (!status?.text) { body.append(rows([[t('helpers.status'), [pill(t('helpers.notWritten'), 'warn'), t('helpers.letterWithCv')]]])); return; }
    const text = Object.assign(el('textarea', 'letter-text'), {value: status.text, rows: 12, hidden: true});
    const shown = letterPanel(status.text);
    const message = el('span', 'muted small', '');
    const edit = docButton(t('helpers.edit'), async () => {
      if (text.hidden) { text.hidden = false; shown.hidden = true; edit.textContent = t('helpers.save'); return; }
      edit.textContent = t('helpers.makingPdf');
      const done = await window.pilot.jobLetterSave(key, text.value);
      if (done.ok) draw(); else { message.textContent = plainError(done.error); edit.textContent = t('helpers.save'); }
    });
    // Why (28 Oct 2026, owner; localized 7 Nov 2026): rewriting must mark the existing letter as being written; changing only the button label made the previous draft look current.
    const again = docButton(t('helpers.writeAgain'), async () => {
      const locked = [copy, edit, again, ...open];
      locked.forEach(button => { button.disabled = true; });
      again.setAttribute('aria-busy', 'true');
      again.textContent = t('helpers.writing');
      message.textContent = '';
      state.replaceWith(writingPill);
      const wasReadOnly = text.readOnly;
      text.readOnly = true;   // Why (28 Oct 2026, Gitar on #2388): text typed in the open editor would be thrown away when the new letter is drawn.
      let stop = () => {}, done;
      try {
        stop = aiWriting(text.hidden ? shown : text, {title: t('helpers.writingLetter'), note: t('helpers.letterKept')});
        done = await window.pilot.jobLetterAgain(key);
      } catch (error) { done = {ok: false, error: error.message}; }   // a throw before the call must still unlock the buttons (28 Oct 2026, code review)
      stop();
      text.readOnly = wasReadOnly;
      writingPill.replaceWith(state);
      again.removeAttribute('aria-busy');
      locked.forEach(button => { button.disabled = false; });
      if (done.ok) draw(); else { message.textContent = plainError(done.error); again.textContent = t('helpers.writeAgain'); }
    });
    const open = status.pdf ? [docButton(t('helpers.openPdf'), () => window.pilot.jobLetterOpen(key))] : [];
    const copy = docCopy(status.text, t('helpers.copy'), true);
    const state = pill(status.pdf ? t('helpers.ready') : t('helpers.textOnly'), status.pdf ? 'good' : 'neutral'), writingPill = pill(t('helpers.writing'), 'info');
    body.append(rows([
      [t('helpers.status'), [state, FROM[status.source] || '']],
      ...status.warnings.map(warning => [t('helpers.check'), [el('span', 'muted', warning)]]),
      [t('helpers.text'), [shown, text]],
      [t('helpers.actions'), [copy, edit, again, ...open, message]],
    ]));
  };
  draw();
  return docCard(t('helpers.coverLetter'), 'mail', 'signal', body);
}
