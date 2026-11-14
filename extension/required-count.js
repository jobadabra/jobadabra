// The one count of a form's required questions for the page panel's "N of M" (review.js).
// Why (14 Nov 2026, lg coordinator's definition, the owner can change it): the panel counted optional fields Claude filled as "required" (review.js `needed`), so Canonical's form read 14 of 25 in the panel against
// 11 of 19 elsewhere; the new drawer counts 18. "Required" = the page marks it required, consents and own-words included; an upload slot has its own state; an optional field is never counted.
// The fill card (fill-card.js) is the learning digest's own measure of what the fill could try and keeps its own count. A classic script (a content script has no imports): it puts the function on globalThis.
(() => {
  /**
   * @param {{required?: boolean, filled?: boolean, outcome?: string, type?: string}[]} rows a form's fields: the panel's entries ({filled}) or the fill's trace rows ({outcome: 'filled'})
   * @returns {{required: number, filled: number, left: number}} the required questions, how many hold an answer, how many still need the person
   */
  globalThis.__jobadabraRequiredCount = rows => {
    const need = (Array.isArray(rows) ? rows : []).filter(row => row && row.required === true && row.type !== 'file');
    const filled = need.filter(row => row.filled === true || row.outcome === 'filled').length;
    return {required: need.length, filled, left: need.length - filled};
  };
})();
