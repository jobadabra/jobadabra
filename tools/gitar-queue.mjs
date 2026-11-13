#!/usr/bin/env node
// The one queue every session on this Mac posts its "Gitar review" asks and replies to Gitar's threads through: one post at a time, oldest first, 11 minutes apart, and a refusal pauses all of them.
//   node tools/gitar-queue.mjs ask <owner/repo> <pr> <head-sha>      -> ASKED | QUEUED (position k, next ask ~hh:mm) | HELD (<why>) | DROPPED (<why>)   (idempotent: call again each look)
//   node tools/gitar-queue.mjs reply <owner/repo> <pr> <comment-id> <body-file>    a reply in one of Gitar's inline threads (it counts as an ask)
//   node tools/gitar-queue.mjs drain | cancel <owner/repo> <pr> | status
// Design (13 Nov 2026, gq; owner, asked via AskUserQuestion: "One shared ask queue (Recommended)"): states are queued -> sent (or dropped); the one owner is this file's state.json under
//   ~/.claude/gitar-queue (GITAR_QUEUE_DIR), behind a mkdir lock; every ship-watch look calls `ask` again, which drains one due post, so no daemon is needed.
//   Verdicts that change a state: PR merged/closed or (for an ask) head moved -> dropped; Gitar's "wait about N minutes" on ANY open PR of a repo the queue knows (issue comment or inline thread, anyone's, queued or not) -> every PR waits until it ends; a draft or a "DONT MERGE" PR is HELD (takes no slot) and re-enters when that changes;
//   a refusal right after our own post -> the ask goes back to the front, a refused reply is deleted and goes back too (seen once, after the wait); an ask for a head already sent is never sent twice.
// Why (13 Nov 2026, coordinator, measured; owner's rule: one queue for the account): the limit is account-wide. #4037's first "Gitar review" (20:17:45), with zero comments of ours on it, was refused "wait about 20 minutes"
//   after #4035 took 4 replies at 20:12, #4033 an ask at 20:13:18 and #4032 at 20:13:48, 20:14:17 and 20:14:20; #4033's 20:19:19 ask was refused 74 s after its 20:18:05 one. #4031's replies at 20:05:05 and 20:06:39 drew
//   "wait about 30 minutes" 3 s later. A short burst passes at the start of a quiet window (#4030 and #4031 asked at 20:01:19/20:01:21, both accepted), and earlier that evening four asks on other repos were accepted
//   inside others' pauses (19:12-19:16), so the evidence is not clean: the queue is safe under both readings. Later that hour ea's single ask at 20:50:03 was refused "wait about 10 minutes" after only 2 asks at 20:40:00 and 20:40:03: 3 asks in 10 minutes get refused, so the gap (GITAR_QUEUE_GAP_S, default 660) is one ask per 11 minutes;
//   TODO(AI): tune the gap from the refusal rate once the queue has run for a week (13 Nov 2026).
import {mkdirSync, rmSync, readFileSync, writeFileSync, renameSync, statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join} from 'node:path';

const DIR = process.env.GITAR_QUEUE_DIR || join(homedir(), '.claude', 'gitar-queue');
const GH = process.env.GITAR_QUEUE_GH || 'gh';
const GAP = Number(process.env.GITAR_QUEUE_GAP_S ?? 660) * 1000;   // between any two posts of this Mac: 11 min (13 Nov 2026, coordinator, measured: 3 asks in 10 min get refused; ea's ask at 20:50:03 after 2 at 20:40:00/20:40:03 drew "wait about 10 minutes")
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
/** The PR's state, head, draft flag and title; null when gh cannot say. */
const prInfo = (repo, pr) => {
  try {
    const j = JSON.parse(gh(['pr', 'view', String(pr), '-R', repo, '--json', 'state,headRefOid,isDraft,title']));
    return {state: j.state, head: j.headRefOid, draft: !!j.isDraft, title: j.title || ''};
  } catch { return null; }
};
/** Why a queued entry must not spend a slot now ('' = it may go). Why (13 Nov 2026, coordinator): the queue's 11-minute slots go only to PRs that can become ready: not a draft, not "DONT MERGE"; it re-enters on its own when that changes.
 *  Why (13 Nov 2026, owner "Cut back", after 5 Gitar rounds): no verdict is guessed from the checks; only plain GitHub fields hold an entry. */
const holdReason = (e, i) => !i ? '' : i.draft ? 'draft' : /DONT MERGE/.test(i.title) ? 'DONT MERGE' : '';
/** Gitar's "wait about N minutes" replies on every open PR of the repo (issue comments and inline threads, newest of each): [{pr, at, until}] in ms. One GraphQL read per repo.
 *  Why (13 Nov 2026, coordinator; #4042 drew "wait about 40 minutes" at 21:08:37 while it was not queued): the limit is the account's, so a refusal on a PR the queue never saw still pauses it. */
