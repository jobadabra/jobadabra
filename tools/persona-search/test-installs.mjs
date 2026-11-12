// A small pool of fixed test install ids for local test searches, so a throwaway install does not ask our site for a new index token.
// Why (12 Nov 2026, owner, asked via AskUserQuestion: "Tests reuse one token (Recommended)"): the site gives 300 index tokens per network
// address per day (jobadabra-web api/recipes.js); every throwaway install was a new id and a new token, and one evening's sessions used
// all 300: the next searches read no employer index (HTTP 401) and 7 measured runs were invalid. A pool, not one id: the site also gives
// each install 24 index downloads a day (api/employers.js), and each search still downloads the index as a new install does.
// Invariants: local runs only (never on CI, whose addresses are shared and plentiful); the engine's own files are used unchanged
// (data/install_id, data/site_tokens.json: src/service.py); a token is kept only for the id it was given to; nothing is asked of the site here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const POOL_FILE = path.join(os.homedir(), 'jp-search-check', 'test-installs.json');
export const POOL_SIZE = 20;   // 20 ids x 24 index downloads a day each = 480 searches a day from one Mac

const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

function write(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const part = `${file}.${process.pid}.part`;
  fs.writeFileSync(part, JSON.stringify(value, null, 1) + '\n', {mode: 0o600});
  fs.renameSync(part, file);   // whole or not at all: two searches may end together
}

/** Give the throwaway install in `dataDir` the pool's next id and the tokens that id was given before. -> the id, or '' when off (CI).
 *  The engine reads both files as its own (src/service.py install_id, site_token). */
export function lend(dataDir, {file = POOL_FILE, env = process.env, size = POOL_SIZE} = {}) {
  if (env.CI || env.GITHUB_ACTIONS) return '';
  const idFile = path.join(dataDir, 'install_id');
  if (fs.existsSync(idFile)) return fs.readFileSync(idFile, 'utf8').trim();   // a later search of the same throwaway install keeps its id
  const pool = read(file) || {next: 0, installs: []};
  while (pool.installs.length < size) pool.installs.push({id: `test-${crypto.randomBytes(10).toString('hex')}`, tokens: {}});
  const entry = pool.installs[pool.next % size];
  pool.next = (pool.next + 1) % size;
  write(file, pool);
  fs.mkdirSync(dataDir, {recursive: true});
  fs.writeFileSync(idFile, entry.id + '\n');
  if (Object.keys(entry.tokens).length) fs.writeFileSync(path.join(dataDir, 'site_tokens.json'), JSON.stringify(entry.tokens) + '\n', {mode: 0o600});
  return entry.id;
}

/** After the search: keep the tokens the site gave this id (never a refusal mark, never another id's token), for its next search. */
export function keep(dataDir, id, {file = POOL_FILE} = {}) {
  const pool = read(file), tokens = read(path.join(dataDir, 'site_tokens.json')) || {};
  const entry = id && pool?.installs.find(one => one.id === id);
  if (!entry) return;
  const given = Object.fromEntries(Object.entries(tokens).filter(([, token]) => token?.install === id && token.value));
  if (!Object.keys(given).length) return;
  entry.tokens = {...entry.tokens, ...given};
  write(file, pool);
}
