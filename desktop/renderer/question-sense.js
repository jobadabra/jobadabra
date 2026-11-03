// What makes a question a question and a saved value an answer (owner, 2 Nov 2026, a Windows tester's drawer: "The questions could be just 'Workload' or 'Summary'…
// Which doesn't make any sense"; "Saved: Summary" under the question "Summary"). Pure (no DOM, no AI), one rule for every producer and both drawers:
//   - a value that is its own field's label, or another field's label, is a heading read as an answer, never an answer (labelAsValue);
//   - a line with no label has no question to answer (hasLabel);
//   - a question that only repeats its field's label is not a question (isBareLabel).
// Guarded by test/question-sense.test.js and test/details-review-sense.test.js.
const words = text => String(text ?? '').replace(/\*\*/g, '').replace(/[\s*:?？¿]+$/u, '').replace(/^[\s*¿]+/u, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The same words, ignoring case, a trailing colon / star / question mark and spacing. '' never equals anything. */
export const sameWords = (a, b) => Boolean(words(a)) && words(a) === words(b);

/** A line is an answer to a question only when it names what it answers. */
export const hasLabel = label => Boolean(words(label));

/** The value is the label itself, or one of the other labels in the same set (a CV's section headings read as "Summary: Summary"). labels: every other label to check. */
export const labelAsValue = (label, value, labels = []) => Boolean(words(value)) && (sameWords(label, value) || labels.some(other => sameWords(other, value)));

/** A question that repeats its field's label and asks nothing (no question mark of any script). */
export const isBareLabel = (question, label) => sameWords(question, label) && !/[?？¿؟]/u.test(String(question ?? ''));
