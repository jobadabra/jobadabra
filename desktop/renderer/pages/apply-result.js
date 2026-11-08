// Draws the Apply to jobs dialog's result from renderer/apply-result-model.js: the counts line, one row per job (title link | status chip), each reason once.
import {el, pill} from '../components.js';
import {icon} from '../icons.js';

/** One job's row: the title opens the job like a Jobs list title; the chip is the one place the state is named. `openJob(job)` gets the engine's {url, title, company}, never the display fallbacks. */
export function outcomeRow(row, openJob) {
  const item = el('div', 'apply-outcome');
  item.setAttribute('role', 'listitem');
  const who = el('div', 'apply-outcome-who');
  const open = Object.assign(el('a', 'apply-outcome-title', row.title), {href: '#', title: row.company ? `${row.title} · ${row.company}` : row.title});
  open.addEventListener('click', event => { event.preventDefault(); openJob(row.job); });
  who.append(open);
  if (row.company) who.append(el('span', 'muted small apply-outcome-company', row.company));
  const chip = pill(row.label, row.tone, {title: row.detail});
  chip.prepend(icon(row.icon));
  item.append(who, chip);
  if (row.reason) item.append(el('p', 'muted small apply-outcome-reason', row.reason));
  return item;
}

/** Fills the dialog's summary and list from a view (resultView). An empty view hides both. */
export function drawResult({summary, counts, hint, list}, view, openJob) {
  list.replaceChildren(...view.rows.map(row => outcomeRow(row, openJob)));
  list.hidden = !view.rows.length;
  summary.hidden = !view.rows.length;
  counts.textContent = view.counts.map(item => item.text).join(' · ');
  hint.textContent = view.hint;
  hint.hidden = !view.hint;
}
