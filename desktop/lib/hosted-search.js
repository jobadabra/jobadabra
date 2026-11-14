// Hosted Always on, the app's side (private spec jobadabra-lab:docs/specs/2026-10-16-hosted-always-on.md §2, §4b): "Search for me every day" runs on our servers while the Mac is off.
// The app sets the schedule (with the e-mail), pushes the profile and search settings, pulls the matches that arrived (the inbox) into this Mac's own store, and exports or deletes
// what we hold. The install's own key (the one Free AI uses) is the only credential. Settings: settings.hostedSearch. Guard: test/unit/main/hosted-search.test.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {FREE_BASE, TRIAL_KEY, isFreeKey} from './ai-free.js';
import {siteOffForUser} from './recipes.js';
import {cadence} from './cadence.js';
import {isTwin} from './twin.js';

const BASE = FREE_BASE.replace(/\/api\/ai$/, '');
const EVERY = 10 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const keyOf = storage => storage.secret(TRIAL_KEY) || (/^JPF1\./.test(storage.secret('ANTHROPIC_API_KEY') || '') ? storage.secret('ANTHROPIC_API_KEY') : '');
// Whether this install can run Always on at all: it holds the in-house key (Free AI or Pro) and the site is not switched off for it. No offer is made when not (spec 2026-11-02-always-on-moments-design.md).
export const canRun = storage => { const key = keyOf(storage); return !!key && isFreeKey(key) && !siteOffForUser(); };
/** This install's Always on state from its settings: {on, skipped, email, after?, copiedAt?, ...}. Never reads the site, and holds no news answer (the site keeps those). */
export const state = storage => ({on: false, skipped: false, email: '', ...storage.settings().hostedSearch});
const save = (storage, patch) => storage.saveSettings({hostedSearch: {...state(storage), ...patch}});

export const UNAVAILABLE = 'Always on is not available just now.';   // the line when the site gave no reason of its own (lib/ready-site.js tells them apart)
const NO_KEY = 'Always on needs a regular install with its key.';
export const TWIN_NO_WRITE = 'The live-test twin never changes Always on on our servers.';
// Why (14 Nov 2026, lg; owner: "Fix it here"): the twin runs on a copy of the owner's folder with the owner's install key, so its start pushed the owner's
// profile and schedule to our servers (13:03Z). On Always on's routes it only reads, and may press Test (the owner's own press: "use twin", 14 Nov 2026);
// config, schedule and data writes are refused before any request. Ready to send's routes stay as they were (the owner's yes of 17 Oct, docs/live-test.md).
const ALWAYS_ON = /^\/api\/hosted\//;   // every Always on route, written as a pattern so a new write route is covered too
const twinMayNot = (route, method) => isTwin() && method !== 'GET' && ALWAYS_ON.test(route) && route !== '/api/hosted/test';
/** One call to the site with the install key. -> {ok, ...answer} or {ok: false, status?, error}. Invariant: a twin sends no Always on write but Test. */
export async function call(storage, route, {method = 'GET', body, fetcher = globalThis.fetch, key: given, headers = {}} = {}) {
  const key = given || keyOf(storage);   // `key`: one minted for an install that runs on its own engine (lib/ready-site.js)
  if (!key || !isFreeKey(key) || siteOffForUser()) return {ok: false, error: NO_KEY};
  if (twinMayNot(route, method)) return {ok: false, error: TWIN_NO_WRITE};
  try {
    const response = await fetcher(`${BASE}${route}`, {method, headers: {'x-api-key': key, 'Content-Type': 'application/json', ...headers}, ...(body ? {body: JSON.stringify(body)} : {})});
    const text = await response.text(), json = (() => { try { return JSON.parse(text); } catch { return {}; } })();
    return response.ok ? {ok: true, ...json} : {ok: false, status: response.status, error: json.error || UNAVAILABLE};
  } catch { return {ok: false, error: 'Could not reach Jobadabra just now. Check your connection.'}; }
}

// Whether our servers take a schedule yet: the site answers 404 while Always on is switched off there (HOSTED_ALWAYS_ON). Only a real HTTP answer counts and is remembered (10 minutes, per key);
// no answer (offline, a hang past 4 s) or an install that cannot call the site is "open" and is asked again next time, so a bad connection never claims "Not open yet" nor hides a closed site for long.
// Why (4 Nov 2026, owner): the choice card shows "Not open yet" for a way that cannot run, and is not pickable.
let openAt = 0, openNow = true, openFor = '';
const HANG = 4000;
/** Whether our servers take a schedule yet: `true` unless the site answered 404 for Always on (asked at most every 10 minutes per key; no HTTP answer, a hang past 4 s or a key that cannot call the site counts as open and is not remembered). `now` is for tests. */
export async function isOpen(storage, options = {}, now = Date.now()) {
  const who = keyOf(storage) || '';
  if (who === openFor && now - openAt < 10 * 60 * 1000) return openNow;
  const got = await Promise.race([call(storage, '/api/hosted/schedule', options), new Promise(resolve => setTimeout(() => resolve({ok: false}), HANG).unref?.())]);
  if (!got.status && !got.ok) return true;   // no HTTP answer: unknown, not remembered
  openNow = got.status !== 404; openAt = now; openFor = who;
  return openNow;
}

