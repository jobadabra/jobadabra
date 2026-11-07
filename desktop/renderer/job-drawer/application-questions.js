// Application → Preparation: this job's questions (owner, 17 Oct 2026), from the verdicts kept per question (lib/question-verdicts.js forJob):
// asked by this job only (a motivation essay, "why us"); asked by this employer only so far ("seen twice": it becomes a standard answer when a
// second employer asks); remembered on this job (it was the second: "✓ Remembered for future forms · Undo", Undo = only this job). Nothing shown
// when the job asked none. Guarded by test/guards/rules/question-lists.test.js and test/unit/main/seen-twice.test.js.
import {t} from '../../i18n/index.js';
import {el} from '../components.js';
import {group} from './parts.js';

const NOTE = {one_job: t('helpers.askedJob'), once: t('helpers.askedOnce'), remembered: t('helpers.remembered')};

function row(item) {
  const line = el('div', 'iv-moment', item.question);
  const note = el('small', 'muted', NOTE[item.state] || '');
  line.append(note);
  // The answer kept for this job only (the review drawer's "Reuse for matching questions" off, until 28 Oct 2026): shown here, never offered on other forms.
  if (item.answer) line.append(el('small', 'job-answer', t('helpers.yourAnswer', {answer: item.answer})));
  if (item.state === 'remembered' && window.pilot?.jobQuestionOnly) {
    const undo = el('button', 'link', t('helpers.undo'));
    undo.title = t('helpers.onlyJob');
    undo.addEventListener('click', async () => {
      undo.disabled = true;
      const result = await window.pilot.jobQuestionOnly(item.question);
      if (result?.ok) note.replaceChildren(t('helpers.onlyJob'));
      else undo.disabled = false;
    });
    note.append(' · ', undo);
  }
  return line;
}

export function jobQuestionsView(job) {
  if (!job?.url || !window.pilot?.jobQuestions) return [];
  const box = group(t('helpers.jobQuestions'), []);
  box.hidden = true;
  Promise.resolve(window.pilot.jobQuestions(job.url)).then(list => {
    if (!Array.isArray(list) || !list.length) return;
    box.append(...list.map(row));
    box.hidden = false;
  }).catch(() => {});
  return [box];
}
