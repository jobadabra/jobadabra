// Pairing the Claude (or ChatGPT) desktop app with this app: a one-time code in the helper file becomes a bearer token that only its hash is kept for, until Disconnect.
// Spec: docs/superpowers/specs/2026-11-03-desktop-ai-mcp-design.md, "Trust" rule 6. Invariants: the token is never stored here (only its sha256, sealed in secrets.json like EXTENSION_TOKEN);
// the code is valid 10 minutes and works once; a wrong code does not burn the pairing; after disconnect() the old token and the old code both fail.
import crypto from 'node:crypto';

export const PAIR_MS = 10 * 60 * 1000;
const USE_NOTE_MS = 60 * 1000;   // "last used" is written at most once a minute: a chatty AI must not rewrite settings.json per call
const sha = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** A new one-time code (replaces an earlier unused one). -> {code, expires} */
export function startPairing(storage, now = Date.now()) {
  const code = crypto.randomBytes(16).toString('hex');
  storage.setSecret('DESKTOP_AI_PAIR', JSON.stringify({hash: sha(code), expires: now + PAIR_MS}));
  return {code, expires: now + PAIR_MS};
}

/** Exchanges the code for a token and forgets the code: -> the token, or null (no pairing, expired, or wrong; an expired one is forgotten, a wrong one is not). */
export function redeem(storage, code, now = Date.now()) {
  let pair;
  try { pair = JSON.parse(storage.secret('DESKTOP_AI_PAIR') || 'null'); } catch { pair = null; }
  if (!pair?.hash) return null;
  if (now > pair.expires) { storage.setSecret('DESKTOP_AI_PAIR', ''); return null; }
  if (typeof code !== 'string' || !same(sha(code), pair.hash)) return null;
  const token = crypto.randomBytes(24).toString('hex');
  storage.setSecret('DESKTOP_AI_PAIR', '');
  storage.setSecret('DESKTOP_AI_TOKEN_HASH', sha(token));
  storage.saveSettings({desktopAi: {connectedAt: new Date(now).toISOString()}});
  return token;
}

/** Whether `token` is the one paired (false when none is). */
export function verifyToken(storage, token) {
  const hash = storage.secret('DESKTOP_AI_TOKEN_HASH');
  return !!hash && typeof token === 'string' && token.length > 0 && same(sha(token), hash);
}

/** Disconnect: the token and any unused code stop working at once. */
export function disconnect(storage) {
  storage.setSecret('DESKTOP_AI_TOKEN_HASH', '');
  storage.setSecret('DESKTOP_AI_PAIR', '');
  storage.saveSettings({desktopAi: undefined});
}

/** Records that the connected AI just used a tool (at most once a minute). */
export function noteUse(storage, now = Date.now()) {
  const current = storage.settings().desktopAi;
  if (!current?.connectedAt) return;
  if (current.lastUsedAt && now - Date.parse(current.lastUsedAt) < USE_NOTE_MS) return;
  storage.saveSettings({desktopAi: {...current, lastUsedAt: new Date(now).toISOString()}});
}

/** What Settings and the banner show: {connected, connectedAt, lastUsedAt}. */
export function status(storage) {
  const current = storage.settings().desktopAi || {};
  return {connected: !!storage.secret('DESKTOP_AI_TOKEN_HASH'), connectedAt: current.connectedAt || '', lastUsedAt: current.lastUsedAt || ''};
}
