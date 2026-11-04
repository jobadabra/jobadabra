// The fingerprint of a key the app sent, for the AI proxy's refusal log line (lib/ai-proxy.mjs): enough to tell two keys apart, useless as a key.
// Why (3 Nov 2026, owner: "We should not use API Keys at all anymore. Everything should be around the ai-broker."): this file also asked Anthropic's and OpenAI's APIs whether the CI test key was
// accepted, before any suite ran. CI holds no such key now (the app and the judges ask the AI broker or Free AI), so there is nothing left to ask; Free AI's token has its own check (lib/free-ai-check.mjs).
// Job: run the backbone
import crypto from 'node:crypto';

// 8 hex of the key's SHA-256 (the strategy refusals of 18 Oct 2026: is the app sending the key the proxy was given?).
export const keyFingerprint = key => (key ? crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 8) : 'none');
