// Job: wait on state
/* global window */
// Starts the test app again on a port of its own and waits for the app's OWN word that its extension socket is open there; a port the app says is taken is replaced, never waited on.
// Why (14 Nov 2026, gl3; run 43607466981, settings suite, Linux; owner rule "a flaky check gets an owner at once"): the Profile step chose a free port with freePort(), quit the app and
//   started it with that number (JOBADABRA_PORT). Between the choosing and the app's bind another program took the port: the app logged "[extension] connection off: port 34707 is used by
//   another program (EADDRINUSE)" 0.1 s after its start and never got the socket back (45 s), while GET /extension/pair on that port was answered HTTP 400 by whatever held it. A number
//   chosen first and bound later is not owned (own-port.mjs says so for freePort); the step trusted it and polled the wrong program until its cap. The app's own state (formsOpen().linkOff,
//   lib/server-listen.js) names the case, so the harness asks the app and starts it on another port. Every wait is on a state and bounded by the running step's clock.
// Why (14 Nov 2026, gl3; Gitar on #4232): a port the app says is taken is replaced at once, not waited on for the app's own 5 s retry (server-listen.js retryMs). In run 43607466981 the holder kept the
//   port for the whole 45 s cap, so a retry never came; replacing costs one restart (~13 s; the step's 90 s cap in hang-caps.json was sized from one restart) and a port taken twice in a row is not a race.
import {freePort} from './own-port.mjs';
import {pollUntil, stepTimeLeft} from './wait-on-state.mjs';

export const PORT_TRIES = 2;   // PROVISIONAL (hang-caps.json sizes the step's 90 s from one restart): one replacement; a port taken twice in a row is not a race and the red then says so
export const RESTART_NEEDED_MS = 20000;   // PROVISIONAL: ~1.5x the measured restart (p95 13.4 s, hang-caps.json); less step clock left than this and a replacement start is not begun

/**
 * -> what the app says about its extension socket on `port`: {state: 'listening' | 'busy' | 'other' | 'waiting', code, note}.
 * `linkOffCode` is the app's own claim (`formsOpen().linkOff.code`, '' while its socket is open or not yet tried), `answered` whether GET /extension/pair on the port was the app's answer.
 * Busy comes first: whatever answers on a port the app says is taken is not the app (run 43607466981: HTTP 400).
 */
export function socketVerdict({linkOffCode = '', answered = false, note = ''} = {}) {
  if (linkOffCode === 'EADDRINUSE') return {state: 'busy', code: linkOffCode, note};
  if (linkOffCode) return {state: 'other', code: linkOffCode, note};   // EACCES and the like: another port will not help the app, the red names the code
  return {state: answered ? 'listening' : 'waiting', code: '', note};
}

/** GET /extension/pair on the port as the extension asks it; -> {answered, note}: ours when it says 200, the number it answered otherwise (or why nothing did). */
export async function askPair(port, extensionId) {
  try {
    const reply = await fetch(`http://127.0.0.1:${port}/extension/pair`, {headers: {Origin: `chrome-extension://${extensionId}`}});
    return {answered: reply.ok, note: reply.ok ? '' : `HTTP ${reply.status}`};
  } catch (error) { return {answered: false, note: `no answer (${error.cause?.code || error.message})`}; }   // shown in the hang message: the last state seen
}

/** -> {ok, value} or {ok: false, note}: a read of the app's window that may fail while it is starting; the note names the read and the error's first line, for the red. */
async function tryRead(what, read) {
  try { return {ok: true, value: await read()}; } catch (error) { return {ok: false, note: `${what}: ${String(error.message).split('\n')[0]}`}; }
}

/** Waits (the step's clock) for the restarted app's window to report it is set up again; throws a red naming the last window error. */
async function waitSetUp(ctx, where, wait) {
  let windowNote = '';
  const {value: setUp} = await pollUntil(async () => {
    const seen = await tryRead('the window\'s state', () => ctx.page.evaluate(async () => (await window.pilot.state()).settings.setupDone === true));
    windowNote = seen.ok ? '' : seen.note;
    return seen.ok && seen.value;
  }, value => value, {log: () => {}, what: 'the app set up again', ...wait()});
  if (!setUp) throw new Error(`after the restart (${where}) the app is not set up again${windowNote ? ` (last read ${windowNote})` : ''}`);
}

