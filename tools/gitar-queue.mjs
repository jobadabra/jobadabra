#!/usr/bin/env node
// The one queue every session on this Mac posts its "Gitar review" asks and replies to Gitar's threads through: one post at a time, oldest first, 5 minutes apart, and a refusal pauses all of them.
//   node tools/gitar-queue.mjs ask <owner/repo> <pr> <head-sha>      -> ASKED | QUEUED (position k, next ask ~hh:mm) | DROPPED (<why>)   (idempotent: call again each look)
//   node tools/gitar-queue.mjs reply <owner/repo> <pr> <comment-id> <body-file>    a reply in one of Gitar's inline threads (it counts as an ask)
//   node tools/gitar-queue.mjs drain | cancel <owner/repo> <pr> | status
// Design (13 Nov 2026, gq; owner, asked via AskUserQuestion: "One shared ask queue (Recommended)"): states are queued -> sent (or dropped); the one owner is this file's state.json under
//   ~/.claude/gitar-queue (GITAR_QUEUE_DIR), behind a mkdir lock; every ship-watch look calls `ask` again, which drains one due post, so no daemon is needed.
//   Verdicts that change a state: PR merged/closed or (for an ask) head moved -> dropped; Gitar's "wait about N minutes" on ANY queued PR (issue comment or inline thread, anyone's) -> every PR waits until it ends;
//   a refusal right after our own post -> the ask goes back to the front, a refused reply is deleted and goes back too (seen once, after the wait); an ask for a head already sent is never sent twice.
// Why (13 Nov 2026, coordinator, measured; owner's rule: one queue for the account): the limit is account-wide. #4037's first "Gitar review" (20:17:45), with zero comments of ours on it, was refused "wait about 20 minutes"
//   after #4035 took 4 replies at 20:12, #4033 an ask at 20:13:18 and #4032 at 20:13:48, 20:14:17 and 20:14:20; #4033's 20:19:19 ask was refused 74 s after its 20:18:05 one. #4031's replies at 20:05:05 and 20:06:39 drew
//   "wait about 30 minutes" 3 s later. A short burst passes at the start of a quiet window (#4030 and #4031 asked at 20:01:19/20:01:21, both accepted), and earlier that evening four asks on other repos were accepted
//   inside others' pauses (19:12-19:16), so the evidence is not clean: the queue is safe under both readings. The gap (GITAR_QUEUE_GAP_S, default 300) is the coordinator's 5 minutes "unless you measure better";
//   TODO(AI): tune the gap from the refusal rate once the queue has run for a week (13 Nov 2026).
import {mkdirSync, rmSync, readFileSync, writeFileSync, renameSync, statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join} from 'node:path';

const DIR = process.env.GITAR_QUEUE_DIR || join(homedir(), '.claude', 'gitar-queue');
const GH = process.env.GITAR_QUEUE_GH || 'gh';
const GAP = Number(process.env.GITAR_QUEUE_GAP_S ?? 300) * 1000;   // between any two posts of this Mac (13 Nov 2026, coordinator: "space asks across all PRs by a minimum gap; use 5 min unless you measure better")
const SETTLE = Number(process.env.GITAR_QUEUE_SETTLE_MS ?? 8000);   // Gitar's refusal arrives 3-5 s after the comment
let slept = 0;   // a pinned GITAR_QUEUE_NOW is a simulated clock: the settle wait advances it instead of waiting (tests)
const now = () => Number(process.env.GITAR_QUEUE_NOW) ? Number(process.env.GITAR_QUEUE_NOW) + slept : Date.now();
const sleep = ms => ms > 0 && Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const settle = ms => process.env.GITAR_QUEUE_NOW ? void (slept += ms) : sleep(ms);
const gh = args => { const r = spawnSync(GH, args, {encoding: 'utf8'}); return r.status === 0 ? r.stdout : null; };

