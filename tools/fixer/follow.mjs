// The trusted `follow` job of the AI fixer (ai-fixer-follow.yml): watches the fixer's draft PR with tools/ship-watch.sh (the ONE definition of READY, RED, COMMENT and CONFLICT) until an event needs a round of the agent, or the run must end (4 Nov 2026, [hm] 4/7; spec 2026-11-03-ai-fixer-core-design.md "Amendment 4 Nov 2026").
//   node follow.mjs watch --pr N --round R --deadline T [--last-key H]   -> $GITHUB_OUTPUT: action = round | ready | stop | end, plus kind/key/reason; a round also writes $RUNNER_TEMP/round/round.json (the event as scrubbed data)
//   node follow.mjs stop --pr N --round R --reason <word>                  the one stop comment (used by `after` when a round failed)
// Trust: no AI, no id-token, no App token; it runs main's code only. It reads other people's text, scrubs and cuts it and writes it to a file; it never runs it and never puts it in a path, branch, flag or command. All effects go through `io`, so a scripted test plays whole runs.
import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {scrub} from '../context/lib.mjs';
import {BRANCH, STOPS, checkTarget, classify, failureKey, firstErrorLine, stopReason, stopText} from './driver.mjs';

const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
const MARK = '<!-- ai-fixer-stop -->', LOG_BYTES = 24000, TEXT_BYTES = 12000;
const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : '');

/**
 * The follow loop. `io`: {pr() -> the PR (REST), lines() -> async iterable of ship-watch's log lines, failedLog(check, head) -> text, items() -> {items, answeredAt, gitarOpen, owner},
 * say(text) posts the stop/ready comment once, label() sets the Gitar "working" label, telegram(text), out(key, value), writeRound(obj), setStop() stops the watcher}. -> the action taken.
 * Why (4 Nov 2026, owner: "a max timeout of 1h"; "resolving all the checks, all the PR comments"): every exit says why, once, on the PR.
 */
export async function runFollow({round, deadline, lastKey = '', source, ref, io, now = Date.now}) {
  let others = 0;
  const finish = action => { io.out('action', action); io.setStop?.(); return action; };
  const stop = reason => { io.say(stopText(reason, {round, others})); io.telegram(`AI fixer: ${STOPS[reason]} (${source} ${ref})`); io.out('reason', reason); return finish('stop'); };
  const target = checkTarget(io.pr(), {repo: io.repo, source, ref});
  if (!target.ok) { io.out('reason', target.why.slice(0, 80)); return finish('end'); }   // merged, closed, or taken over by the owner: nothing to follow
  const first = stopReason({round, deadline, now: now()});
  if (first) return stop(first);
  const go = (kind, key, data) => {
    const reason = stopReason({round, deadline, key, lastKey, now: now()});
    if (reason) return stop(reason);
    io.label(); io.writeRound({kind, ...data}); io.out('kind', kind); io.out('key', key); io.out('round', String(round));
    return finish('round');
  };
  for await (const line of io.lines()) {
    const [, type, , rest] = /^ship: (READY|RED|COMMENT|CONFLICT|MERGED|CLOSED|WATCH ENDED) #(\d+)\s*(.*)$/.exec(line) || [];
    if (type === 'READY') { io.say(stopText('ready', {round, others})); io.telegram(`AI fixer: PR ${source} ${ref} is READY (still a draft)`); return finish('ready'); }
    if (type === 'MERGED' || type === 'CLOSED') return finish('end');
    if (type === 'WATCH ENDED') return stop('time');
    if (type === 'CONFLICT') return go('conflict', hash('conflict'), {check: '', log: ''});
    if (type === 'RED') {
      const head = rest.split(' ').at(-1), check = rest.slice(0, rest.length - head.length).trim(), log = scrub(await io.failedLog(check, head)).slice(-LOG_BYTES);
      return go('red', hash(failureKey('red', check, firstErrorLine(log))), {check: scrub(check), log});
    }
    if (type === 'COMMENT') {
      const got = await io.items(), sorted = classify(got.items, got), texts = list => list.map(item => scrub(item.body).slice(0, TEXT_BYTES));
      others = sorted.others.length;
      if (sorted.owner.length || sorted.gitar.length) return go('comment', hash(failureKey('comment', sorted.owner.length ? 'owner' : 'gitar', firstErrorLine((sorted.owner[0] || sorted.gitar[0]).body))), {check: '', log: '', owner: texts(sorted.owner), gitar: texts(sorted.gitar)});
    }
  }
  return stop('time');   // the watcher ended on its cap without a line of its own
}

const gh = (...args) => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000});
const api = (...args) => JSON.parse(gh('api', ...args) || 'null');