// Why (13 Nov 2026, Gitar on #4053): a refusal is one of the newest comments, but ship events and labels push it out of a window of 5; 100 PRs x (30 + 30x10) nodes stays far under GitHub's node limit.
const QUERY = 'query($q:String!){search(query:$q,type:ISSUE,first:100){issueCount nodes{... on PullRequest{number comments(last:30){nodes{author{login} createdAt body}} reviewThreads(last:30){nodes{comments(last:10){nodes{author{login} createdAt body}}}}}}}}';
function refusals(repo) {
  const out = [];
  // Why (13 Nov 2026, #4031 live: GitHub's REST quota was 0 and gh printed nothing): JSON.parse(null) is null, not an error, so a read must say "no refusals" instead of crashing every watcher's ask.
  // Why (13 Nov 2026, Gitar on #4058): an unreadable list (quota, 5xx, GraphQL errors) is not "no refusal": it marks the result `unreadable` and the drain posts nothing on that look.
  let nodes = []; try {
    const search = JSON.parse(gh(['api', 'graphql', '-f', `query=${QUERY}`, '-f', `q=repo:${repo} is:pr is:open sort:updated-desc`]))?.data?.search;
    if (!search?.nodes) out.unreadable = true;
    nodes = search?.nodes ?? [];
    if (search?.issueCount > nodes.length) console.error(`gitar-queue: ${repo} has ${search.issueCount} open PRs, only the ${nodes.length} most recently updated are read for a refusal`);
  } catch { out.unreadable = true; }
  for (const n of nodes) {
    const rows = [...(n.comments?.nodes ?? []), ...(n.reviewThreads?.nodes ?? []).flatMap(t => t.comments?.nodes ?? [])];
    for (const c of rows) {
      const m = /gitar/i.test(c.author?.login || '') && /Please wait about (\d+) minutes/.exec(c.body || '');
      if (m) { const at = Date.parse(c.createdAt); out.push({pr: n.number, at, until: at + Number(m[1]) * 60000}); }
    }
  }
  return out;
}
const latest = rs => Math.max(0, ...rs.map(r => r.until));

function post(e) {
  if (e.kind === 'ask') return gh(['pr', 'comment', String(e.pr), '-R', e.repo, '--body', 'Gitar review']) !== null;
  const out = gh(['api', '-X', 'POST', `repos/${e.repo}/pulls/${e.pr}/comments/${e.commentId}/replies`, '-f', `body=${e.body}`]);
  try { e.postedId = JSON.parse(out).id; } catch { /* the id only serves to take a refused reply back */ }
  return out !== null;
}

/** What holds each queued entry: Map key -> reason (see holdReason). One `gh pr view` per PR. */
function holdsOf(st, info) { const m = new Map(); for (const e of st.entries) { const r = holdReason(e, info(e)); if (r) m.set(key(e), r); } return m; }
const infoCache = () => { const seen = new Map(); return e => { const k = `${e.repo}#${e.pr}`; if (!seen.has(k)) seen.set(k, prInfo(e.repo, e.pr)); return seen.get(k); }; };

