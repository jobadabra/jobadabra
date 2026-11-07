// Application → Submitted: what was actually sent, from the application's frozen record (renderer/job-page-view.js submittedOf): when it was
// recorded and how the answers were captured, the answers and cover letter as sent (an edit from the draft is marked), the CV version and the
// files. It never changes when the kit or CV are edited afterwards. No record: "Not submitted yet", or, for a job marked applied, "No
// application snapshot captured". Opening the employer's page is not proof of submission: only a recorded submission shows here.
import '../../i18n/screens-helpers.js';
import {t} from '../../i18n/index.js';
import {el} from '../components.js';
import {copyButton, factGrid, group, stateCard} from './parts.js';
import {documentsView} from './documents-files.js';

export function submittedView({parts, page}) {
  const sent = parts.submitted;
  if (!sent) {
    return [page?.app?.applied_on
      ? stateCard({icon: 'info', title: t('helpers.noSnapshot'), text: t('helpers.noSnapshotText')})
      : stateCard({icon: 'file', title: t('helpers.notSubmitted'), text: t('helpers.notSubmittedText')})];
  }
  const nodes = [stateCard({icon: 'check-circle', tone: 'good', title: sent.when ? t('helpers.submittedWhen', {when: sent.when}) : t('helpers.submitted'), text: sent.note || t('helpers.recordedSubmission')})];
  if (sent.facts.length) nodes.push(factGrid(sent.facts));
  if (sent.answers.length) {
    nodes.push(group(t('helpers.answersSent'), sent.answers.map(item => {
      const row = el('div', 'iv-moment');
      const line = el('div', 'job-panel-line');
      line.append(el('b', '', item.question), copyButton(item.answer));
      row.append(line, el('div', '', item.answer || '—'), ...(item.edited ? [el('span', 'muted small', t('helpers.editedDraft'))] : []));
      return row;
    })));
  }
  if (sent.letter) nodes.push(group(t('helpers.letterSent'), sent.letter.split(/\n\s*\n/).map(text => el('div', 'iv-moment', text)), copyButton(sent.letter)));
  nodes.push(...documentsView(parts.documents || [], t('helpers.documents')));
  nodes.push(el('p', 'muted small', t('helpers.snapshotImmutable')));
  return nodes;
}
