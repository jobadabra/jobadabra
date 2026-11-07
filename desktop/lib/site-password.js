// The user's one job-site password (src/ai/passwords.py makes it, Keychain item jobadabra.sites.password): Settings shows it,
// so they can sign in by hand too. Read straight from the Keychain, never through an engine run: a run's output goes to the log.
import {execFileSync} from 'node:child_process';
import * as keychain from './keychain.js';   // a test run or a twin: never the real Keychain the same way (lib/keychain.js)

export const SERVICE = 'jobadabra.sites.password';

// → the password, or null (none yet, or not a Mac: the Credential Manager is read by the engine only).
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