/** Sends at most one due entry; drops entries of PRs that merged or closed. Returns nothing: the state says what happened. */
function drain(st) {
  const info = infoCache();
  st.entries = st.entries.filter(e => {
    const i = info(e); if (!i) return true;
    const why = i.state !== 'OPEN' ? i.state.toLowerCase() : e.kind === 'ask' && e.head !== i.head ? 'head moved' : '';
    if (why) st.dropped[key(e)] = why;
    return !why;
  });
  if (st.last + GAP > now()) return;   // spacing first: no comment reads while it holds
  // Gitar's "wait N minutes" on ANY open PR of a queued repo pauses every PR until it ends (account-wide: coordinator, 13 Nov 2026); sent repos of the last 2 h count too.
  const held = holdsOf(st, info);
  if (st.entries.every(e => held.has(key(e)))) return;   // Why (13 Nov 2026, Gitar on #4058): nothing can post, so the 100-PR refusal read is skipped on every watcher look
  const repos = new Set([...st.entries.map(e => e.repo), ...st.sent.filter(x => x.at > now() - 7200000).map(x => x.key.split('#')[0])]);
  const reads = [...repos].map(r => refusals(r));
  st.until = Math.max(st.until || 0, ...reads.map(latest));
  if (st.until > now() || reads.some(r => r.unreadable)) return;   // an unreadable list is not "no refusal": nothing is posted on this look, the next one retries (Gitar on #4058)
  for (const e of st.entries) {
    if (held.has(key(e))) continue;
    const t0 = now();   // Why (13 Nov 2026, Gitar on #4031): a refusal lands 3-5 s after the post, so it is looked for from just before the post, not from "now minus 5 s" after the settle wait
    if (!post(e)) { st.fail = key(e); return; }   // gh failed: the entry stays, the next look retries, and `ask`/`status` say so
    st.entries = st.entries.filter(x => x !== e); st.last = now(); delete st.fail;
    st.sent.push({key: key(e), at: now()});
    save(st); settle(SETTLE);
    // A refused ask or reply goes back to the front, so Gitar is not left without it (Gitar on #4031: a refused reply was lost). A refused reply is deleted first, so people see it once, after the wait.
    // Why (13 Nov 2026, Gitar on #4053): the pause is account-wide, but only a refusal on THIS PR means this post was refused; another PR's refusal must not re-post it.
    const fresh = refusals(e.repo).filter(r => r.at >= t0 - 2000), refusedUntil = latest(fresh.filter(r => r.pr === e.pr));
    st.until = Math.max(st.until || 0, latest(fresh));
    if (refusedUntil > now() && (e.kind === 'ask' || (e.postedId && gh(['api', '-X', 'DELETE', `repos/${e.repo}/pulls/comments/${e.postedId}`]) !== null))) { st.sent = st.sent.filter(s => s.key !== key(e)); delete e.postedId; st.entries.unshift(e); }
    return;
  }
}

/** When each queued entry will go, assuming no new refusal: [{e, at, hold}]; a held entry takes no slot. */
function schedule(st) {
  const held = holdsOf(st, infoCache());
  let slot = Math.max(st.last + GAP, st.until || 0, now());
  return st.entries.map(e => { if (held.has(key(e))) return {e, hold: held.get(key(e))}; const at = slot; slot += GAP; return {e, at}; });
}
/** The word a caller reads for one queued entry: HELD (why) or QUEUED (position k among the entries that can go, next ask ~hh:mm). */
function placed(st, k) {
  const sch = schedule(st), x = sch.find(y => key(y.e) === k);
  if (!x) return 'DROPPED (not queued)';
  if (x.hold) return `HELD (${x.hold}: it goes when that changes)`;
  return `QUEUED (position ${sch.filter(y => !y.hold).indexOf(x) + 1}, next ask ~${hhmm(x.at)}${st.fail ? `; the last post failed: ${st.fail}` : ''})`;
}
const hhmm = ms => new Date(ms).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'});

function ask(repo, pr, head) {
  const e = {kind: 'ask', repo, pr: Number(pr), head, queuedAt: now()};
  const st = load(); const k = key(e);
  if (!st.sent.some(s => s.key === k) && !st.entries.some(x => key(x) === k)) { st.entries.push(e); delete st.dropped[k]; save(st); }
  drain(st); save(st);
  if (st.sent.some(s => s.key === k)) return 'ASKED';
  if (st.dropped[k]) return `DROPPED (${st.dropped[k]})`;
  return placed(st, k);
}

const [cmd, repo, pr, a, b] = process.argv.slice(2);
const out = locked(() => {
  const st = load();
  if (cmd === 'ask') return ask(repo, pr, a);
  if (cmd === 'reply') {
    const e = {kind: 'reply', repo, pr: Number(pr), commentId: a, body: readFileSync(b, 'utf8'), queuedAt: now()}, k = key(e);
    if (!st.sent.some(x => x.key === k) && !st.entries.some(x => key(x) === k)) { st.entries.push(e); delete st.dropped[k]; }   // the same reply twice is one comment; a stale drop record must not outlive a re-queue (Gitar on #4031)
    drain(st); save(st);
    if (st.sent.some(x => x.key === k)) return 'SENT';
    if (st.dropped[k]) return `DROPPED (${st.dropped[k]})`;
    return placed(st, k);
  }
  if (cmd === 'cancel') { st.entries = st.entries.filter(e => !(e.repo === repo && e.pr === Number(pr))); save(st); return 'CANCELLED'; }
  if (cmd === 'drain') { drain(st); save(st); return `${st.entries.length} queued`; }
  if (cmd === 'status') return (schedule(st).map(({e, at, hold}) => `${e.kind} ${key(e)} ${hold ? `held (${hold})` : `~${hhmm(at)}`}`).join('\n') || 'empty') + (st.fail ? `\nthe last post failed: ${st.fail}` : '');
  throw new Error('usage: gitar-queue.mjs ask <owner/repo> <pr> <head> | reply <owner/repo> <pr> <comment-id> <body-file> | cancel <owner/repo> <pr> | drain | status');
});
console.log(out);