// What the hosted run reads: the search settings and the profile text as they are on this Mac. (The CV file is not sent: the profile is what the search scores against.)
export function config(storage) {
  const read = name => { try { return fs.readFileSync(storage.path(name), 'utf8'); } catch { return ''; } };
  let search = {};
  try { search = JSON.parse(read('config/search.json')); } catch { /* none yet: the wizard saves it before this step */ }
  return {search, profile: read('profile.md'), cv: ''};
}
// A good copy is remembered with its time: the card says when the profile was last copied to our servers (owner, 27 Oct 2026).
export async function pushConfig(storage, options) {
  const done = await call(storage, '/api/hosted/config', {method: 'PUT', body: config(storage), ...options});
  if (done.ok) save(storage, {copiedAt: new Date().toISOString()});
  return done;
}

// "How often" (Settings → How often, hours between searches; 0 = off) as the cloud's schedule. Why (ap 2/6, 11 Nov 2026, owner: "replicate the entire functionality/settings on the Always on"): the hours never left this Mac, so the cloud
// always ran at the site's default. The site owns the schedule and clamps it (Pro 4-24 h; a trial stays daily by the site's cost design, shared/hosted.js): this only says what the person chose. `{}` when How often is Off.
// Why (code review, 11 Nov 2026): Off is the Mac's schedule and does not pause the cloud: the site has no "pause" short of `on: false` (Always on's own switch, which is the person's call), so an Off after hours were sent leaves the site on its last hours. `pushSchedule` says so (`off: true`) instead of looking like a push.
export const hoursOf = storage => { const hours = Number(cadence(storage.settings()).search); return hours > 0 ? {freqHours: hours} : {}; };

// Sends the chosen hours to the site's schedule and remembers which hours it took. -> {ok, skipped?, error?}. Nothing to send while Always on is off; unchanged hours send nothing.
export async function pushSchedule(storage, options = {}) {
  const wanted = hoursOf(storage);
  if (!state(storage).on) return {ok: true, skipped: true};
  if (!wanted.freqHours) return {ok: true, skipped: true, off: true};   // see hoursOf: Off never reaches the cloud
  if (state(storage).hoursSent === wanted.freqHours) return {ok: true, skipped: true};
  const done = await call(storage, '/api/hosted/schedule', {method: 'PUT', body: {on: true, ...wanted}, ...options});
  if (done.ok) save(storage, {hoursSent: wanted.freqHours});
  return done;
}

// Turn on: the schedule (the e-mail makes the trial account), then the config. -> {ok, error?}
export async function turnOn(storage, {email}, options = {}) {
  const address = String(email || '').trim();
  if (!EMAIL.test(address)) return {ok: false, error: 'Enter an email address like you@example.com.'};
  const set = await call(storage, '/api/hosted/schedule', {method: 'PUT', body: {on: true, email: address, ...hoursOf(storage)}, ...options});
  if (!set.ok) return set;
  save(storage, {on: true, skipped: false, email: address, after: state(storage).after || 0, hoursSent: hoursOf(storage).freqHours || 0});
  const pushed = await pushConfig(storage, options);
  return pushed.ok ? {ok: true} : {ok: true, warning: 'On, but your profile was not sent yet; it is sent again at the next start.'};
}

// Turn off: the schedule stops and everything we hold is deleted at once (the person's own words in the wizard: "turn it off anytime and it's deleted").
export async function turnOff(storage, options = {}) {
  if (!state(storage).on) { save(storage, {skipped: true}); return {ok: true, receipt: null}; }   // never turned on here (Skip in the wizard): nothing to delete, no call to the site
  return erase(storage, options);
}

// Delete my data, at any time, also while Always on is off (owner, 27 Oct 2026: "give at any time this option. But also when the user disabled the
// 'Always on'"): our servers are asked even when this Mac thinks nothing is there (an earlier install, a delete that failed). 401 = no account there: nothing held.
// -> {ok, receipt?, nothing?, error?}
export async function deleteData(storage, options = {}) {
  if (!keyOf(storage) && !options.key) return {ok: true, nothing: true};   // no install key: this Mac never sent anything
  return erase(storage, options);
}
async function erase(storage, options) {
  const gone = await call(storage, '/api/hosted/data', {method: 'DELETE', ...options});
  if (!gone.ok && gone.status !== 401) return gone;
  await call(storage, '/api/hosted/schedule', {method: 'PUT', body: {on: false}, ...options});
  save(storage, {on: false, skipped: true, after: 0, copiedAt: '', hoursSent: 0, deletedAt: new Date().toISOString()});
  return {ok: true, receipt: gone.receipt || null};
}