/** Runs `fn` holding the queue's lock (a directory; one older than 2 min belongs to a dead process). */
function locked(fn) {
  mkdirSync(DIR, {recursive: true});
  const lock = join(DIR, 'lock');
  for (let tries = 0; ; tries++) {
    try { mkdirSync(lock); break; } catch {
      let old = false; try { old = Date.now() - statSync(lock).mtimeMs > 120000; } catch { /* released meanwhile */ }
      if (old) rmSync(lock, {recursive: true, force: true});
      else if (tries > 300) throw new Error('gitar-queue: lock busy for 30 s');
      else sleep(100);
    }
  }
  try { return fn(); } finally { rmSync(lock, {recursive: true, force: true}); }
}
const file = join(DIR, 'state.json');
const load = () => { try { return {entries: [], sent: [], dropped: {}, last: 0, ...JSON.parse(readFileSync(file, 'utf8'))}; } catch { return {entries: [], sent: [], dropped: {}, last: 0}; } };
const save = st => { st.sent = st.sent.slice(-300); writeFileSync(file + '.tmp', JSON.stringify(st, null, 1)); renameSync(file + '.tmp', file); };

const key = e => `${e.repo}#${e.pr}${e.kind === 'ask' ? '@' + e.head : '/' + e.commentId + ':' + createHash('sha1').update(e.body).digest('hex').slice(0, 8)}`;   // a reply is told apart by its comment and its words
const prInfo = (repo, pr) => { try { const j = JSON.parse(gh(['pr', 'view', String(pr), '-R', repo, '--json', 'state,headRefOid'])); return {state: j.state, head: j.headRefOid}; } catch { return null; } };
/** Gitar's "wait about N minutes" replies on the PR (issue comments and inline threads): [{at, until}] in ms. */
function refusals(repo, pr) {
  const out = [];
  for (const path of [`repos/${repo}/issues/${pr}/comments?per_page=100`, `repos/${repo}/pulls/${pr}/comments?per_page=100`]) {
    // Why (13 Nov 2026, #4031 live: GitHub's REST quota was 0 and gh printed nothing): JSON.parse(null) is null, not an error, so the loop below crashed every watcher's ask.
    let rows = []; try { rows = JSON.parse(gh(['api', path])) ?? []; } catch { /* an unreadable list says "not paused": the sent record still stops a second ask */ }
    for (const c of rows) {
      const m = /gitar/i.test(c.user?.login || '') && /Please wait about (\d+) minutes/.exec(c.body || '');
      if (m) { const at = Date.parse(c.created_at); out.push({at, until: at + Number(m[1]) * 60000}); }
    }
  }
  return out;
}
const pausedUntil = (e, t = 0) => Math.max(0, ...refusals(e.repo, e.pr).filter(r => r.at >= t).map(r => r.until));

function post(e) {
  if (e.kind === 'ask') return gh(['pr', 'comment', String(e.pr), '-R', e.repo, '--body', 'Gitar review']) !== null;
  const out = gh(['api', '-X', 'POST', `repos/${e.repo}/pulls/${e.pr}/comments/${e.commentId}/replies`, '-f', `body=${e.body}`]);
  try { e.postedId = JSON.parse(out).id; } catch { /* the id only serves to take a refused reply back */ }
  return out !== null;
}

