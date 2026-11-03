// "Import from LinkedIn" engine (spec docs/superpowers/specs/2026-11-03-linkedin-profile-import-design.md; LinkedIn Member Data Portability API, 3rd party):
// the consent through the website (it holds the client secret; the key comes back to this app's own socket), the access key in the Keychain, and the Member Snapshot reads made HERE, on this Mac, so the
// profile data never passes our server. Same consent shape as lib/linkedin-oauth.js. Settings: settings.linkedinImport = {connectedAt, expiresAt} (no value;
// settings.linkedin is the identity connection). The key is a credential: Keychain only (lib/keychain.js: a test or the twin writes its own file), never a log,
// the store, Notion or an upload; deleted by Disconnect, at expiry and on any 401/403. Nothing here is about LinkedIn jobs. Guard: test/linkedin-import.test.js.
import * as realKeychain from './keychain.js';
import {begin, cancel as cancelFlow, fail} from './oauth-handoff.js';
import {toCv} from './linkedin-export.js';

export const SITE = process.env.JOBADABRA_SITE || 'https://www.jobadabra.top';
export const API = 'https://api.linkedin.com';
export const SERVICE = 'jobadabra.linkedin.dma_token';
export const ACCOUNT = 'jobadabra';
export const VERSION = '202312';   // the only Linkedin-Version this endpoint takes (other versions answer 426)
// The only domains read (case sensitive): the profile's own tables. Never messages, connections, posts or the Changelog.
export const DOMAINS = ['PROFILE', 'POSITIONS', 'EDUCATION', 'SKILLS', 'LANGUAGES'];
const FILE = {PROFILE: 'Profile.csv', POSITIONS: 'Positions.csv', EDUCATION: 'Education.csv', SKILLS: 'Skills.csv', LANGUAGES: 'Languages.csv'};
const MAX_PAGES = 40;

// One consent at a time, by the shared hand-off (lib/oauth-handoff.js, flow 'linkedin-import'). Why (3 Nov 2026, Gitar on web#336): the key used to wait on the site under an id the app chose, so an
// attacker's link could make a victim's consent hand the victim's key to the attacker. Now LinkedIn returns to the site, which POSTs the key to THIS app's own socket (127.0.0.1:47111,
// lib/oauth-handoff-route.js), and the app takes it only for the `state` it made and is still waiting on, once.
const FLOW = 'linkedin-import';
/** Stops a consent that is still waiting (a new click, or the dialog closing): the waiting connect() resolves {ok: false, error: 'Cancelled.'}. */
export const cancel = () => cancelFlow(FLOW);

/** Consent on LinkedIn's own page through the site. -> {ok: true, token, expiresIn} | {ok: false, error}. */
export async function connect(openExternal, {site = SITE, timeout = 5 * 60 * 1000} = {}) {
  const {state, result} = begin(FLOW, {timeout, timeoutError: 'LinkedIn didn\'t answer in 5 minutes. It works for LinkedIn members in the EU, EEA and Switzerland; otherwise use your LinkedIn data file.'});
  try { await openExternal(`${site}/api/linkedin-import/start?state=${state}`); } catch { fail(FLOW, 'Your browser could not be opened.'); }
  const answer = await result;
  if (!answer.ok) return answer;
  const {access_token: token = '', expires_in: expiresIn = ''} = answer.fields;
  return token ? {ok: true, token, expiresIn: Number(expiresIn) || 0} : {ok: false, error: 'LinkedIn did not send the key. Try again.'};
}

/** Keep the key (Keychain) and when it was made and ends (settings). -> {ok} | {ok: false, error}; the value is never in the answer. */
export function saveToken(storage, {token, expiresIn}, {keychain = realKeychain, now = new Date()} = {}) {
  if (!keychain.write(SERVICE, token, {account: ACCOUNT, label: 'Jobadabra: LinkedIn import'})) return {ok: false, error: 'The Keychain would not keep the LinkedIn key, so nothing was imported.'};
  const days60 = 60 * 24 * 3600;   // LinkedIn's documented lifetime, used when it says nothing
  storage.saveSettings({linkedinImport: {connectedAt: now.toISOString(), expiresAt: new Date(now.getTime() + (expiresIn || days60) * 1000).toISOString()}});
  return {ok: true};
}

/** What the window needs: whether a key is held and when it ends (never its value). An expired key is deleted here. */
export function state(storage, {keychain = realKeychain, now = new Date()} = {}) {
  const mine = storage.settings().linkedinImport;
  if (!mine?.expiresAt) return {connected: false};
  if (!(new Date(mine.expiresAt) > now)) { forget(storage, {keychain}); return {connected: false, expired: true}; }
  return {connected: true, connectedAt: mine.connectedAt, expiresAt: mine.expiresAt};
}
/** The key, only for a press of Import or Update; null when none or expired. */
export function readToken(storage, deps = {}) { return state(storage, deps).connected ? (deps.keychain || realKeychain).read(SERVICE, {account: ACCOUNT}) : null; }
function forget(storage, {keychain = realKeychain} = {}) { keychain.remove(SERVICE, {account: ACCOUNT}); storage.saveSettings({linkedinImport: null}); }

