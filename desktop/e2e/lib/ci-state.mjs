// The CI's small stores on the Admin site (jobadabra-web admin/ci-state.js): the noise register, the verdict audit and the red-main list, read and written over HTTPS.
// Why (5 Nov 2026, owner: "turn this pinned issues into dashboards/tabs/pages in Admin … and will remove them from GH issue list"): these were pinned GitHub issues whose bodies the loops
// read back; now one copy lives behind /ci-state/<key>, shown on /admin/testing/self-healing and /admin/testing/red-main. Spec: docs/superpowers/specs/2026-11-05-state-issues-to-admin-design.md.
// Sync (curl) so triage() and the one-shot jobs keep their shape. The key goes to curl in a 0600 config file, never argv. A read that fails gives `fallback` and a warning; a write that fails returns false.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BASE = () => process.env.CI_STATE_URL || 'https://www.jobadabra.top';

function request(method, key, body = null, {auth = true, run = spawnSync} = {}) {
  const token = process.env.SELFHEAL_PUBLISH_KEY || '';
  if (auth && !token) return {ok: false, status: 0, text: '', why: 'SELFHEAL_PUBLISH_KEY is not set'};
  // The bearer key sits in a 0600 curl config that is deleted at once (never in argv, where `ps` shows it); the body goes through stdin.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-state-'));
  try {
    const file = path.join(dir, 'curl.conf');
    fs.writeFileSync(file, [`url = "${BASE()}/ci-state/${key}"`, `request = "${method}"`, 'silent', 'max-time = 30', 'write-out = "\\n%{http_code}"', ...(auth ? [`header = "Authorization: Bearer ${token}"`] : []),
      ...(body === null ? [] : ['header = "Content-Type: application/json"', 'data-binary = "@-"'])].join('\n'), {mode: 0o600});
    const result = run('curl', ['-K', file], {input: body === null ? '' : JSON.stringify(body), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024});
    if (result.status !== 0) return {ok: false, status: 0, text: '', why: `curl exit ${result.status}`};
    const out = String(result.stdout), cut = out.lastIndexOf('\n'), status = Number(out.slice(cut + 1));
    return {ok: status >= 200 && status < 300, status, text: out.slice(0, cut), why: `HTTP ${status}`};
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

/** {ok, value}: ok is false when the site was unreachable or refused (a writer that would replace the whole body must stop then); value is null when nothing was stored yet. */
export function tryRead(key, options = {}) {
  const got = request('GET', key, null, {auth: key !== 'red-main', ...options});
  if (!got.ok) { console.log(`${got.status === 0 && /not set/.test(got.why) ? '' : '::warning::'}ci-state ${key} not read (${got.why})`); return {ok: false, value: null}; }
  try { return {ok: true, value: JSON.parse(got.text)}; } catch { return {ok: false, value: null}; }
}

/** The parsed body stored under `key`, or `fallback` when the site is unreachable, refuses, or has nothing yet (a reader that only judges less without it). */
export function readState(key, fallback = null, options = {}) {
  const {value} = tryRead(key, options);
  return value ?? fallback;
}

/** Replaces the body under `key`; true when the site took it. */
export function putState(key, value, options = {}) {
  const got = request('PUT', key, value, options);
  if (!got.ok) console.log(`::warning::ci-state ${key} not written (${got.why})`);
  return got.ok;
}

/** Appends entries to the noise register (the site dedupes by id and keeps the newest 300); true when the site took them. */
export function appendNoise(entries, options = {}) {
  const got = request('POST', 'noise-register', {entries}, options);
  if (!got.ok) console.log(`::warning::ci-state noise-register not appended (${got.why})`);
  return got.ok;
}

/** The noise register's entries (what was judged noise before filing); [] when the site cannot be read (the findings are then judged again, which costs only AI calls). */
export const noiseEntries = () => {
  const entries = readState('noise-register', {entries: []})?.entries;
  return Array.isArray(entries) ? entries : [];
};
