// Tells the owner on Telegram when Microsoft finishes reviewing a Store submission (owner, 5 Nov 2026: "when Microsoft accepts a new release version, I'd like to get a message on telegram").
// Used by .github/workflows/msix-store-watch.yml; no AI, no new secret.
// Why (7 Nov 2026, owner: "Weekly, a fixed day"): it no longer sends the newest stable on after a verdict (the 5 Nov "Auto-send newest"): the next submission is the weekly one (msix-store-weekly.yml),
// from a stable that has run a day without a red; sending on at once made a submission after every review, whatever the day.
//   node tools/msix-store-watch.mjs pending                     -> version=<newest submitted, not yet announced | ''> on $GITHUB_OUTPUT
//   node tools/msix-store-watch.mjs decide <status.txt> <get.txt> -> verdict=live|failed|waiting|unknown, reason=<one line> on $GITHUB_OUTPUT
//   node tools/msix-store-watch.mjs tell                        (env VERSION, VERDICT, REASON, GH_TOKEN, GITHUB_REPOSITORY, CI_ALERTS_TELEGRAM_*)
//   node tools/msix-store-watch.mjs broken | recovered          (a failed check tells the owner once per broken streak; a green check ends the streak)
// State is git tags (owner, 2 Nov 2026): msstore-submitted-X.Y.Z (written by msix-store.yml after a good publish), msstore-announced-X.Y.Z (the verdict message went out),
// msstore-followed-X.Y.Z (X's message is out: X is no longer pending; msstore-autosent-X.Y.Z tags from before 7 Nov 2026 are left alone). A claim is created
// before its action, atomically (GitHub refuses a ref that exists), so a restart or a second run never repeats a message; a failed send releases its claim and X stays
// pending, so the next hour retries it. A runner that dies between a claim and its send loses that message (at most once); the 5-minute job cap and 15 s Telegram timeout make it rare.
// Invariants: a refused version is never sent again by this tool; nothing here submits or starts anything.
import fs from 'node:fs';
import {delivered, send as sendAlert} from '../desktop/e2e/ci-alert.mjs';

// Why (5 Nov 2026, nt 3/4c): the owner's switchboard may hold this alert (switched off): that is done, not a failed send, so the claim stays and nothing is retried hourly.
const send = (text, env) => sendAlert(text, env, fetch, {event: 'msstore-status'});