/** Waits for the app's own word on its extension socket at `port`; -> {state, code, note, problem}. A window that does not answer, or a read that outlived the clock, is "waiting" with a `problem`, never undefined. */
async function waitVerdict(port, {readLinkOff, ask, wait}) {
  const {value, hung} = await pollUntil(async () => {
    const link = await tryRead('the app\'s link state', readLinkOff);
    const answer = await ask(port);
    if (!link.ok) return {state: 'waiting', code: '', note: answer.note, problem: link.note};   // without the app's own word a 200 proves nothing (the squatter case): keep waiting
    return {...socketVerdict({linkOffCode: link.value, ...answer}), problem: ''};
  }, seen => seen.state !== 'waiting', {log: () => {}, what: `the app's extension socket on port ${port}`, ...wait()});
  // A read that outlived the step's clock leaves no verdict: say so instead of "undefined" (Gitar on #4236).
  return hung || !value?.state ? {state: 'waiting', code: '', note: '', problem: 'no reading before the step\'s clock ran out'} : value;
}

/** -> true when a busy port may be replaced (tries left and the step has RESTART_NEEDED_MS of clock left); otherwise adds the reason to the verdict's `problem`. */
function mayReplace(verdict, attempt, tries, timeLeft) {
  if (verdict.state !== 'busy' || attempt >= tries) return false;
  const left = timeLeft();
  if (left === undefined || left >= RESTART_NEEDED_MS) return true;
  verdict.problem = `${verdict.problem ? `${verdict.problem}; ` : ''}only ${Math.round(left / 1000)} s of the step left, a new start needs ${RESTART_NEEDED_MS / 1000} s`;
  return false;
}

/**
 * Quits (`how`) and starts the app again on a free port of its own, once the app says its extension socket is open there; -> the port. When the app says the port is taken, it is
 * started again on another, up to `tries` times, and only while the step has `RESTART_NEEDED_MS` of its clock left. Each wait is bounded by the running step's remaining clock
 * (POLL_CAP_MS outside a runner step); a window that does not answer yet counts as "waiting" and its error is named in the red, never dropped.
 * Options: `extensionId` (for the pair ask), `pickPort`/`readLinkOff`/`ask`/`capMs`/`timeLeft` (tests inject them).
 */
export async function relaunchOnOwnPort(ctx, {how = 'quit', extensionId, tries = PORT_TRIES, pickPort = freePort, capMs, timeLeft = stepTimeLeft,
  readLinkOff = () => ctx.page.evaluate(async () => (await window.pilot.formsOpen())?.linkOff?.code || ''), ask = port => askPair(port, extensionId), say = console.log} = {}) {
  const wait = () => ({capMs: capMs ?? timeLeft()});   // the running step's remaining clock; undefined outside a runner step = pollUntil's own default
  for (let attempt = 1; ; attempt++) {
    const port = await pickPort();
    await ctx.relaunch({JOBADABRA_PORT: String(port)}, undefined, {how});
    await waitSetUp(ctx, `port ${port}, start ${attempt}/${tries}`, wait);
    const verdict = await waitVerdict(port, {readLinkOff, ask, wait});
    if (verdict.state === 'listening') return port;
    if (mayReplace(verdict, attempt, tries, timeLeft)) { say(`  port ${port} was taken before the app bound it (${verdict.note || 'no answer'}); starting the app on another port (${attempt}/${tries})`); continue; }
    throw new Error(`the app's extension socket on port ${port} is ${verdict.state}${verdict.code ? ` (${verdict.code})` : ''}${verdict.note ? `, the port answers ${verdict.note}` : ''}${verdict.problem ? `; ${verdict.problem}` : ''} after ${attempt} start(s)`);
  }
}
