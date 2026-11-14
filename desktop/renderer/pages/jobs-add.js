// Jobs "+ Add": one button and a small dialog of three choices; each row presses the opener of the flow that already exists (Add a job, Applied elsewhere, Log job activity).
// Guarded by: test/unit/renderer/add-dialog.test.js, integration/app/add-dialogs-enter.test.js.
import {$} from './core.js';

const rows = () => [...document.querySelectorAll('#add-dialog .add-choice')];

// Opens one flow: closes the choice dialog, then presses that flow's own opener.
export function openAddFlow(id) {
  $('add-dialog').close();
  $(id).click();
}

// Why (14 Nov 2026, lg coordinator: Enter in the Add job dialog closed it): a form's Enter in a text box presses its FIRST submit button, and in these dialogs that is Close (index.html).
// The box's Enter is taken here and presses the dialog's own "Add it". Only the two single-purpose Add dialogs: Add job activity has a search combobox where Enter picks a suggestion.
const ADD_DIALOGS = ['import-dialog', 'applied-dialog'], TEXT_BOXES = new Set(['text', 'url', 'search', 'email']);
function wireEnter(dialog) {
  dialog.addEventListener('keydown', event => {
    const box = event.target;
    if (event.key !== 'Enter' || event.isComposing || box.tagName !== 'INPUT' || !TEXT_BOXES.has(box.type) || box.getAttribute('role') === 'combobox') return;
    event.preventDefault();   // never the browser's own Enter: that presses Close
    const add = dialog.querySelector('button.primary');
    if (add && !add.disabled) add.click();   // disabled = a run is in progress: Enter does nothing
  });
}

export function wireAdd() {
  ADD_DIALOGS.forEach(id => wireEnter($(id)));
  const dialog = $('add-dialog');
  $('add-open').addEventListener('click', () => { dialog.showModal(); rows()[0]?.focus(); });
  rows().forEach(row => row.addEventListener('click', () => openAddFlow(row.dataset.add)));
  // Enter and click open a row (a button does both); the arrows move between rows; Esc closes (the dialog's own).
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const all = rows(), at = all.indexOf(document.activeElement);
    all[(at + (event.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus();
    event.preventDefault();
  });
}
