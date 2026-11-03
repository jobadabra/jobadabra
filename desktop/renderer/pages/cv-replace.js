// "Replace CV" on Profile → CV: pick the file, then redraw everything that describes the CV from the new file (name, size and date, state, CV check) at once, not at the
// next reload (Windows tester on 0.9.2, 3 Nov 2026: the card kept the old file size and the old CV check). The CV card (pages/profile.js) registers its loader here with
// onCvReplaced, so the pages that replace a CV (Actions' button, Build with AI) never import the Profile page (no import cycle: tools/arch-check no-circular).
const redraws = new Set();
/** The CV card's loader: runs after every replaced or built CV. Returns the stop function. */
export const onCvReplaced = redraw => { redraws.add(redraw); return () => redraws.delete(redraw); };
/** A CV was replaced or built: every registered card redraws from the app's new state. A redraw that throws does not stop the others; the first error is thrown after all ran. */
export async function cvReplaced(name = '') {
  const errors = [];
  for (const redraw of [...redraws]) { try { await redraw(name); } catch (error) { errors.push(error); } }
  if (errors.length) throw errors[0];
}
/**
 * choose() -> the new file's name or null (cancelled); readState() refreshes the window's copy of the app state; say(name) tells the person (and offers the strategy review);
 * redraws = the CV cards via cvReplaced(). -> the name, or null when nothing was chosen (then nothing is redrawn or said).
 */
export async function replaceCv({choose, readState, say}) {
  const name = await choose();
  if (!name) return null;
  await readState();
  say(name);   // before the redraw: a card that fails to redraw must not swallow "CV replaced" or the review offer
  await cvReplaced(name);
  return name;
}
