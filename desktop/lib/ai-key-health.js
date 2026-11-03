// Does the user's own AI key work? The one owner of that answer (owner brief, 3 Nov 2026, Windows tester on 0.9.2: Settings → Connections said "Connected · Anthropic API key"
// while every AI step failed with 401 "invalid x-api-key", and nothing in the window said so). Adapters report what the provider answered (lib/ai/refusals.js keyHeard /
// keyWorked); this file keeps it in settings.aiKeyRejected = {engine, fp, at} where fp is a short hash of THAT key, so pasting a new key (or choosing another engine) ends the
// verdict with no clearing step, and a good answer from the same key clears it. The window reads keyHealth() in state(); the first rejection also tells the window once.
// Never stores or logs the key itself. Guarded by test/ai-key-health.test.js.
import crypto from 'node:crypto';
import {onKeyVerdict} from './ai/refusals.js';

const SECRETS = {api: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY'};
/** A short hash of an API key (12 hex): enough to tell "the same key" from "a new one", useless to get the key back. Takes any value, returns a string. */
export const fingerprint = key => crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 12);

/** {rejected, engine, secret (the key's name, e.g. ANTHROPIC_API_KEY), at} for the engine the user chose now: true only while the saved key is the one that was refused. */
export function keyHealth(storage, engine) {
  const mark = storage.settings().aiKeyRejected, name = SECRETS[engine];
  const rejected = !!(mark && name && mark.engine === engine && storage.secret(name) && mark.fp === fingerprint(storage.secret(name)));
  return {rejected, engine: rejected ? engine : '', secret: rejected ? name : '', at: rejected ? mark.at : ''};
}

let stopLast = () => {};
/**
 * Starts keeping the verdict: getStorage() -> the storage (or null before it exists), onRejected(engine) fires once per new rejection (not on every failed step), now() -> ISO time.
 * One watcher per process (a second start replaces the first). Writes only settings.aiKeyRejected. Returns the stop function.
 */
export function watchKeyHealth(getStorage, {onRejected = () => {}, now = () => new Date().toISOString()} = {}) {
  stopLast();   // one watcher per process: a second start replaces the first, never stacks
  stopLast = onKeyVerdict(({engine, apiKey, ok}) => {
    const storage = getStorage();
    if (!storage) return;
    const mark = storage.settings().aiKeyRejected, fp = fingerprint(apiKey);
    if (ok) { if (mark && mark.engine === engine && mark.fp === fp) storage.saveSettings({aiKeyRejected: null}); return; }
    if (mark && mark.engine === engine && mark.fp === fp) return;
    storage.saveSettings({aiKeyRejected: {engine, fp, at: now()}});
    onRejected(engine);
  });
  return stopLast;
}
