// After "Add a job" or "Applied elsewhere" worked: the dialog closes, a toast says the result and the added job's drawer opens; a dialog that stays open
// (Applied elsewhere asking for the posting's text) shows an "Open job" button in its actions row. Pure of the window: the dialog and openers are passed in.
// Why (owner, 14 Nov 2026, on "fit 35/100, tier C Open job →": "It should feel like a button" · "it should close the popup and open the job drawer with the added
// job when finished" · "we should get a toast notification and the job drawer shuold be opened"). Tests: test/unit/renderer/job-added.test.js.

/** Removes a result's "Open job" button from `dialog` (the dialog opened again, or another link is being added), so it never opens an earlier job. */
export function clearOpenJob(dialog) {
  dialog.querySelector('[data-open-job]')?.remove();
}

/**
 * The step after a job was added to `dialog`: `say()` (the toast), close and `openJob(job)`; with `stay`, the dialog keeps its result and gets one
 * "Open job" button (`label`, made by `button()`) first in its `.actions` row, which closes it and opens the job. -> that button, or null.
 */
export function afterAdded({dialog, job, openJob, button, label, stay = false, say = () => {}}) {
  clearOpenJob(dialog);
  const open = () => { dialog.close(); openJob(job); };
  if (!stay) {
    say();
    open();
    return null;
  }
  const press = Object.assign(button(), {type: 'button', className: 'secondary', textContent: label});
  press.dataset.openJob = '';
  press.addEventListener('click', open);
  const actions = dialog.querySelector('.actions');
  actions.insertBefore(press, actions.children[0] || null);
  return press;
}
