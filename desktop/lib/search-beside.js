// LinkedIn jobs on every Find jobs, PR 2/3 (spec docs/superpowers/specs/2026-10-31-linkedin-headless-design.md): the engine's search and the LinkedIn step run side by side
// on the press's ONE clock (lib/search-steps.js). Design: the step never changes or delays the engine's result; Stop, a failing search or the press's deadline ends it; its verdict is
// recorded once (lib/linkedin-session.js noteRun); the jobs it found are scored by the existing light run (visitsArgs) only when the press has time left.
// The job boards that refuse plain reading are read beside it the same way, in their own headless Chrome (lib/headless-boards.js; owner, 12 Nov 2026: "Yes, as boards (Recommended)").
// The steps are registered once by the visits handlers (they need visits.js, which imports pipeline.js: registering here keeps the imports one-way).
// Guards: test/unit/main/search-beside.test.js, test/guards/safety/headless-boards-gate.test.js.
import {noteRun} from './linkedin-session.js';

let registered = null, registeredScore = null, registeredBoards = null;
/** Register the LinkedIn step: (signal, onLine) -> Promise<{state, jobs, fits?, ...}>, and the light scoring (fits, onLine). null removes them (tests, tools). */
export const setLinkedinStep = (fn, score = null) => { registered = fn; registeredScore = score; };
/** Register the job boards' step: (signal, onLine) -> Promise<{state, jobs, fits?}>. null removes it (tests, tools). */
export const setBoardsStep = fn => { registeredBoards = fn; };

/**
 * True for a person's own Find jobs press (the button, Telegram's run, a resumed press, the first press): the only runs that read LinkedIn.
 * Why (31 Oct 2026, Gitar on #2699 + spec: "scheduling LinkedIn outside Find jobs" is parked): the timer, a re-score and "Search wider" also pass through the search task,
 * and the session must not be used with nobody at the keyboard (owner, 26 Oct 2026: not started automatically in the background).
 */
export const ownPress = ({mode, trigger, employers = false, note = ''}) => mode === 'run' && ['you', 'first'].includes(trigger) && !employers && !note;

/** The search task's one call: the LinkedIn and job boards steps beside `steps` for a person's own press (ownPress), `steps` alone for every other run. -> steps' result. */
export const besideSteps = (storage, onLine, signal, press, steps) => (ownPress(press) ? withBeside(storage, onLine, signal, steps) : steps());

const SCORE_NEEDS_MS = 40000;   // under this much of the press left, the jobs wait for the next search (an engine step needs a few seconds to start)
/**
 * Run `main` (the engine's steps) with the LinkedIn step and the job boards step beside it, each in its own browser, on one deadline. -> main's result, whatever the steps do.
 * signal: Stop. deadlineMs: when the steps must end (the press's end, less a margin, so the session has left the browser before the press does).
 */
export async function withBeside(storage, onLine, signal, main, {step = registered, boards = registeredBoards, score = registeredScore, deadlineMs = 170000, budgetMs = 180000, now = Date.now, record = noteRun} = {}) {
  if (!step && !boards) return main();
  const startedAt = now(), own = new AbortController(), stop = () => own.abort();
  if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, {once: true});
  const timer = setTimeout(stop, deadlineMs);
  const beside = fn => (fn ? Promise.resolve().then(() => fn(own.signal, onLine)).catch(() => null) : Promise.resolve(null));
  const aside = Promise.all([beside(step), beside(boards)]);
  let outcome;
  try { outcome = await main(); } catch (error) { stop(); await aside; clearTimeout(timer); signal?.removeEventListener('abort', stop); throw error; }   // Stop stays wired until the steps end: it can come after the engine's steps
  const [result, read] = await aside;
  clearTimeout(timer);
  signal?.removeEventListener('abort', stop);
  if (result && result.state !== 'off') record(storage, {...result, at: new Date(now()).toISOString()});
  const fits = (result?.fits || 0) + (read?.fits || 0);   // one light scoring run for the jobs both steps added
  if (fits && score && !own.signal.aborted && now() - startedAt < budgetMs - SCORE_NEEDS_MS) await score(fits, onLine).catch(() => {});
  return outcome;
}
