// What happens right after the extension pressed a multi-step form's Continue (next-step.js): when the step changed IN PLACE (same address, new fields), the new step is read and filled.
// Why (7 Nov 2026, owner's XING run, "the extension panel stopped, even if the work was not done"): only a page load or an account step read a page again, and a page is read once per address
// (fill-flow.js `started`, keyed by the address without its #fragment), so step 2 of 5 ("Which country do you live in?") was never read: 30 s of silence, then "dead end: silent".
// Why (7 Nov 2026, review): "changed" is the page's own signature before vs after the press (form-ready.js pageSignature), never a DOM watcher started after the click: a step that swaps within
// milliseconds finishes before such a watcher exists. Pure apart from the parts it is handed (fill-flow.js wires the real ones), so the owner's sequence is a test. Guard: app-core/test/next-step-read.test.js.
import {pageKey} from './tab-pages.js';

// tab: the tab as it was when Continue was pressed; before: the page's signature then ('' = unknown). parts: {still(tabId) (page-still.js: the page quiet for a moment), getTab(tabId), signature(tab) (now),
// read(tab) (fill-flow.js readAgain: forgets the page's once-per-address mark, waits for it to settle and reads it), log(text)}. -> 'read' | 'moved' (a new address: its own load reads it) | 'unchanged' | 'gone'.
export async function readAfterNextStep(tab, before, {still, getTab, signature, read, log = () => {}}) {
  const key = pageKey(tab.url);
  await still(tab.id);
  const live = await getTab(tab.id);
  if (!live) return 'gone';
  if (pageKey(live.url) !== key) return 'moved';
  const now = await signature(live);
  if (!before || !now || now === before) return 'unchanged';   // nothing readable, or the press changed nothing: nothing to read (and no loop on a Continue that did nothing)
  log('next step pressed: the page changed in place, read again');
  await read(live);
  return 'read';
}
