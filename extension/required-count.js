// The one count behind the page panel's "N of M" and its ring and bar (review.js).
// Why (14 Nov 2026, owner/coordinator): the panel counted every optional field Claude filled as required (14 of 25 on a form whose page marks 18); only a required question, or an optional answer Claude wrote that is still empty, can hold Ready back, so only those are counted.
// A classic content script (no imports): it puts the function on window, and review.js's helper guard names it.
(() => {
  /**
   * @param {{required?: boolean, filled?: boolean, type?: string, blocks?: boolean}[]} rows the panel's entries; `blocks` = an answer Claude wrote or the person changed that Ready waits for
   * @returns {{required: number, filled: number, pending: number, total: number, left: number}} the page's required questions (an upload slot aside, it has its own state), the empty optional answers that still block Ready, and their sum
   */
  window.__jobadabraRequiredCount = rows => {
    const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
    const need = list.filter(row => row.required === true && row.type !== 'file');
    const filled = need.filter(row => row.filled === true).length;
    const pending = list.filter(row => row.required !== true && row.blocks === true && row.filled !== true).length;
    return {required: need.length, filled, pending, total: need.length + pending, left: need.length - filled + pending};
  };
})();
