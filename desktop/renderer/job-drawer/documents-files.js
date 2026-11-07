// The job's files as attachment rows (Application → Submitted lists the files as sent). Moved out of application-preparation.js when the
// Documents tab took the tailored CV and the cover letter; guarded by test/unit/renderer/job-documents.test.js.
import {t} from '../../i18n/index.js';
import {el} from '../components.js';
import {group} from './parts.js';

// The job's documents (a tailored CV) as attachment rows: Save asks where and writes the store's copy (IPC jobFileSave); a file too large
// to read here: its name only. Also under Submitted.
export function documentsView(documents, title = t('helpers.filesJob')) {
  if (!documents.length) return [];
  return [group(title, documents.map(file => {   // an icon like every section of the kit
    const row = el('div', 'attachment');
    row.append(el('span', 'attachment-name', file.name));
    if (file.url) {
      const save = Object.assign(el('button', 'soft-button', t('helpers.saveEllipsis')), {type: 'button'});
      save.addEventListener('click', async () => { const done = await window.pilot.jobFileSave(file.name, file.url).catch(() => null); if (done?.ok) save.textContent = t('helpers.saved'); });
      row.append(save);
    }
    else row.append(el('span', 'muted small', t('helpers.largeShowHere')));
    return row;
  }))];
}
