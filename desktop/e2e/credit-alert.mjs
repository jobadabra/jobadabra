// Tells the owner on Telegram ("Jobadabra · CI alerts") the moment an AI provider says its credit is gone, instead of a job failing in a log nobody reads.
//   node credit-alert.mjs <anthropic|openai|codex> "<the failure's own words>"      (CI_ALERTS_TELEGRAM_BOT_TOKEN + _CHAT_ID, GITHUB_* from the runner; a text that is no credit message sends nothing)
// Why (29 Oct 2026, owner: "when the AI balance/credit is 0 please send me a telegram notification. This is blind to me"): Anthropic's credit ran out on 22 Oct and only the product brain's own
// "failed" message reached him; the AI code review and the Sentry fixer failed for days with "Credit balance is too low" and told nobody. Called by the e2e lane's own failure readers and, for a refused Codex call, by .github/actions/ai-skipped-alert (--artifacts). tools/claude-failure-reason.py is gone: no workflow runs claude-code-action (31 Oct 2026). Guard: test/credit-alert.test.mjs.
// TODO(AI): Wire Codex broker callers and their provider advice in the brain/code-review/Sentry follow-up PRs (2026-10-29).
// Alert policy: send once per failed workflow run, including during an ongoing outage, so each affected workflow has its own run link. No cross-run suppression.
// Job: report health
import path from 'node:path';
import fs from 'node:fs';
import {failureAlert} from './lib/ai-failure-words.mjs';
import {alertHtml} from './lib/telegram-html.mjs';
import {delivered, send} from './ci-alert.mjs';

/** The providers' own wordings of an empty balance: Anthropic "Credit balance is too low", OpenAI "insufficient_quota" / "exceeded your current quota". */
const CREDIT_OUT = /credit balance is too low|insufficient[_ ]quota|exceeded your current quota|plans and billing/i;
// -> true when the text is one of those wordings; false for anything else, including an empty text.
export const isCreditOut = text => CREDIT_OUT.test(String(text || ''));

const ADVICE = {
  anthropic: 'Top up the Anthropic credit, or move the job to the Codex plan (the broker).',
  openai: 'Top up the OpenAI credit, or move the job to the Codex plan (the broker).',
  codex: "The Codex plan's budget for CI is used up: it frees itself at the weekly reset (the broker's /health says when), or raise the broker's share.",
};

/** The Telegram message: which provider, which workflow and run, the one next action. */
export function creditMessage({provider, text = '', env = process.env}) {
  const run = env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : '';
  return alertHtml({icon: '🔴', title: 'AI credit is 0', verdict: `${provider}: jobs that use it fail until it is back`,
    bullets: [{label: 'Workflow', parts: [env.GITHUB_WORKFLOW || 'unknown']}, {label: 'It said', parts: [String(text).slice(0, 200)]}, {label: 'Do', parts: [ADVICE[provider] || ADVICE.anthropic]}],
    links: run ? [{text: 'Open the run', url: run}] : []});
}

/** Sends the alert when `text` is a credit message (or the caller says the provider is capped: always = true). Returns the line to print; never throws, never prints the token. */
export async function alertCreditOut({provider, text, always = false, env = process.env, fetcher = fetch}) {
  if (!always && !isCreditOut(text)) return 'credit-alert: not a credit message, nothing sent';
  return send(creditMessage({provider, text, env}), env, fetcher, {event: 'ai-credit'});
}

// Why (4 Nov 2026, a8 via mac-32): a dropped connection was told as "AI credit ran out · Codex refused". Money is named only on the broker's own budget reason (`budget:`), a counted neuron cap or a provider's credit words; an unreadable count says nothing about money. The other way round is not claimed either: a 503 can hide a used-up engine (fallback:unsupported), so the alert says what happened and never "not credit". The caller's verdict is about a refusal, so it is used only then.
const saidLimit = text => /budget:|\d+ of \d+ neurons/i.test(text) || isCreditOut(text);
const CREDIT_TITLE = 'AI credit ran out', FAILED_TITLE = 'AI calls failed';

// Reads the cap files and the runner's aiCapped results in ONE walk: [{note, job, summary}], one per note. `summary` is the relay run's real call counts (ai-capped.json `summary`), null for a note
// from another producer (the failed alert then shows no numbers). Unrelated failed values keep their ordinary verdict.
function capEntries(folder) {
  let entries;
  try { entries = fs.readdirSync(folder, {withFileTypes: true}); } catch { return []; }
  return entries.flatMap(entry => {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) return capEntries(file);
    if (!['ai-capped.json', 'steps.json'].includes(entry.name)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (entry.name === 'ai-capped.json') {
        const summary = data.summary && Number.isFinite(data.summary.calls) && Array.isArray(data.summary.causes) ? data.summary : null;
        return [{note: `${path.basename(folder)}: ${data.why || `${data.neurons ?? 'unreadable'} of ${data.cap ?? 'unknown'} neurons; ${data.skipped || 0} skipped step(s)`}`, job: String(data.job || ''), summary}];
      }
      return (data.results || []).filter(step => step.aiCapped).map(step => ({note: `${path.basename(folder)}: ${step.note || step.name}`, job: '', summary: null}));
    } catch { return []; }
  });
}

/** Aggregate capped suites into one existing-channel alert; a persisted run marker suppresses fresh-runner duplicates. Never holds a release. */
export async function alertCappedSteps({artifacts, marker, verdict = 'AI steps are grey; the beta is not held', env = process.env, fetcher = fetch, log = console.log}) {
  const found = capEntries(artifacts), notes = [...new Set(found.map(one => one.note))];
  if (!notes.length) return 'credit-alert: no capped AI steps';
  for (const note of notes) log(`::warning title=${saidLimit(note) ? CREDIT_TITLE : FAILED_TITLE}::${note.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
  if (marker && fs.existsSync(marker)) return 'credit-alert: this run already alerted';
  const run = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const credit = notes.some(saidLimit);
  // Why (6 Nov 2026, owner: "this is not very readable"): a failed (not credit) alert is told in plain causes with the relay's real counts, never the broker's raw words (those stay in the log lines above).
  const counted = found.length && found.every(one => one.summary) ? found.map(one => one.summary) : null;
  const message = credit ? alertHtml({icon: '🩶', title: CREDIT_TITLE, verdict,
    bullets: [{label: 'Workflow', parts: [env.GITHUB_WORKFLOW || 'CI']}, {label: 'Cause', parts: [[...notes].sort((a, b) => saidLimit(b) - saidLimit(a)).slice(0, 3).join('; ')]}],
    links: [{text: 'Open the run', url: run}]})
    : failureAlert({jobs: found.map(one => one.job), summaries: counted, notes, run, workflow: env.GITHUB_WORKFLOW || 'CI'});
  const result = await send(message, env, fetcher, {event: 'ai-credit'});
  if (marker && delivered(result)) {
    fs.mkdirSync(path.dirname(marker), {recursive: true});
    fs.writeFileSync(marker, 'sent\n');
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  if (process.argv[2] === '--artifacts') {
    try {
      const flag = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
      console.log(await alertCappedSteps({artifacts: process.argv[3], marker: flag('--marker'), ...(flag('--verdict') ? {verdict: flag('--verdict')} : {})}));
    }
    catch { console.log('::warning title=AI credit ran out::Could not report AI credit health; the beta is not held'); }
  } else {
    const [provider = 'anthropic', text = ''] = process.argv.slice(2);
    console.log(await alertCreditOut({provider, text}));
  }
}
