// The "How we protect your data" popup behind the Always on card's link (owner, 5 Nov 2026). The words are renderer/always-on-protect-words.js; the dialog is #aon-protect-dialog in index.html.
// Esc and Close shut it; the native dialog gives focus back to the link that opened it.
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {$} from './core.js';
import {MEASURES, TITLE, LEAD} from '../always-on-protect-words.js';

/** One measure as a row: its title and chip (icon + word) on one line, the plain sentence under it. */
export function measureRow({id, title, text, chip: [word, tone, glyph]}) {
  const chip = pill(word, tone); chip.prepend(icon(glyph));
  const head = el('div', 'aon-measure-head', el('b', '', title)); head.append(chip);
  const row = el('li', `aon-measure tone-${tone}`, head); row.append(el('p', 'muted', text));
  row.dataset.measure = id;
  return row;
}

/** Fill the dialog's words and list (rebuilt on every open) and open it. */
export function openProtect() {
  const dialog = $('aon-protect-dialog');
  if (!dialog || dialog.open) return;
  $('aon-protect-title').textContent = TITLE;
  $('aon-protect-lead').textContent = LEAD;
  $('aon-protect-list').replaceChildren(...MEASURES.map(measureRow));
  dialog.showModal();
}
