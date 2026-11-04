// The sentence under the feedback box about how much of its limit is used (pure, no DOM, so a test plays every threshold).
/** Takes the characters typed and the box's maxlength; returns '' for a short note (nothing is said), "N of M characters" from 80% of the limit,
 *  and the sentence that nothing more fits at the limit. Why (4 Nov 2026, a tester): the box cut text with no word at all. */
export function countLine(length, max) {
  const fmt = n => n.toLocaleString('en-US');
  if (!(max > 0) || length < max * 0.8) return '';
  if (length >= max) return `${fmt(max)} of ${fmt(max)} characters: nothing more fits. Send this, then write the rest as a second note.`;
  return `${fmt(length)} of ${fmt(max)} characters`;
}
