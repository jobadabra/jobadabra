// Job: wait on state
/* global window */
// Starts the test app again on a port of its own and waits for the app's OWN word that its extension socket is open there; a port the app says is taken is replaced, never waited on.
// Why (14 Nov 2026, gl3; run 43607466981, settings suite, Linux; owner rule "a flaky check gets an owner at once"): the Profile step chose a free port with freePort(), quit the app and
//   started it with that number (JOBADABRA_PORT). Between the choosing and the app's bind another program took the port: the app logged "[extension] connection off: port 34707 is used by
//   another program (EADDRINUSE)" 0.1 s after its start and never got the socket back (45 s), while GET /extension/pair on that port was answered HTTP 400 by whatever held it. A number
//   chosen first and bound later is not owned (own-port.mjs says so for freePort); the step trusted it and polled the wrong program until its cap. The app's own state (formsOpen().linkOff,
//   lib/server-listen.js) names the case, so the harness asks the app and starts it on another port. No wait is lengthened and none is added: the only waits are on states.
import {freePort} from './own-port.mjs';
import {pollUntil} from './wait-on-state.mjs';

export const PORT_TRIES = 5;   // a hang guard: a port taken 5 times in a row is not a race, and the red then says so

/**
 * -> what the app says about its extension socket on `port`: {state: 'listening' | 'busy' | 'waiting', code, note}.
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

/**
 * Quits (`how`) and starts the app again on a free port of its own, once the app says its extension socket is open there; -> the port. When the app says the port is taken, it is
 * started again on another, up to `tries` times. The step's own clock and POLL_CAP_MS stay the hang guards of each wait.
 * Options: `extensionId` (for the pair ask), `pickPort`/`readLinkOff`/`ask`/`capMs` (tests inject them).
 */
export async function relaunchOnOwnPort(ctx, {how = 'quit', extensionId, tries = PORT_TRIES, pickPort = freePort, capMs,
  readLinkOff = () => ctx.page.evaluate(async () => (await window.pilot.formsOpen())?.linkOff?.code || ''), ask = port => askPair(port, extensionId), say = console.log} = {}) {
  const wait = capMs ? {capMs} : {};
  for (let attempt = 1; ; attempt++) {
    const port = await pickPort();
    await ctx.relaunch({JOBADABRA_PORT: String(port)}, undefined, {how});
    const {value: setUp} = await pollUntil(() => ctx.page.evaluate(async () => (await window.pilot.state()).settings.setupDone === true), value => value, {log: () => {}, what: 'the app set up again', ...wait});
    if (!setUp) throw new Error('after the restart the app is not set up again');
    const {value: verdict} = await pollUntil(async () => socketVerdict({linkOffCode: await readLinkOff(), ...(await ask(port))}), seen => seen.state !== 'waiting',
      {log: () => {}, what: `the app's extension socket on port ${port}`, ...wait});
    if (verdict.state === 'listening') return port;
    if (verdict.state === 'busy' && attempt < tries) { say(`  port ${port} was taken before the app bound it (${verdict.note || 'no answer'}); starting the app on another port (${attempt}/${tries})`); continue; }
    throw new Error(`the app's extension socket on port ${port} is ${verdict.state}${verdict.code ? ` (${verdict.code})` : ''}${verdict.note ? `, the port answers ${verdict.note}` : ''} after ${attempt} start(s)`);
  }
}