const APP_ID = '9NW1JJ7Z90MP';
const STORE_PAGE = `https://apps.microsoft.com/detail/${APP_ID}`;
const ansi = text => String(text || '').replace(/\x1b\[[0-9;]*m/g, '');

/** Semver compare of "X.Y.Z" strings: negative, 0 or positive. */
export const compareVersions = (a, b) => {
  const [x, y] = [a, b].map(v => v.split('.').map(Number));
  return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
};

/**
 * What `msstore submission status` says -> {verdict, status}. "Submission Status = <State>": Published (with no pending submission, "Last Published Submission") is live;
 * a state ending in Failed, or Canceled, is a refusal; any other state is still in review; no such line (sign-in error, API error) is unknown.
 */
export function decide(statusText) {
  const status = /Submission Status\s*[=-]\s*(\w+)/.exec(ansi(statusText))?.[1] || '';
  if (!status) return {verdict: 'unknown', status};
  if (status === 'Published') return {verdict: 'live', status};
  if (/Failed$|^Cancel/.test(status)) return {verdict: 'failed', status};
  return {verdict: 'waiting', status};
}

/**
 * The refusal's reason in words from `msstore submission get` (JSON of the submission): its statusDetails errors, one line. Anything else: the status name and where to look.
 * Never throws; the text is clipped so a Telegram message stays short.
 */
export function reasonOf(getText, status = '') {
  const text = ansi(getText), start = text.indexOf('{'), end = text.lastIndexOf('}');
  try {
    const details = JSON.parse(text.slice(start, end + 1)).statusDetails || {};
    const errors = [...(details.errors || []), ...(details.certificationReports || []).filter(r => r.reportUrl).map(r => ({details: `report ${r.reportUrl}`}))]
      .map(item => [item.code, item.details].filter(Boolean).join(': ')).filter(Boolean);
    if (errors.length) return errors.join(' · ').replace(/\s+/g, ' ').slice(0, 600);
  } catch { /* not JSON: fall through */ }
  return `Microsoft gave no reason in the API (status ${status || 'unknown'}); read it in Partner Center`;
}

/** The Telegram text: `kind` live | failed. */
export function messageOf(kind, {version, reason = '', run = '', repo = '', next = ''}) {
  if (kind === 'live') return `✅ Jobadabra ${version} is live in the Microsoft Store.\n${STORE_PAGE}`;
  if (kind === 'failed') {
    return `⚠️ Microsoft did not accept Jobadabra ${version}.\nWhy: ${reason}\nIt is not sent again by itself; the weekly run sends the next newer stable that passes. To retry this one once fixed: gh workflow run msix-store.yml -R ${repo} --ref main -f tag=desktop-v${version}\nRun: ${run}`;
  }
  throw new Error(`unknown message kind ${kind}`);
}

/** The GitHub API calls this tool makes, over `fetcher`: {tags(prefix), claim(name), release(name), releaseIfHeld(name)}. */
export function github(env = process.env, fetcher = fetch) {
  const base = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}`;
  const call = (path, init = {}) => fetcher(`${base}/${path}`, {...init, headers: {Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', ...(init.body ? {'Content-Type': 'application/json'} : {})}, signal: AbortSignal.timeout(20000)});
  const ok = async (answer, what) => { if (!answer.ok) throw new Error(`${what}: GitHub ${answer.status}`); return answer; };
  return {
    async tags(prefix) {
      const answer = await ok(await call(`git/matching-refs/tags/${prefix}`), `list ${prefix}`);
      return (await answer.json()).map(ref => ref.ref.slice(`refs/tags/${prefix}`.length)).filter(v => /^\d+\.\d+\.\d+$/.test(v));
    },
    /** true when this call created the tag, false when it already existed (someone else holds the claim). */
    async claim(name) {
      const answer = await call('git/refs', {method: 'POST', body: JSON.stringify({ref: `refs/tags/${name}`, sha: env.GITHUB_SHA})});
      // Why (5 Nov 2026, code review): a 422 also answers a tag ruleset that forbids creating tags; that is not a held claim and must be seen, not read as "someone else sent it".
      if (answer.status === 422 && /already exists/i.test(String((await answer.json().catch(() => ({}))).message))) return false;
      await ok(answer, `claim ${name}`);
      return true;
    },
    async release(name) { await ok(await call(`git/refs/tags/${name}`, {method: 'DELETE'}), `release ${name}`); },
    /**
     * Releases a claim that may not exist: a missing tag is fine.
     * Why (7 Nov 2026, msix-store-watch.yml red every hour): GitHub answers a DELETE of a tag that is not there with 422 "Reference does not exist", never 404 (measured with gh api);
     * only that message is read as "not held", so a refused delete (a tag ruleset) still shows.
     */
    async releaseIfHeld(name) {
      const answer = await call(`git/refs/tags/${name}`, {method: 'DELETE'});
      if (answer.status === 404) return;
      const message = answer.status === 422 ? String((await answer.json().catch(() => ({}))).message) : '';
      if (/^reference does not exist/i.test(message)) return;
      if (!answer.ok) throw new Error(`release ${name}: GitHub ${answer.status}${message ? ` (${message})` : ''}`);
    },
  };
}

/** Submitted versions not yet followed up (message and newest-stable step both done), newest last. */
export async function pendingVersions(gh) {
  const [submitted, followed] = await Promise.all([gh.tags('msstore-submitted-'), gh.tags('msstore-followed-')]);
  return submitted.filter(v => !followed.includes(v)).sort(compareVersions);
}

/** Sends `text`; a send that did not reach Telegram throws. */
async function tellOwner(text, env, sender) {
  const result = await sender(text, env);
  if (!delivered(result)) throw new Error(result);
}

/** One message under its claim: claimed, sent; a send that fails releases the claim and throws, so the next hour retries it. */
async function announce(gh, version, text, env, sender, what) {
  if (!await gh.claim(`msstore-announced-${version}`)) return false;
  try { await tellOwner(text, env, sender); }
  catch (error) {
    await gh.release(`msstore-announced-${version}`);
    throw new Error(`the ${what} message for ${version} did not reach Telegram (${error.message}); it is tried again next hour`);
  }
  return true;
}

/**
 * The verdict for `env.VERSION` (the version the status read was made for, from the pending job; never re-picked here): one message. Older versions still pending were finished before a newer one could be submitted: they get one honest note, no verdict.
 * The message has its own claim; the version leaves "pending" once it is out.
 * Returns the lines to print. `deps` = {gh, sender} for tests.
 */
export async function tell(env, deps = {}) {
  const gh = deps.gh || github(env), sender = deps.sender || send, out = [];
  const {VERDICT: verdict, REASON: reason = '', VERSION: version} = env;
  if (verdict !== 'live' && verdict !== 'failed') return ['nothing to tell: still in review'];
  const run = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const pending = await pendingVersions(gh);
  if (!version || !pending.includes(version)) return [`nothing to tell: ${version || 'no version'} is not pending`];
  const older = pending.filter(v => compareVersions(v, version) < 0);
  for (const old of older) {
    if (await announce(gh, old, `ℹ️ Jobadabra ${old} left Microsoft's review before I could read its verdict (${version} was submitted after it). Check Partner Center if you need to know whether it was accepted.`, env, sender, 'review-ended')) out.push(`told the owner: ${old} left review, verdict not read`);
  }
  if (await announce(gh, version, messageOf(verdict === 'live' ? 'live' : 'failed', {version, reason, run, repo: env.GITHUB_REPOSITORY}), env, sender, verdict)) out.push(`told the owner: ${version} ${verdict}`);
  else out.push(`${version} was already announced`);
  for (const done of [...older, version]) await gh.claim(`msstore-followed-${done}`);
  return out;
}