/** Sends at most one due entry; drops entries of PRs that merged or closed. Returns nothing: the state says what happened. */
function drain(st) {
  const seen = new Map(); const info = e => { const k = `${e.repo}#${e.pr}`; if (!seen.has(k)) seen.set(k, prInfo(e.repo, e.pr)); return seen.get(k); };
  st.entries = st.entries.filter(e => {
    const i = info(e); if (!i) return true;
    const why = i.state !== 'OPEN' ? i.state.toLowerCase() : e.kind === 'ask' && e.head !== i.head ? 'head moved' : '';
    if (why) st.dropped[key(e)] = why;
    return !why;
  });
  if (st.last + GAP > now()) return;   // spacing first: no comment reads while it holds
  // Gitar's "wait N minutes" on ANY queued PR pauses every PR until it ends (account-wide: coordinator, 13 Nov 2026).
  const paused = new Map(); for (const e of st.entries) { const k = `${e.repo}#${e.pr}`; if (!paused.has(k)) paused.set(k, pausedUntil(e)); }
  st.until = Math.max(st.until || 0, ...paused.values());
  if (st.until > now()) return;
  for (const e of st.entries) {
    const t0 = now();   // Why (13 Nov 2026, Gitar on #4031): a refusal lands 3-5 s after the post, so it is looked for from just before the post, not from "now minus 5 s" after the settle wait
    if (!post(e)) { st.fail = key(e); return; }   // gh failed: the entry stays, the next look retries, and `ask`/`status` say so
    st.entries = st.entries.filter(x => x !== e); st.last = now(); delete st.fail;
    st.sent.push({key: key(e), at: now()});
    save(st); settle(SETTLE);
    // A refused ask or reply goes back to the front, so Gitar is not left without it (Gitar on #4031: a refused reply was lost). A refused reply is deleted first, so people see it once, after the wait.
    const refusedUntil = pausedUntil(e, t0 - 2000); st.until = Math.max(st.until || 0, refusedUntil);
    if (refusedUntil > now() && (e.kind === 'ask' || (e.postedId && gh(['api', '-X', 'DELETE', `repos/${e.repo}/pulls/comments/${e.postedId}`]) !== null))) { st.sent = st.sent.filter(s => s.key !== key(e)); delete e.postedId; st.entries.unshift(e); }
    return;
  }
}

/** When each queued entry will go, assuming no new refusal: [{e, at}]. */
function schedule(st) {
  let slot = Math.max(st.last + GAP, st.until || 0, now());
  return st.entries.map(e => { const at = slot; slot += GAP; return {e, at}; });
}
const hhmm = ms => new Date(ms).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'});

function ask(repo, pr, head) {
  const e = {kind: 'ask', repo, pr: Number(pr), head, queuedAt: now()};
  const st = load(); const k = key(e);
  if (!st.sent.some(s => s.key === k) && !st.entries.some(x => key(x) === k)) { st.entries.push(e); delete st.dropped[k]; save(st); }
  drain(st); save(st);
  if (st.sent.some(s => s.key === k)) return 'ASKED';
  if (st.dropped[k]) return `DROPPED (${st.dropped[k]})`;
  const i = schedule(st).findIndex(x => key(x.e) === k);
  return i < 0 ? 'DROPPED (not queued)' : `QUEUED (position ${i + 1}, next ask ~${hhmm(schedule(st)[i].at)}${st.fail ? `; the last post failed: ${st.fail}` : ''})`;
}

const [cmd, repo, pr, a, b] = process.argv.slice(2);
const out = locked(() => {
  const st = load();
  if (cmd === 'ask') return ask(repo, pr, a);
  if (cmd === 'reply') {
    const e = {kind: 'reply', repo, pr: Number(pr), commentId: a, body: readFileSync(b, 'utf8'), queuedAt: now()}, k = key(e);
    if (!st.sent.some(x => x.key === k) && !st.entries.some(x => key(x) === k)) st.entries.push(e);   // the same reply twice is one comment
    drain(st); save(st);
    if (st.sent.some(x => x.key === k)) return 'SENT';
    if (st.dropped[k]) return `DROPPED (${st.dropped[k]})`;
    const i = schedule(st).findIndex(x => key(x.e) === k);
    return i < 0 ? 'DROPPED (not queued)' : `QUEUED (position ${i + 1}, next ask ~${hhmm(schedule(st)[i].at)}${st.fail ? `; the last post failed: ${st.fail}` : ''})`;
  }
  if (cmd === 'cancel') { st.entries = st.entries.filter(e => !(e.repo === repo && e.pr === Number(pr))); save(st); return 'CANCELLED'; }
  if (cmd === 'drain') { drain(st); save(st); return `${st.entries.length} queued`; }
  if (cmd === 'status') return (schedule(st).map(({e, at}) => `${e.kind} ${key(e)} ~${hhmm(at)}`).join('\n') || 'empty') + (st.fail ? `\nthe last post failed: ${st.fail}` : '');
  throw new Error('usage: gitar-queue.mjs ask <owner/repo> <pr> <head> | reply <owner/repo> <pr> <comment-id> <body-file> | cancel <owner/repo> <pr> | drain | status');
});
console.log(out);
