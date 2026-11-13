// Every Jobadabra layer on a page (the panel, the dim, the progress and Stop notes: ids starting "jobadabra") stays on top of anything the page shows, any popup, where the person can
// see and press it. The layers are manual popovers, so they sit in the browser's top layer above every z-index; a page's own top-layer element shown later (a modal dialog, a popover,
// a fullscreen element) goes above them, so they are raised again after it. A page's showModal() also makes everything outside its dialog inert, so a layer outside it takes no click
// (measured 13 Nov 2026 in Chromium: a fixed host 0 clicks, a popover shown after the modal 0 clicks, the host moved inside the open modal 1 click and on top).
// Why (13 Nov 2026, owner, LinkedIn Easy Apply 4a: "Lift the panel above modals", asked via AskUserQuestion; then "it should be always on top of anything else on the website" · "on any
// popop"): while a modal dialog is open the layers live inside the topmost one, otherwise on <html>; after every move or page popup they are shown again on top. No site name: any page.
// Invariants: this file only moves our own layers between two parents and re-shows them on top; it never creates, hides or removes one, and never touches the page's own nodes.
(() => {
  if (window.__jobadabraTopLayer) return;
  // Our floating layers only: each sets position:fixed in its own style (review.js's host, panel-overlay.js's dim, the progress, Stop and reading notes). An in-flow one of ours, like
  // panel-written.js's "Review my answer" row under an answer box, keeps its place on the page (Gitar on #4040).
  const ours = node => node?.nodeType === 1 && typeof node.id === 'string' && node.id.startsWith('jobadabra') && node.style?.position === 'fixed';
  const parentNow = () => [...document.querySelectorAll('dialog:modal')].at(-1) || document.documentElement;
  const placed = new Map();   // layer -> the dialog this file moved it into: if the page removes that dialog with the layer still in it, the layer comes back to <html>
  // The browser's popover look (a centred, bordered, white box) is undone: each layer keeps its own place and look (its inline style wins over this sheet).
  const SHEET = '[id^="jobadabra"][popover]{margin:0;border:0;padding:0;inset:auto;width:auto;height:auto;overflow:visible;background:transparent;color:inherit}';
  let raising = false;
  const moved = new Set();   // the layers' owners told of a move (review.js: the panel shows as its pill above a modal); a call, never an event into the page
  // A browser without popovers (Chrome before 114) keeps the layers' z-index and the move into a modal; it only misses the raise above a page's own popover.
  // Shown again in their own stacking order (the dim under the panel under the notes: their z-index), so each is above whatever the page put in the top layer before.
  function raise(layers) {
    raising = true;
    try {
      for (const layer of layers.filter(one => one.isConnected && typeof one.showPopover === 'function').sort((a, b) => (Number(a.style.zIndex) || 0) - (Number(b.style.zIndex) || 0))) {
        if (layer.hidden) { if (layer.matches(':popover-open')) layer.hidePopover(); continue; }   // closed by its owner (the panel's ×): out of the top layer, never shown again here
        if (layer.popover !== 'manual') layer.popover = 'manual';
        if (layer.matches(':popover-open')) layer.hidePopover();
        layer.showPopover();
      }
    } finally { raising = false; }
  }
  function sheet() {
    if (document.getElementById('jobadabra-top-layer-style')) return;
    const style = Object.assign(document.createElement('style'), {id: 'jobadabra-top-layer-style', textContent: SHEET});
    (document.head || document.documentElement).append(style);
  }
  const all = () => [...new Set([...document.documentElement.children, ...[...document.querySelectorAll('dialog')].flatMap(dialog => [...dialog.children])].filter(ours))];
  function follow(stranded = []) {
    const root = document.documentElement;
    if (!root) return;
    sheet();
    const parent = parentNow();
    const layers = [...new Set([...all(), ...stranded.filter(ours)])];
    for (const layer of layers) {
      if (layer.parentNode === parent) continue;
      parent.append(layer);
      if (parent === root) placed.delete(layer); else placed.set(layer, parent);
      for (const tell of moved) tell(layer);
    }
    raise(layers);   // a move takes a popover out of the top layer, and a page popup opened since sits above: shown again on top
  }
  // Only what can change the right parent or the top: a dialog opened or closed (its open attribute), a dialog or one of our layers added or removed.
  const matters = record => (record.type === 'attributes' && record.target.localName === 'dialog') ||
    [...record.addedNodes, ...record.removedNodes].some(node => ours(node) || node.localName === 'dialog');
  new MutationObserver(records => {
    if (!records.some(matters)) return;
    // Removed WITH the page's dialog (still its child, the dialog gone), never one its owner removed (Stop's remove() leaves it with no parent: that stays removed).
    const stranded = [...placed].filter(([layer, dialog]) => !dialog.isConnected && layer.parentNode === dialog).map(([layer]) => layer);
    for (const [layer] of placed) if (!layer.parentNode) placed.delete(layer);
    follow(stranded);
  }).observe(document, {subtree: true, childList: true, attributes: true, attributeFilter: ['open']});
  // A page popover opened, or an element went fullscreen: it is in the top layer above ours now, so ours are shown again after it (toggle does not bubble: caught on its way down).
  document.addEventListener('toggle', event => { if (!raising && !ours(event.target) && event.newState === 'open') raise(all()); }, true);
  document.addEventListener('fullscreenchange', () => raise(all()));
  window.__jobadabraTopLayer = {follow, parentNow, onMove: tell => moved.add(tell)};
  follow();
})();