const BROKEN = 'msstore-watch-broken';

/**
 * A check that failed (sign-in, status unreadable, a send or dispatch error): one Telegram message per broken streak, claimed by the tag `msstore-watch-broken` until a green check clears it.
 * Why (5 Nov 2026, Gitar on #3196): the hourly start is exempt from the Worker's and watchdog's pages, so without this a broken Partner Center sign-in would fail 24 times a day in silence.
 */
export async function broken(env, deps = {}) {
  const gh = deps.gh || github(env), sender = deps.sender || send;
  if (!await gh.claim(BROKEN)) return ['already told: the Store watcher is still failing'];
  const run = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  try { await tellOwner(`⚠️ The Microsoft Store watcher is failing, so no "accepted" message will come until it is fixed.\nRun: ${run}\nIt tells you once; it is quiet again after a green check.`, env, sender); }
  catch (error) { await gh.release(BROKEN); throw new Error(`the watcher-broken message did not reach Telegram (${error.message}); it is tried again next hour`); }
  return ['told the owner: the Store watcher is failing'];
}

/** A green check ends the broken streak, so the next failure tells again. */
export async function recovered(env, deps = {}) {
  await (deps.gh || github(env)).releaseIfHeld(BROKEN);
  return ['broken streak cleared'];
}

const write = (key, value) => { const line = `${key}=${String(value).replace(/\s+/g, ' ')}`; console.log(line); if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`); };

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [command, statusFile, getFile] = process.argv.slice(2);
  if (command === 'pending') write('version', (await pendingVersions(github())).pop() || '');
  else if (command === 'decide') {
    const {verdict, status} = decide(fs.readFileSync(statusFile, 'utf8'));
    write('verdict', verdict);
    write('reason', verdict === 'failed' ? reasonOf(getFile && fs.existsSync(getFile) ? fs.readFileSync(getFile, 'utf8') : '', status) : '');
  } else if (command === 'tell') {
    try { for (const line of await tell(process.env)) console.log(line); }
    catch (error) { console.error(error.message); process.exit(1); }
  } else if (command === 'broken' || command === 'recovered') {
    try { for (const line of await (command === 'broken' ? broken : recovered)(process.env)) console.log(line); }
    catch (error) { console.error(error.message); process.exit(1); }
  } else { console.error('usage: msix-store-watch.mjs pending | decide <status.txt> <get.txt> | tell | broken | recovered'); process.exit(2); }
}
