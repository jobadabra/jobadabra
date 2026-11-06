// Runs a command whose AI calls go through the Codex broker, with the relay (lib/broker-relay-serve.mjs) on 127.0.0.1 in front of it, and says out loud when any AI call failed.
//   node broker-relay-run.mjs --job central-scout --cap 40 -- python -m src scout --publish-index      (jobadabra-lab's .github/workflows/central-scout.yml)
// Why (31 Oct 2026, owner: "We should use fully the Codex"; coordinator: "the silent green is a bug in its own right"): central-scout run 41192760002 ended `success` with 1,417 logged AI failures
// (the Anthropic workspace's usage limit, HTTP 400) and 1,552 "regain access on 2026-11-01" lines: nobody saw that the day's judgments were skipped. Every AI call of the command passes through the
// relay, so the relay's counts are the truth: any failed call becomes an "AI skipped/failed" annotation, ai-capped.json for the ONE alert of the run, and skipped=true for the steps after.
// The command keeps its own exit code (a refused judgment leaves items unjudged, never fails the day's publish) and never gets a real Anthropic key or an address off this machine.
// Job: report health
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {causeList} from './lib/ai-failure-words.mjs';
import {noteSkipped} from './lib/broker-job.mjs';
import {startRelay} from './lib/broker-relay-serve.mjs';

/** The env the command gets: the relay's address, a dummy key (the SDK wants one), the cap as the engine's own limit, and no other AI address or key. */
export function childEnv(env, url, cap) {
  const rest = {...env};
  for (const name of ['ANTHROPIC_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']) delete rest[name];
  return {...rest, JOBADABRA_AI_BASE_URL: url, ANTHROPIC_API_KEY: 'codex-relay-local', ...(cap ? {JOBADABRA_CENTRAL_MAX_CALLS: String(cap)} : {})};
}

/**
 * Takes the relay's stats and the job name; returns {line, why, summary}: one plain line for the log, the reason when any call failed ('' when none did), and the real counts
 * the alert is built from ({calls, ok, failed, causes: [{key, icon, label, count}]}; the raw reasons stay in `why` for the log only).
 * A cap reached by design (capHit) is said but is not a failure.
 */
export function outcomeOf(stats, job) {
  const line = `broker relay (${job}): ${stats.calls} calls reached the broker, ${stats.ok} answered, ${stats.refused} failed or refused${stats.capHit ? `, ${stats.capHit} past the run's cap (those items wait for the next run)` : ''}`;
  // calls = every call the job made that was answered or refused (ok + failed): a call refused after the broker latched never reached it, so stats.calls alone would read "11 of 2".
  const summary = {calls: stats.ok + stats.refused, ok: stats.ok, failed: stats.refused, causes: causeList(stats.causes)};
  if (!stats.refused) return {line, why: '', summary};
  const first = stats.latched || stats.reasons[0] || 'unknown';
  const effect = 'their items stay unjudged until a run gets an answer';
  // Why (4 Nov 2026, a8 via mac-32; 6 Nov 2026, owner): one dropped connection in 40 calls read like the whole run being refused; the count says what happened, and `summary` carries the real per-cause counts the alert's bar and rows come from.
  return {line, summary, why: stats.latched ? `${stats.refused} AI calls were refused (${first}); ${effect}` : `${stats.refused} of ${stats.calls} AI calls failed (${first}); ${effect}`};
}

/** Runs `argv` behind a relay; resolves to the command's exit code. Takes {job, cap, argv, env, dir}. */
export async function runBehindRelay({job, cap = 0, argv, env = process.env, dir, answer}) {
  const relay = await startRelay({cap, env, ...(answer ? {answer} : {})});
  const code = await new Promise(resolve => {
    const child = spawn(argv[0], argv.slice(1), {stdio: 'inherit', env: childEnv(env, relay.url, cap)});
    child.on('error', error => { console.error(`::error::${job}: cannot start ${argv[0]}: ${error.message}`); resolve(127); });
    child.on('exit', (status, signal) => resolve(status ?? (signal ? 128 : 1)));
  });
  await relay.close();
  const {line, why, summary} = outcomeOf(relay.stats, job);
  console.log(line);
  if (why) noteSkipped({job, why: `AI skipped/failed: ${why}`, summary, env, ...(dir ? {dir} : {})});
  return code;
}

async function main() {
  const args = process.argv.slice(2), split = args.indexOf('--');
  const flag = name => (args.indexOf(name) >= 0 && args.indexOf(name) < (split < 0 ? args.length : split) ? args[args.indexOf(name) + 1] : '');
  if (split < 0 || split === args.length - 1) throw new Error('usage: broker-relay-run.mjs --job <name> [--cap <calls>] -- <command...>');
  process.exitCode = await runBehindRelay({job: flag('--job') || 'ai job', cap: Number(flag('--cap')) || 0, argv: args.slice(split + 1)});
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => { console.error(`::error::${error.message}`); process.exit(1); });