/** Disconnect: delete the key here and ask LinkedIn (through the site, which holds the secret) to end it. -> {ok: true, revoked}; LinkedIn's answer never blocks the delete. */
export async function disconnect(storage, {keychain = realKeychain, fetcher = globalThis.fetch, site = SITE} = {}) {
  const token = readToken(storage, {keychain});
  forget(storage, {keychain});
  let revoked = false;
  if (token) {
    try { revoked = (await (await fetcher(`${site}/api/linkedin-import/revoke`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token}), signal: AbortSignal.timeout(10000)})).json()).ok === true; } catch {}
  }
  return {ok: true, revoked};
}

const messageOf = async response => { const text = await response.text().catch(() => ''); try { const body = JSON.parse(text); return String(body.message || body.error_description || body.error || ''); } catch { return text.slice(0, 200); } };

// What LinkedIn's non-OK answer means -> the {ok: false, kind, error} fetchDomain returns (or the rows so far when "No data found" comes after a page). 401/403/429 are never retried by the caller.
async function refusal(response, rows) {
  const message = await messageOf(response);
  if (/No data found/i.test(message)) return rows.length ? {ok: true, rows} : {ok: false, kind: 'pending', error: 'LinkedIn has not prepared this yet.'};
  const known = {
    401: ['unauthorized', 'LinkedIn no longer accepts the saved sign-in. Import again.'], 403: ['unauthorized', 'LinkedIn no longer accepts the saved sign-in. Import again.'],
    429: ['rate', 'LinkedIn asked us to slow down. Try again later.'], 426: ['version', 'LinkedIn changed its API. Use your LinkedIn data file for now.'],
  }[response.status];
  return known ? {ok: false, kind: known[0], error: known[1]} : {ok: false, kind: 'error', error: `LinkedIn answered ${response.status}.`};
}

// Only LinkedIn's own next page of this endpoint, else '' (the read ends).
const nextPath = body => {
  const next = (body.paging?.links || []).find(link => link.rel === 'next')?.href;
  return typeof next === 'string' && next.startsWith('/rest/memberSnapshotData?') ? next : '';
};

/**
 * One domain's rows, every page. -> {ok: true, rows} | {ok: false, kind, error}; kind: pending (LinkedIn has not processed it yet: "No data found for this memberId"),
 * unauthorized (401/403: the key is no good), rate (429), version (426), error. Invariant: 401/403/429 are never retried.
 */
export async function fetchDomain(token, domain, {fetcher = globalThis.fetch} = {}) {
  const rows = [];
  let path = `/rest/memberSnapshotData?q=criteria&domain=${encodeURIComponent(domain)}`;
  for (let page = 0; page < MAX_PAGES && path; page++) {
    let response;
    try { response = await fetcher(API + path, {headers: {'Linkedin-Version': VERSION, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, signal: AbortSignal.timeout(30000)}); }
    catch { return {ok: false, kind: 'error', error: 'LinkedIn could not be reached.'}; }
    if (!response.ok) return refusal(response, rows);
    const body = await response.json().catch(() => ({}));
    for (const element of [].concat(body.elements || [])) if (element?.snapshotDomain === domain) rows.push(...(element.snapshotData || []));
    path = nextPath(body);
  }
  return {ok: true, rows};
}

/**
 * All five domains, asked one after the other (no burst); a domain that is still pending is asked again every `every` ms until `wait` ends.
 * -> {tables: {Positions.csv: rows, …}, status: {DOMAIN: 'ok'|'pending'|kind}, stopped?: kind}; stopped = a 401/403/429/426 ended the whole read.
 */
export async function fetchAll(token, {fetcher = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), wait = 90000, every = 5000, onProgress = () => {}} = {}) {
  const tables = {}, status = {};
  let todo = [...DOMAINS];
  for (let waited = 0; todo.length; waited += every) {
    const still = [];
    for (const domain of todo) {
      const got = await fetchDomain(token, domain, {fetcher});
      if (got.ok) { tables[FILE[domain]] = got.rows; status[domain] = 'ok'; onProgress(domain, 'ok'); continue; }
      status[domain] = got.kind; onProgress(domain, got.kind);
      if (['unauthorized', 'rate', 'version'].includes(got.kind)) return {tables, status, stopped: got.kind, error: got.error};
      if (got.kind === 'pending') still.push(domain);
    }
    todo = still;
    if (todo.length && waited + every <= wait) await sleep(every); else break;
  }
  return {tables, status};
}

/** The tables LinkedIn returned -> a CV in the app's schema (lib/linkedin-export.js, by structure). Throws what is missing, never guesses. */
export function toProfileCv(tables) {
  if (!tables['Positions.csv']?.length) throw new Error('LinkedIn returned no positions for this profile yet. Try Update in a few minutes, or use your LinkedIn data file.');
  return toCv(tables);
}