// The server's schedule for this install (state, why it paused, the next run): null when it has none or cannot be reached.
export async function schedule(storage, options = {}) {
  const got = await call(storage, '/api/hosted/schedule', options);
  return got.ok ? got.schedule || null : null;
}

// "Download my hosted data": the JSON we hold, written to `file`.
export async function exportTo(storage, file, options = {}) {
  const got = await call(storage, '/api/hosted/export', options);
  if (!got.ok) return got;
  const data = {...got};
  delete data.ok;
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
  return {ok: true, file};
}

// Test on our servers (owner, 4 Nov 2026: "the test button should be both for easiest (our servers) and for Advanced"; 5 Nov: "One real run"): one real run now, the site's POST /api/hosted/test,
// then its steps read back in the shape the Test row already draws (renderer/pages/always-on-test.js). -> {ok, run} or {ok: false, error}.
export const testStart = (storage, options = {}) => call(storage, '/api/hosted/test', {method: 'POST', ...options});

/** The run's steps from the site, as the Test row reads them: {found, verdict: running | passed | failed, steps: [{id, title, state, line}], runId, url}. A failed read keeps the ticks already shown. */
export async function testRead(storage, runId, options = {}) {
  const got = await call(storage, `/api/hosted/test${runId ? `?run=${encodeURIComponent(runId)}` : ''}`, options);
  if (!got.ok) {
    // Why (5 Nov 2026, Gitar on #3199): a 4xx (revoked key, unknown run, a closed route) or the local no-key refusal never clears by polling: end the test with the reason now.
    // Only "no answer" (offline), 408, 429 and 5xx are worth another poll.
    const lasting = got.status ? got.status >= 400 && got.status < 500 && got.status !== 408 && got.status !== 429 : got.error === NO_KEY;
    return lasting ? {found: true, verdict: 'failed', steps: [], url: '', error: got.error} : {found: false, verdict: 'running', steps: [], url: '', error: got.error};
  }
  const run = got.run;
  if (!run) return {found: false, verdict: 'running', steps: [], url: ''};
  const steps = (run.steps || []).map(step => ({id: step.key, title: step.label, state: step.state, line: step.state === 'failed' || step.state === 'skipped' ? step.note || '' : step.note && step.key === 'found' ? `${step.note} new` : '', settings: step.settings === true}));   // settings: the site asks for the "Check your notification settings" link beside this step (owner, 5 Nov 2026)
  const verdict = run.status === 'running' ? 'running' : run.status === 'ok' && steps.every(step => step.state !== 'failed') ? 'passed' : 'failed';
  return {found: true, verdict, steps, url: '', runId: run.id, search: searchOf(run.search)};
}

/** The first search the Test started, apart from the verdict (the site answers the verdict in about 10 s and the search later): {state: running | ok | failed, found, note} or null when the site sends none (an older site: the verdict then waits for the search itself). */
function searchOf(search) {
  if (!search || typeof search !== 'object') return null;
  const state = search.status === 'ok' ? 'ok' : search.status === 'failed' ? 'failed' : 'running';
  const note = (search.steps || []).find(step => step.state === 'failed' && step.note)?.note || '';
  return {state, found: Number.isFinite(search.found) ? search.found : 0, note};
}

// Pull what arrived while this Mac was off into its own store (the engine adds the rows: src/hosted_run.py --merge). -> {ok, added}
export async function pullInbox(storage, runEngine, options = {}) {
  if (!state(storage).on) return {ok: true, added: 0};
  const got = await call(storage, `/api/hosted/inbox?after=${state(storage).after || 0}`, options);
  if (!got.ok) return got;
  const matches = got.matches || [];
  if (!matches.length) return {ok: true, added: 0};
  const file = path.join(os.tmpdir(), `jp-hosted-inbox-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(matches));
  try {
    const {code, stdout} = await runEngine(['src', 'hosted', '--merge', file]);
    if (code !== 0) return {ok: false, error: 'Could not add the new matches just now.'};
    save(storage, {after: Math.max(...matches.map(match => match.id)), lastPullAt: new Date().toISOString()});
    return {ok: true, added: Number(/(\d+) new matches added/.exec(stdout || '')?.[1] || 0), arrived: matches.length};
  } finally { fs.rmSync(file, {force: true}); }
}

// At start and every few minutes while the app is open (an inbox pull is also the app contact that keeps the 14-day pause away).
export function keepFresh(storage, runEngine, onAdded = () => {}, options) {
  const tick = () => pullInbox(storage, runEngine, options).then(done => { if (done.added) onAdded(done); }).catch(() => {});
  tick();
  setInterval(tick, EVERY).unref();
}
