// The user's one job-site password (src/ai/passwords.py makes it, Keychain item jobadabra.sites.password): Settings shows it,
// so they can sign in by hand too. Read straight from the Keychain, never through an engine run: a run's output goes to the log.
import {execFileSync} from 'node:child_process';
import * as keychain from './keychain.js';   // a test run or a twin: never the real Keychain the same way (lib/keychain.js)

export const SERVICE = 'jobadabra.sites.password';

// → the password, or null (none yet, or a computer with no store: lib/keychain.js reads the Mac's Keychain or Windows' Credential Manager).
export function read(platform = process.platform, exec = execFileSync) {
  return keychain.read(SERVICE, {account: 'jobadabra', exec, platform});
}

/**
 * The engine run behind Settings' Show and Copy: Copy puts the password on the clipboard, Show only makes it when there is none and reads it from the store.
 * Why (7 Nov 2026, #3532, AI persona run 42401302994): Show used to run the Copy command, so a host with no clipboard helper stored the password, then failed ("The password could not be made or read."), and the second press worked; and a Show must never leave a secret on the clipboard.
 * @param {'show'|'copy'} action
 * @returns {string[]} the arguments of `python -m`
 */
export const runArgs = action => ['src.ai.passwords', 'shared', ...(action === 'show' ? ['--no-copy'] : [])];

/**
 * Runs the engine for Show or Copy and returns its exit code. Why (7 Nov 2026, #3532; 14 Nov 2026, Windows reads its Credential Manager): Show makes the password without the clipboard;
 * only a host the app cannot read the store on (`read()` is null: no store, as on Linux) falls back to the copying run, so "Copied: paste it to read it." stays true there.
 * @param {'show'|'copy'} action
 * @param {(args: string[]) => Promise<number>} runEngine  the engine call, → its exit code
 * @param {() => (string|null)} [readNow]  the store read after the run
 */
export async function runFor(action, runEngine, readNow = read) {
  let code = await runEngine(runArgs(action));
  if (action === 'show' && code === 0 && !readNow()) code = await runEngine(runArgs('copy'));
  return code;
}