/** The real effects, on the PR `pr` of `repo` with the job's GH_TOKEN. */
function realIo({pr, repo, env, deadline}) {
  const dir = fs.mkdtempSync(path.join(env.RUNNER_TEMP || '/tmp', 'follow-')), log = path.join(dir, 'ship.log'), out = env.GITHUB_OUTPUT;
  fs.writeFileSync(log, '');
  let child;
  async function* lines() {
    const left = Math.max(1, Math.floor((Date.parse(deadline) - Date.now()) / 1000));
    child = spawn('bash', [path.join(import.meta.dirname, '../ship-watch.sh'), pr, log, path.join(dir, 'watch.pid'), repo], {env: {...env, SHIP_WATCH_DRAFT_OK: '1', SHIP_WATCH_POLL: '30', SHIP_WATCH_CAP: String(left), SHIP_WATCH_FIX: '/bin/true'}, stdio: 'ignore'});
    let done = false, seen = 0;
    child.on('exit', () => { done = true; });
    for (;;) {
      const all = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
      for (; seen < all.length; seen++) yield all[seen];
      if (done && seen >= fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length) return;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  return {repo, pr: () => api(`repos/${repo}/pulls/${pr}`), lines,
    setStop: () => child?.kill(),
    out: (key, value) => out && fs.appendFileSync(out, `${key}=${String(value).replace(/[\r\n]/g, ' ').slice(0, 200)}\n`),
    writeRound: data => { fs.mkdirSync(path.join(env.RUNNER_TEMP, 'round'), {recursive: true}); fs.writeFileSync(path.join(env.RUNNER_TEMP, 'round/round.json'), JSON.stringify(data)); },
    label: () => { try { execFileSync('node', [path.join(import.meta.dirname, '../gitar-label.mjs'), 'working', pr], {env, stdio: 'ignore', timeout: 60000}); } catch { /* the label is a courtesy: a round does not wait for it */ } },
    failedLog: async (check, head) => {
      const run = (api(`repos/${repo}/commits/${head}/check-runs?per_page=100`)?.check_runs || []).find(one => one.name === check && one.conclusion === 'failure');
      const job = /\/job\/(\d+)/.exec(run?.details_url || '')?.[1];
      try { return job ? gh('api', `repos/${repo}/actions/jobs/${job}/logs`) : `${check}: ${run?.output?.title || 'failed'} (no log)`; } catch { return `${check}: failed (its log could not be read)`; }
    },
    items: () => {
      const page = rest => api('--paginate', rest) || [], owner = env.PR_COMMENTS_OWNER || 'GarryOne', view = api(`repos/${repo}/pulls/${pr}`);
      const items = [...page(`repos/${repo}/issues/${pr}/comments?per_page=100`).map(c => ({id: c.id, login: c.user?.login, body: c.body, at: c.created_at})),
        ...page(`repos/${repo}/pulls/${pr}/reviews?per_page=100`).filter(r => r.body).map(r => ({id: r.id, login: r.user?.login, body: r.body, at: r.submitted_at})),
        ...page(`repos/${repo}/pulls/${pr}/comments?per_page=100`).map(c => ({id: `L${c.id}`, login: c.user?.login, body: c.body, at: c.created_at}))];
      const mine = items.filter(c => /Generated with.{0,4}Claude Code/.test(c.body || '')).map(c => c.at), commits = page(`repos/${repo}/pulls/${pr}/commits?per_page=100`).map(c => c.commit?.author?.date || '');
      return {items, owner, answeredAt: [...mine, ...commits].sort().at(-1) || '', gitarOpen: (view.labels || []).some(l => /^Gitar: (changes requested|approved with suggestions)$/.test(l.name))};
    },
    say: text => {
      if (page(`repos/${repo}/issues/${pr}/comments?per_page=100`).some(c => String(c.body).includes(MARK))) return;   // the ONE stop comment
      const file = path.join(dir, 'comment.md'); fs.writeFileSync(file, `${MARK}\n${text}\n`); gh('pr', 'comment', pr, '--repo', repo, '--body-file', file);
    },
    telegram: text => {
      const {CI_ALERTS_TELEGRAM_BOT_TOKEN: token, CI_ALERTS_TELEGRAM_CHAT_ID: chat} = env;
      if (!token || !chat) return;
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({chat_id: chat, text}), signal: AbortSignal.timeout(15000)}).catch(() => {});
    }};
}
const page = rest => api('--paginate', rest) || [];

async function main(argv = process.argv.slice(2), env = process.env) {
  const [command, ...args] = argv, pr = flag(args, '--pr'), round = Number(flag(args, '--round')), deadline = flag(args, '--deadline'), repo = env.GITHUB_REPOSITORY;
  if (!/^\d{1,7}$/.test(pr) || !(round >= 1 && round <= 99)) throw new Error('--pr and --round must be numbers');
  const head = api(`repos/${repo}/pulls/${pr}`)?.head?.ref || '', [, source, ref] = BRANCH.exec(head) || [];
  if (!source) throw new Error('that pull request is not on a branch this fixer opens');
  if (env.GITHUB_REF !== 'refs/heads/main') throw new Error('follow runs only from main\'s workflow');
  const io = realIo({pr, repo, env, deadline});
  io.out('source', source); io.out('ref', ref);   // from the branch name, which BRANCH allowed
  if (command === 'stop') {
    const reason = flag(args, '--reason');
    if (!STOPS[reason]) throw new Error('unknown stop reason');
    if (!checkTarget(io.pr(), {repo, source, ref}).ok) return console.log('stop: the pull request is closed, merged or taken over: no comment');   // nothing to say on a PR that is no longer the fixer's
    io.say(stopText(reason, {round})); io.telegram(`AI fixer: ${STOPS[reason]} (${source} ${ref})`);
  } else if (command === 'watch') {
    const action = await runFollow({round, deadline, lastKey: flag(args, '--last-key'), source, ref, io});
    console.log(`follow: ${action} (round ${round})`);   // the word only: the log is public
  } else throw new Error('usage: follow.mjs watch|stop (see the header)');
  process.exit(0);   // the watcher child is killed by process exit
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => { console.error(`::error::ai-fixer follow: ${String(error.message).slice(0, 200)}`); process.exit(1); });
