// What a job does when the AI refuses (owner, 24 Oct 2026: the Anthropic workspace hit its monthly limit; the changelog job stayed green and "retried at the next run" for a day, the daily digest failed 7 of 8 runs unseen).
// One place for every job that asks the AI broker from here (since 31 Oct 2026 no scheduled job calls the Anthropic API: owner, "We should use fully the Codex"): name the refusal (limit / auth / rate / overloaded),
// say "AI skipped", tell the owner on Telegram (once per outage, not every hour), never print a token.
// Guard: desktop/test/ci-intel-ai-refusal.test.js. The Telegram bot is the CI alerts one when this repo has it, else the Build Log bot (the secrets this repo holds).
import {causeOf} from '../../../desktop/e2e/lib/ai-failure-words.mjs';
import {card} from '../../../desktop/e2e/lib/tg-card.mjs';
import {postTelegram} from '../../../desktop/e2e/lib/telegram-post.mjs';

export class AiRefused extends Error {
  constructor(status, reason) { super(`broker answered ${status}: ${reason}`); this.name = 'AiRefused'; this.status = status; this.reason = reason; this.kind = kindOf(status, reason); }
}

// The broker's words: 'capped' = its allowance (a reason starting `budget:`: daily, own share, week, fallback-day; 429/503); any other refusal keeps its HTTP status (a lost login is 503); 'no-token' = this run has no GitHub OIDC token (the workflow needs id-token: write); 'unreachable' = no answer came back, a failed connection that says nothing about limits; else its HTTP status
// (401/403: it did not know the run's token or repository; 5xx: the Codex call itself failed).
export function kindOf(status, reason = '') {
  if (status === 'capped') return /budget:|login/.test(reason) ? 'limit' : 'overloaded';   // Why (4 Nov 2026): the client used to call every 503 capped; since it calls only a `budget:` reason capped, the `overloaded` branch is for older callers (fallback:reply-refused is one engine's bad reply, not an allowance).
  if (status === 'no-token' || status === 401 || status === 403) return 'auth';
  if (status === 'unreachable') return 'connection';
  if (status === 429) return 'rate';
  if (status === 529 || status >= 500) return 'overloaded';
  if (/usage limit|spend(ing)? limit|credit balance|billing|quota|budget/i.test(reason)) return 'limit';
  return 'other';
}
// Why (2 Nov 2026; 4 Nov 2026, a8 via mac-32): the broker runs Codex, Claude or Free AI, so no refusal names one of them, and its own words follow in `reason`; a failed connection has its own words, since "overloaded" claimed a load nobody measured.
const WORDS = {limit: 'no AI engine has an allowance left, or its login is not available', auth: 'the AI broker did not accept this run (no run token, or a repository it does not know)', rate: 'the AI broker is rate-limiting', overloaded: 'the AI broker failed this call', connection: 'no answer came back from the AI broker (a failed connection, not a limit)', other: 'the AI broker refused the request'};

/** One log line for the engine that answered, e.g. "AI: claude / claude-haiku-5-5 (codex ran-out)"; '' when the answer says nothing. A client that sends no engine yet shows the model alone. */
export function aiLine(answer) {
  const {engine, model, fellBack = []} = answer || {};
  const who = [engine, model].filter(Boolean).join(' / ');
  if (!who) return '';
  const fell = fellBack.map(item => `${item.engine} ${item.why}`).join(', ');
  return `AI: ${who}${fell ? ` (${fell})` : ''}`;
}

/** True for the error a refused AI call throws (AiRefused); any other error is a bug, not a refusal. Takes the caught value, returns a boolean, never throws. */
export const isRefusal = error => error instanceof AiRefused;
// "AI skipped (limit): <the broker's own words>": for the log line, the red run and the Telegram message.
export const describe = error => `AI skipped (${error.kind}): ${WORDS[error.kind]}. ${error.reason}`;
// A limit or a bad key will not clear within the run: the job stops asking and uses its fallback for everything left.
export const staysDown = error => isRefusal(error) && ['limit', 'auth', 'rate', 'overloaded', 'connection'].includes(error.kind);

// Tell the owner once per outage: when the run before this one was not red (the outage just began) or once a day at 08:xx Zurich as a reminder. `previous` = that run's conclusion, null when unknown (then tell).
export const shouldTell = ({previous = null, zurichHour = -1}) => previous !== 'failure' || zurichHour === 8;

// The latest finished run of this workflow before the current one: 'success' | 'failure' | … | null.
export function previousConclusion(workflow, {env = process.env, run}) {
  try {
    const list = JSON.parse(run('gh', 'run', 'list', '-R', env.GITHUB_REPOSITORY, '-w', workflow, '-L', '6', '--json', 'databaseId,conclusion,status'));
    return list.find(item => String(item.databaseId) !== String(env.GITHUB_RUN_ID) && item.status === 'completed')?.conclusion ?? null;
  } catch { return null; }
}

// Never throws: a Telegram failure must not hide the real one. -> {sent} | {skipped: why}
// Why (12 Nov 2026, owner: "Still getting on old telegram bots: CI Alerts, Build Log"): this posted with the old bot only, so no switch could stop it; it goes through the switchboard first (`event`, 'ai-credit' by default;
// the weekly e2e summary passes its own), and the old bot sends only when the switchboard cannot deliver (lib/telegram-post.mjs, fail-open). A message the owner's switch holds on purpose is told as sent.
export async function tellOwner(message, {env = process.env, fetch: doFetch = fetch, event = 'ai-credit'} = {}) {
  const bot = {token: env.CI_ALERTS_TELEGRAM_BOT_TOKEN || env.BUILDLOG_TELEGRAM_TOKEN, chat: env.CI_ALERTS_TELEGRAM_CHAT_ID || env.BUILDLOG_TELEGRAM_CHAT};
  try {
    const line = await postTelegram(message, {env, fetcher: doFetch, event, bot});
    if (/^telegram: (sent|held)/.test(line)) return {sent: true};
    return {skipped: /not sent/.test(line) ? 'no Telegram bot token / chat in this run' : line.replace(/^telegram: /, 'Telegram ')};
  } catch (error) { return {skipped: `Telegram unreachable (${error.name})`}; }
}

// The whole reaction of a job to a refusal: a named ::error:: line, and (once per outage) the Telegram message. `job` names it ("Changelog publish"); `effect` says what the owner will see ("a plain entry was published").
export async function reportRefusal(error, {job, effect, workflow, zurichHour, env = process.env, fetch: doFetch, run}) {
  console.log(`::error::${job}: ${describe(error)}${effect ? ` ${effect}` : ''}`);
  const previous = workflow && run ? previousConclusion(workflow, {env, run}) : null;
  if (!shouldTell({previous, zurichHour})) return {skipped: 'already told in the run before'};
  // Why (6 Nov 2026, owner: "make it human readable"): Telegram gets the plain cause, never the broker's raw words; the ::error:: line above keeps them for the log.
  const cause = causeOf(`${error.status} ${error.reason}`);
  const runUrl = env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : '';
  // Why (10 Nov 2026, owner: every message reads like the Central scout one): the job in the headline, the plain cause as the one row, what the owner will see as the verdict.
  const result = await tellOwner(card({level: 'orange', headline: `${job}: AI refused a job`, why: [{icon: cause.icon, text: cause.label}], whyTitle: 'Why',
    verdict: effect ? {ok: false, text: effect} : null, link: runUrl ? {text: 'Open the run', url: runUrl} : null}), {env, fetch: doFetch});
  console.log(`Telegram: ${JSON.stringify(result)}`);
  return result;
}
