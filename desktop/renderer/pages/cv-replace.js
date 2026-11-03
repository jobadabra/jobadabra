// "Replace CV" on Profile → CV: pick the file, then redraw everything that describes the CV from the new file (name, size and date, state, CV check) at once,
// not at the next reload (Windows tester on 0.9.2, 3 Nov 2026: the card kept the old file size and the old CV check). Deps are injected so a test plays the press.
/**
 * choose() -> the new file's name or null (cancelled); readState() refreshes the window's copy of the app state; redraw() redraws the CV card and CV check from it;
 * say(name) tells the person. -> the name, or null when nothing was chosen (then nothing is redrawn).
 */
export async function replaceCv({choose, readState, redraw, say}) {
  const name = await choose();
  if (!name) return null;
  await readState();
  say(name);   // before the redraw: a card that fails to redraw must not swallow "CV replaced"
  await redraw(name);
  return name;
}
