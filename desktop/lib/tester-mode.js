// Tester mode: the app told, by whoever launched it, that an AI tester (the nightly persona agent in a test app, Claude Desktop in the live-test twin) is the one using it, so "Send feedback" files a
// bug bundle (lib/tester-bundle.js) to the tester route instead of the real feedback box. Read only in the main process, from the environment; there is no setting, no IPC to turn it on, no way for a person to.
// Why (7 Nov 2026, owner: AI reports must not mix into real user feedback or Admin counts; spec 2026-11-07-ai-tester-bug-reports-design.md): a real person's app (no JOBADABRA_E2E, no JOBADABRA_TWIN) is never in it.
// Guard: desktop/test/unit/main/tester-mode.test.js.
import {isTwin} from './twin.js';

export const SOURCES = ['persona', 'desktop-tester'];

let held = '';
/**
 * Moves the launcher's key out of the process environment into this module, once, at the start of the main process, so nothing the app spawns later (Claude Code sessions, the AI CLIs, the engine) inherits it.
 * Why (7 Nov 2026, review of 5/5): `sessionEnv`, `cleanEnv` and the CLI base copy `process.env` whole; stripping the variable at each spawn site would leave the next new site leaking it.
 */
export function takeTesterKey(env = process.env) {
  if (env.JOBADABRA_TESTER_KEY) { held = String(env.JOBADABRA_TESTER_KEY); delete env.JOBADABRA_TESTER_KEY; }
}

takeTesterKey();   // at import: main.js imports this (via the feedback handlers) before it spawns anything, and main.js is at its 500-line cap

/**
 * -> {source, key} when this process is a tester app, else null. `source` is "persona" (only inside the e2e test app, JOBADABRA_E2E=1) or "desktop-tester" (only inside the twin);
 * `key` is the Bearer secret the launcher passed in JOBADABRA_TESTER_KEY. A word that is not one of the two, no key, or the right word in the wrong kind of app is null, so a leaked variable in a person's
 * app changes nothing.
 */
export function testerMode(env = process.env) {
  const source = String(env.JOBADABRA_TESTER || ''), key = String(env.JOBADABRA_TESTER_KEY || (env === process.env ? held : ''));
  if (!key || !SOURCES.includes(source)) return null;
  if (source === 'persona' && env.JOBADABRA_E2E !== '1') return null;
  if (source === 'desktop-tester' && !isTwin(env)) return null;
  return {source, key};
}
